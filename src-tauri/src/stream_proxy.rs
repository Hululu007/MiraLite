//! 本地串流代理：解决网盘直链/直链站点的 403、跨域、UA 校验问题。
//!
//! 用法：GET http://127.0.0.1:9989/s?u=<encode 后的原始地址>
//!  - 若上游返回 m3u8 文本，则把里面所有 URI 改写成代理地址（多层嵌套也能逐层剥）
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
use serde::Deserialize;
use std::net::{Ipv4Addr, SocketAddr};

pub const PROXY_PORT: u16 = 9989;

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

#[derive(Deserialize)]
struct ProxyQ {
    u: String,
}

fn origin_of(u: &str) -> String {
    match url::Url::parse(u) {
        Ok(p) => format!("{}://{}/", p.scheme(), p.host_str().unwrap_or("")),
        Err(_) => String::new(),
    }
}

fn wrap(u: &str) -> String {
    // 必须回绝对地址：WKWebView 里页面 origin 是 tauri://localhost，
    // 相对路径 /s?u=... 会被解析到该 origin 上导致分片全 404（fragParsingError）
    format!("http://127.0.0.1:{PROXY_PORT}/s?u={}", urlencoding::encode(u))
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
fn rewrite_m3u8(text: &str, base: &str) -> String {
    let mut out = String::with_capacity(text.len() + 512);
    for line in text.lines() {
        let t = line.trim();
        if t.is_empty() {
            out.push('\n');
            continue;
        }
        if let Some(rest) = t.strip_prefix('#') {
            let _ = rest;
            if t.contains("URI=\"") {
                let mut rebuilt = String::new();
                let mut s = t;
                while let Some(i) = s.find("URI=\"") {
                    rebuilt.push_str(&s[..i + 5]);
                    let after = &s[i + 5..];
                    if let Some(j) = after.find('"') {
                        let raw = &after[..j];
                        let full = absolutize(base, raw);
                        rebuilt.push_str(&wrap(&full));
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
            out.push_str(&wrap(&full));
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

    let mut rb = client
        .get(&target)
        .header(reqwest::header::USER_AGENT, UA)
        .header(reqwest::header::REFERER, origin_of(&target))
        // 要求上游别压缩：压缩后 Content-Length 与实际字节数对不上，
        // hls.js 会按头长度切分片，进而报 fragParsingError
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .header(reqwest::header::ACCEPT, "*/*");

    // 透传 Range，保证能拖进度条
    if let Some(r) = headers.get(header::RANGE).and_then(|v| v.to_str().ok()) {
        rb = rb.header(reqwest::header::RANGE, r.to_string());
    }

    let resp = match rb.send().await {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("上游请求失败: {e}"),
            )
                .into_response();
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

    log::info!("[proxy] {} -> {} ({})", status.as_u16(), if is_playlist { "playlist" } else { "segment" }, target);

    let mut out = axum::http::Response::builder()
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "*")
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "*")
        .header(header::CACHE_CONTROL, "no-store");

    if is_playlist {
        let body = match resp.text().await {
            Ok(t) => t,
            Err(e) => return (StatusCode::BAD_GATEWAY, format!("读播放列表失败: {e}")).into_response(),
        };
        if !body.contains("#EXTM3U") {
            return (StatusCode::BAD_GATEWAY, "上游不是 m3u8").into_response();
        }
        let rewritten = rewrite_m3u8(&body, &target);
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
