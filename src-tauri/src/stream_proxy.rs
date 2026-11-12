//! 本地串流代理：解决网盘直链/直链站点的 403、跨域、UA 校验问题。
//!
//! 用法：GET http://127.0.0.1:9989/s?u=<encode 后的原始地址>&h=<encode 后的 header JSON>
//!  - 若上游返回 m3u8 文本，则把里面所有 URI 改写成代理地址（多层嵌套也能逐层剥），并透传鉴权 header
//!  - 若上游返回分片/视频，则流式透传，保留 Range / Content-Range，支持拖动进度
use axum::{
    Router,
    body::Body,
    extract::Query,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use futures_util::StreamExt;
use reqwest::header::{HeaderMap as ReqHeaderMap, HeaderName};
use serde::Deserialize;
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};

pub const PROXY_PORT: u16 = 9989;

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

#[derive(Deserialize)]
struct ProxyQ {
    u: String,
    /// CAT /play 返回的鉴权 header（JSON 对象），需透传给上游与每个 m3u8 分片
    h: Option<String>,
}

/// 解析前端透传的 header。过滤掉会破坏流式转发 / 有安全风险的 hop-by-hop 头。
fn extra_headers(raw: Option<&str>) -> ReqHeaderMap {
    let mut out = ReqHeaderMap::new();
    let raw = match raw {
        Some(r) if !r.is_empty() => r,
        _ => return out,
    };
    const BLOCKED: &[&str] = &[
        "host", "connection", "content-length", "transfer-encoding",
        "accept-encoding", "range", "te", "trailer", "upgrade", "keep-alive",
        "proxy-authorization", "proxy-authenticate",
    ];
    let map: HashMap<String, String> = match serde_json::from_str(raw) {
        Ok(m) => m,
        Err(_) => {
            log::warn!("[proxy] 忽略非法 header 参数");
            return out;
        }
    };
    for (k, v) in map {
        if BLOCKED.contains(&k.to_ascii_lowercase().as_str()) {
            continue;
        }
        if let (Ok(name), Ok(val)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(&v),
        ) {
            out.insert(name, val);
        }
    }
    out
}

/// 按 URL 判断是否播放列表（后缀判断，不依赖上游 Content-Type）
fn is_playlist_url(u: &str) -> bool {
    let lower = u.to_ascii_lowercase();
    let path = lower.split('?').next().unwrap_or(&lower);
    path.ends_with(".m3u8") || path.ends_with(".m3u")
}

fn origin_of(u: &str) -> String {
    match url::Url::parse(u) {
        Ok(p) => format!("{}://{}/", p.scheme(), p.host_str().unwrap_or("")),
        Err(_) => String::new(),
    }
}

fn wrap(u: &str, h: Option<&str>) -> String {
    // 必须回绝对地址：WKWebView 里页面 origin 是 tauri://localhost，
    // 相对路径 /s?u=... 会被解析到该 origin 上导致分片全 404（fragParsingError）
    let mut s = format!("http://127.0.0.1:{PROXY_PORT}/s?u={}", urlencoding::encode(u));
    // 鉴权 header 必须带到每个分片，否则主列表 200、分片全 403
    if let Some(hh) = h {
        if !hh.is_empty() {
            s.push_str(&format!("&h={}", urlencoding::encode(hh)));
        }
    }
    s
}

fn absolutize(base: &str, rel: &str) -> String {
    match url::Url::parse(rel) {
        Ok(_) => rel.to_string(),
        Err(_) => match url::Url::parse(base).and_then(|b| b.join(rel)) {
            Ok(v) => v.to_string(),
            Err(_) => rel.to_string(),
        },
    }
}

/// 把 m3u8 里所有 URI（含 EXT-X-KEY / EXT-X-MAP 的属性值）改写为走代理
fn rewrite_m3u8(text: &str, base: &str, h: Option<&str>) -> String {
    let mut out = String::with_capacity(text.len() + 512);
    for line in text.lines() {
        let t = line.trim();
        if t.is_empty() {
            out.push('\n');
            continue;
        }
        if t.starts_with('#') {
            if t.contains("URI=\"") {
                let mut rebuilt = String::new();
                let mut s = t;
                while let Some(i) = s.find("URI=\"") {
                    rebuilt.push_str(&s[..i + 5]);
                    let after = &s[i + 5..];
                    if let Some(j) = after.find('"') {
                        let raw = &after[..j];
                        let full = absolutize(base, raw);
                        rebuilt.push_str(&wrap(&full, h));
                        rebuilt.push('"');
                        s = &after[j + 1..];
                    } else {
                        rebuilt.push_str(after);
                        s = "";
                        break;
                    }
                }
                rebuilt.push_str(s);
                out.push_str(&rebuilt);
            } else {
                out.push_str(t);
            }
            out.push('\n');
        } else {
            let full = absolutize(base, t);
            out.push_str(&wrap(&full, h));
            out.push('\n');
        }
    }
    out
}

