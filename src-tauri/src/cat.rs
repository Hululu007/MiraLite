//! CAT / TVBox 接口支持。
//!
//! 这类源的 index.js 不是一个静态播放列表，而是一整套基于 Node 的 spider 运行时：
//! 启动后会在本机监听一个 HTTP 端口，暴露 /config（站点清单）与 /spider/{key}/{type}/{action}
//! （分类、详情、播放地址）。因此这里做三件事：
//!   1. 下载并缓存远程 index.js
//!   2. 用系统 node 把它拉起来，等到 /health 就绪
//!   3. 提供一个本地代理命令，绕开 webview 的 CORS 限制

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const HEALTH_NAME: &str = "CatVodSpiderios";
const DEFAULT_PORT: u16 = 9988;

#[derive(Default)]
pub struct CatState {
    pub port: Mutex<Option<u16>>,
    pub child: Mutex<Option<tokio::process::Child>>,
}

#[derive(Serialize, Deserialize)]
pub struct CatBoot {
    pub port: u16,
    pub ok: bool,
    pub message: String,
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("拿不到应用数据目录: {e}"))?
        .join("cat");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建缓存目录失败: {e}"))?;
    Ok(dir)
}

/// 找一个可用的 node 解释器。优先系统安装的，避免用到宿主内置的受限运行时。
fn find_node() -> Option<String> {
    let candidates = [
        "/usr/local/bin/node",
        "/opt/homebrew/bin/node",
        "/usr/bin/node",
    ];
    for c in candidates {
        if std::path::Path::new(c).exists() {
            return Some(c.to_string());
        }
    }
    // 兜底走 PATH
    if let Ok(out) = std::process::Command::new("/usr/bin/which").arg("node").output() {
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !p.is_empty() && std::path::Path::new(&p).exists() {
            return Some(p);
        }
    }
    None
}

async fn health(port: u16) -> Option<String> {
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/health");
    match client.get(&url).timeout(std::time::Duration::from_secs(3)).send().await {
        Ok(r) => r.text().await.ok(),
        Err(_) => None,
    }
}

/// 从用户填的地址推导出 index.js 的下载地址。
/// 允许直接填 `.../cat/index.js`、`.../cat`、`.../cat/`。
fn script_url(input: &str) -> String {
    let s = input.trim().trim_end_matches('/');
    if s.ends_with(".js") {
        s.to_string()
    } else if s.ends_with(".md5") {
        s.trim_end_matches(".md5").to_string()
    } else {
        format!("{s}/index.js")
    }
}

#[tauri::command]
pub async fn cat_start(app: AppHandle, state: tauri::State<'_, CatState>, url: String) -> Result<CatBoot, String> {
    // 已经有健康实例就直接复用，避免端口冲突
    let existing = { *state.port.lock().unwrap() };
    if let Some(p) = existing {
        if let Some(body) = health(p).await {
            if body.contains(HEALTH_NAME) {
                return Ok(CatBoot { port: p, ok: true, message: "已复用运行中的 CAT 引擎".into() });
            }
        }
    }

    let node = find_node().ok_or_else(|| "本机没找到 node，CAT 接口需要 Node 运行时才能跑".to_string())?;
    let dir = cache_dir(&app)?;
    let script = dir.join("index.js");

    // 远端有 .md5 就比对，变了才重新下载，省流量
    let src = script_url(&url);
    let md5_url = format!("{src}.md5");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {e}"))?;

    let remote_md5 = match client.get(&md5_url).send().await {
        Ok(r) if r.status().is_success() => r.text().await.ok().map(|t| t.trim().to_string()),
        _ => None,
    };

    let stamp = dir.join("index.js.md5");
    let local_md5 = std::fs::read_to_string(&stamp).ok().map(|t| t.trim().to_string());
    let need_download = !script.exists() || (remote_md5.is_some() && remote_md5 != local_md5);

    if need_download {
        let resp = client
            .get(&src)
            .send()
            .await
            .map_err(|e| format!("下载 index.js 失败: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("下载 index.js 失败: HTTP {}", resp.status()));
        }
        let bytes = resp.bytes().await.map_err(|e| format!("读取 index.js 失败: {e}"))?;
        if bytes.len() < 1024 {
            return Err(format!(
                "{} 返回的内容只有 {} 字节，不是 CAT 的 index.js",
                src,
                bytes.len()
            ));
        }
        std::fs::write(&script, &bytes).map_err(|e| format!("写入缓存失败: {e}"))?;
        if let Some(m) = &remote_md5 {
            let _ = std::fs::write(&stamp, m);
        }
    }

    let port = DEFAULT_PORT;
    let child = tokio::process::Command::new(&node)
        .arg(&script)
        .current_dir(&dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动 CAT 引擎失败: {e}"))?;

    *state.child.lock().unwrap() = Some(child);

    // 等它起来，最多 30 秒
    for _ in 0..60 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if let Some(body) = health(port).await {
            if body.contains(HEALTH_NAME) {
                *state.port.lock().unwrap() = Some(port);
                return Ok(CatBoot {
                    port,
                    ok: true,
                    message: format!("CAT 引擎已就绪（node: {node}）"),
                });
            }
        }
    }

    Err(format!(
        "CAT 引擎启动了但 30 秒内没就绪，端口 {port} 无响应。可能端口被占用或脚本启动失败。"
    ))
}

/// 转发请求到本地 CAT 引擎，绕开 webview 的跨域限制。
#[tauri::command]
pub async fn cat_proxy(
    state: tauri::State<'_, CatState>,
    path: String,
    method: Option<String>,
    body: Option<Value>,
) -> Result<Value, String> {
    let port = *state.port.lock().unwrap();
    let port = port.ok_or_else(|| "CAT 引擎还没启动".to_string())?;
    let url = format!("http://127.0.0.1:{port}{path}");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(40))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {e}"))?;

    let req = if method.as_deref().unwrap_or("GET").eq_ignore_ascii_case("POST") {
        client.post(&url).json(&body.unwrap_or(Value::Object(Default::default())))
    } else {
        client.get(&url)
    };

    let resp = req.send().await.map_err(|e| format!("请求 CAT 引擎失败: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;

    if !status.is_success() {
        // 500 往往是网盘未登录这类业务错误，原样把 message 交给前端
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            if let Some(m) = v.get("message").and_then(|m| m.as_str()) {
                return Err(m.to_string());
            }
        }
        return Err(format!("CAT 引擎返回 HTTP {status}"));
    }

    serde_json::from_str::<Value>(&text).map_err(|e| format!("响应不是合法 JSON: {e}"))
}

/// 打开源自带的配置中心：登录网盘、改站点开关都在里面。
/// 这个源的所有影片都挂在网盘上，没登录网盘就永远拿不到播放直链。
#[tauri::command]
pub async fn cat_open_config(state: tauri::State<'_, CatState>) -> Result<String, String> {
    let port = *state.port.lock().unwrap();
    let port = port.ok_or_else(|| "CAT 引擎还没启动".to_string())?;
    let url = format!("http://127.0.0.1:{port}/website");
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("打开配置中心失败: {e}"))?;
    Ok(url)
}

#[tauri::command]
pub async fn cat_status(state: tauri::State<'_, CatState>) -> Result<Option<u16>, String> {
    let port = *state.port.lock().unwrap();
    match port {
        Some(p) => Ok(health(p).await.filter(|b| b.contains(HEALTH_NAME)).map(|_| p)),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn cat_stop(state: tauri::State<'_, CatState>) -> Result<(), String> {
    let taken = { state.child.lock().unwrap().take() };
    if let Some(mut c) = taken {
        let _ = c.kill().await;
    }
    *state.port.lock().unwrap() = None;
    Ok(())
}