async fn stream_handler(Query(q): Query<ProxyQ>, headers: HeaderMap) -> Response {
    let target = q.u.trim().to_string();
    if !(target.starts_with("http://") || target.starts_with("https://")) {
        return (StatusCode::BAD_REQUEST, "bad url").into_response();
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };

    // 默认头；CAT /play 返回的 header 覆盖同名项（需要 Cookie + 特定 Referer/UA）
    let mut req_headers = ReqHeaderMap::new();
    if let Ok(v) = HeaderValue::from_str(UA) {
        req_headers.insert(reqwest::header::USER_AGENT, v);
    }
    if let Ok(v) = HeaderValue::from_str(&origin_of(&target)) {
        req_headers.insert(reqwest::header::REFERER, v);
    }
    // 要求上游别压缩：压缩后 Content-Length 与实际字节数对不上，
    // hls.js 会按头长度切分片，进而报 fragParsingError
    req_headers.insert(
        reqwest::header::ACCEPT_ENCODING,
        HeaderValue::from_static("identity"),
    );
    req_headers.insert(reqwest::header::ACCEPT, HeaderValue::from_static("*/*"));
    // 站点鉴权 header 覆盖默认（HeaderMap::insert 语义为替换，不会追加重复 UA/Referer）
    for (name, val) in extra_headers(q.h.as_deref()) {
        if let Some(n) = name {
            req_headers.insert(n, val);
        }
    }

    let mut rb = client.get(&target).headers(req_headers.clone());

    // 透传 Range，保证能拖进度条（客户端 Range 优先；extra_headers 已排除 range）。
    // 但播放列表绝对不能带 Range：WKWebView / AVFoundation 取 m3u8 时会先发
    // `Range: bytes=0-1` 做类型探测，若把 Range 透传给上游，上游返回 206 只剩 1 个字节，
    // 这里读到的正文不含 #EXTM3U 就会回 502，原生 HLS 直接 SRC_NOT_SUPPORTED（黑屏转圈）。
    let mut sent_range: Option<String> = None;
    let likely_playlist = is_playlist_url(&target);
    if !likely_playlist {
        if let Some(r) = headers.get(header::RANGE).and_then(|v| v.to_str().ok()) {
            sent_range = Some(r.to_string());
            rb = rb.header(reqwest::header::RANGE, r.to_string());
        }
    }

    let resp = match rb.send().await {
        Ok(r) => r,
        Err(e) => {
            return (StatusCode::BAD_GATEWAY, format!("上游请求失败: {e}")).into_response();
        }
    };

    let status = resp.status();
    if !status.is_success() && status != reqwest::StatusCode::PARTIAL_CONTENT {
        return (
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            format!("上游返回 {status}"),
        )
            .into_response();
    }

    let ct = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let is_playlist = ct.contains("mpegurl")
        || ct.contains("x-mpegURL")
        || target.contains(".m3u8")
        || target.contains(".m3u");

    log::info!(
        "[proxy] {} -> {} ({})",
        status.as_u16(),
        if is_playlist { "playlist" } else { "segment" },
        target
    );

    let mut out = axum::http::Response::builder()
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "*")
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "*")
        .header(header::CACHE_CONTROL, "no-store");

    if is_playlist {
        let mut body = match resp.text().await {
            Ok(t) => t,
            Err(e) => return (StatusCode::BAD_GATEWAY, format!("读播放列表失败: {e}")).into_response(),
        };
        // 兜底：URL 无 .m3u8 后缀、判定晚了一步，正文可能只是 Range 片段，重拉全文
        if !body.contains("#EXTM3U") && sent_range.is_some() {
            if let Ok(r2) = client.get(&target).headers(req_headers).send().await {
                if let Ok(t2) = r2.text().await {
                    body = t2;
                }
            }
        }
        if !body.contains("#EXTM3U") {
            return (StatusCode::BAD_GATEWAY, "上游不是 m3u8").into_response();
        }
        let rewritten = rewrite_m3u8(&body, &target, q.h.as_deref());
        return out
            .header(header::CONTENT_TYPE, "application/vnd.apple.mpegurl")
            .body(Body::from(rewritten))
            .map(|b| b.into_response())
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
    }

    // 分片：透传关键头 + 流式转发
    for (k, src) in [
        (header::CONTENT_TYPE, reqwest::header::CONTENT_TYPE),
        (header::CONTENT_LENGTH, reqwest::header::CONTENT_LENGTH),
        (header::CONTENT_RANGE, reqwest::header::CONTENT_RANGE),
        (header::ACCEPT_RANGES, reqwest::header::ACCEPT_RANGES),
    ] {
        if let Some(v) = resp.headers().get(&src).and_then(|v| v.to_str().ok()) {
            if let Ok(hv) = HeaderValue::from_str(v) {
                out = out.header(k, hv);
            }
        }
    }
    out = out.header(header::CONTENT_TYPE, ct);

    let stream = resp.bytes_stream().map(move |chunk| {
        chunk.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
    });
    out.status(StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK))
        .body(Body::from_stream(stream))
        .map(|b| b.into_response())
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn health() -> &'static str {
    "{\"ok\":true}"
}

/// 在后台起代理服务（失败只记日志，不影响主程序）
pub fn spawn() {
    tauri::async_runtime::spawn(async move {
        let app = Router::new()
            .route("/s", get(stream_handler))
            .route("/health", get(health));

        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, PROXY_PORT));
        match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => {
                log::info!("[stream-proxy] listening on {addr}");
                if let Err(e) = axum::serve(listener, app).await {
                    log::error!("[stream-proxy] serve error: {e}");
                }
            }
            Err(e) => log::error!("[stream-proxy] bind {addr} failed: {e}"),
        }
    });
}
