//! CAT / TVBox 接口支持。
//!
//! 这类源的 index.js 不是一个静态播放列表，而是一整套基于 Node 的 spider 运行时：
//! 启动后会在本机监听一个 HTTP 端口，暴露 /config（站点清单）与 /spider/{key}/{type}/{action}
//! （分类、详情、播放地址）。因此这里做三件事：
//!   1. 下载并缓存远程 index.js（按订阅地址区分，切换源不会串脚本）
//!   2. 用系统 node 把它拉起来，等到 /health 就绪
//!   3. 提供一个本地代理命令，绕开 webview 的跨域限制
//!
//! 同一个订阅地址复用同一个引擎；切换订阅时先停旧引擎，再用新地址启动。
//! 端口不写死 9988，而是从一组固定端口里挑空闲的，并且永远避开 9989（本地流代理）。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex as AsyncMutex;

const HEALTH_NAME: &str = "CatVodSpiderios";

#[derive(Default)]
pub struct CatState {
    pub port: Mutex<Option<u16>>,
    pub child: Mutex<Option<tokio::process::Child>>,
    /// 当前引擎用的订阅地址，用来判断「切换订阅」需不需要重启
    pub url: Mutex<Option<String>>,
    /// 启动串行锁：入口预热与页面 ensureSites 可能并发调用 cat_start，
    /// 不加锁会 spawn 出第二个引擎，脚本在 9988 被占时自动 +1 误占 9989（流代理端口）。
    pub boot_lock: AsyncMutex<()>,
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

/// 记录当前 CAT node 子进程的 PID。
/// kill_on_drop 只在 Rust 正常 Drop 时生效，遇到 SIGTERM / 强制退出 / 崩溃时
/// 子进程会变成孤儿继续占端口（旧 app 的 node 占 9988，新 app 被迫退到 9989 抢流代理端口）。
/// 用 PID 文件 + 启动时清理来兜底，且清理前校验进程命令行，避免 PID 复用误杀别的程序。
fn pid_file_path(app: &AppHandle) -> PathBuf {
    cache_dir(app)
        .map(|d| d.join("engine.pid"))
        .unwrap_or_else(|_| PathBuf::from("/tmp/miralite-cat-engine.pid"))
}

/// 启动时清理上一次遗留的 CAT node 孤儿进程。
/// 只杀命令行确实是我们 cat 缓存目录下 index.js 的进程，防止 PID 被系统复用后误杀。
pub fn kill_stale_engine(app: &AppHandle) {
    let pid_path = pid_file_path(app);
    let Ok(raw) = std::fs::read_to_string(&pid_path) else { return };
    let Ok(pid) = raw.trim().parse::<u32>() else {
        let _ = std::fs::remove_file(&pid_path);
        return;
    };
    if pid == 0 {
        let _ = std::fs::remove_file(&pid_path);
        return;
    }

    // 尽量用 ps 校验命令行，避免 PID 复用误杀别的程序。
    // 但若环境限制了 ps（返回空命令行），则信任 PID 文件——这是本 app 自己 spawn 时写入的，
    // 重启间隔内 PID 被系统复用概率极低；不信任就会让孤儿 node 永远清不掉。
    if let Ok(out) = std::process::Command::new("/bin/ps")
        .arg("-p")
        .arg(pid.to_string())
        .arg("-o")
        .arg("command=")
        .output()
    {
        let cmdline = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !cmdline.is_empty() {
            let looks_like_ours =
                cmdline.contains("node") && cmdline.contains("cat") && cmdline.contains("index.js");
            if !looks_like_ours {
                let _ = std::fs::remove_file(&pid_path);
                return;
            }
        }
    }
    // 无条件 kill -9（进程已不存在时自动忽略），再删 PID 文件
    let _ = std::process::Command::new("/bin/kill").arg("-9").arg(pid.to_string()).output();
    let _ = std::fs::remove_file(&pid_path);
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

/// 订阅地址 -> 稳定的缓存文件名（FNV-1a，跨版本一致）。
/// 不同订阅各自一份 index.js，切换时不会拿错脚本。
fn url_key(url: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in url.trim().as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

/// CAT 引擎的监听端口：优先 9988，其次 9990-9998，再退到 9970-9987。
/// 永远跳过 9989（stream_proxy 已绑定），避免两个服务互相抢占。
fn free_port() -> Result<u16, String> {
    let mut candidates: Vec<u16> = Vec::new();
    candidates.push(9988);
    candidates.extend(9990..=9998);
    candidates.extend(9970..=9987);
    for p in candidates {
        if let Ok(listener) = std::net::TcpListener::bind(("127.0.0.1", p)) {
            drop(listener);
            return Ok(p);
        }
    }
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("找不到可用端口: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("读取端口失败: {e}"))?
        .port();
    drop(listener);
    Ok(port)
}

/// 下载（或复用缓存）一个订阅地址的 index.js，返回脚本路径。
///
/// 关键：CAT spider 只有在其 `process.argv[1]` 以 `index.js` 结尾时才会自动启动 HTTP 服务，
/// 否则会把脚本当模块加载然后秒退（退出码 0、无任何输出）。所以不能把脚本命名成
/// `index-<hash>.js` 直接跑。这里改为「每个订阅一个独立子目录，目录内脚本固定叫 index.js」：
///   - argv[1] 以 index.js 结尾 → 引擎正常自启
///   - 各订阅的 wexfnwconfig.json / data 等运行时数据也互相隔离，不串源
///
/// 返回 (脚本路径, 工作目录)；调用方需把工作目录传给子进程的 current_dir。
async fn prepare_script(app: &AppHandle, target: &str) -> Result<(PathBuf, PathBuf), String> {
    let dir = cache_dir(app)?;
    let key = url_key(target);
    let work = dir.join(&key);
    std::fs::create_dir_all(&work).map_err(|e| format!("创建订阅工作目录失败: {e}"))?;
    let script = work.join("index.js");
    let stamp = work.join("index.js.md5");

    let src = script_url(target);
    let md5_url = format!("{src}.md5");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {e}"))?;

    let remote_md5 = match client.get(&md5_url).send().await {
        Ok(r) if r.status().is_success() => r.text().await.ok().map(|t| t.trim().to_string()),
        _ => None,
    };

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
    Ok((script, work))
}

/// 停掉当前引擎并清空状态。kill_on_drop 会在 app 退出时自动收掉子进程。
async fn stop_engine(state: &CatState) {
    // 先取出来再 await：MutexGuard 不能跨 .await，否则 future 不是 Send
    let taken = { state.child.lock().unwrap().take() };
    if let Some(mut child) = taken {
        let _ = child.kill().await;
    }
    *state.port.lock().unwrap() = None;
    *state.url.lock().unwrap() = None;
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
}

#[tauri::command]
pub async fn cat_start(
    app: AppHandle,
    state: tauri::State<'_, CatState>,
    url: String,
) -> Result<CatBoot, String> {
    let target = url.trim().to_string();
    if target.is_empty() {
        return Err("订阅地址不能为空".to_string());
    }

    // 串行化整个启动流程：并发调用排队，前一个跑完后，后一个会在下面
    // 「同一个订阅且健康」分支直接复用，不会 spawn 第二个引擎去误占 9989。
    let _boot_guard = state.boot_lock.lock().await;

    // 同一个订阅、引擎还健康 -> 直接复用，不做无谓重启
    let current = { state.url.lock().unwrap().clone() };
    let current_port = { *state.port.lock().unwrap() };
    if current.as_deref() == Some(target.as_str()) {
        if let Some(p) = current_port {
            if let Some(body) = health(p).await {
                if body.contains(HEALTH_NAME) {
                    return Ok(CatBoot {
                        port: p,
                        ok: true,
                        message: "已复用运行中的 CAT 引擎".into(),
                    });
                }
            }
        }
    }

    let node = find_node().ok_or_else(|| "本机没找到 node，CAT 接口需要 Node 运行时才能跑".to_string())?;
    // 先把新脚本准备好再停旧引擎：下载失败时正在用的源不受影响
    let (script, work) = prepare_script(&app, &target).await?;

    let port = free_port()?;
    stop_engine(&state).await;

    let mut command = tokio::process::Command::new(&node);
    command
        .arg(&script)
        .current_dir(&work)
        .env("PORT", port.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let child = command
        .spawn()
        .map_err(|e| format!("启动 CAT 引擎失败: {e}"))?;
    // 记下 PID：app 被 SIGTERM / 强杀 / 崩溃时 kill_on_drop 不可靠，
    // 下次启动靠这个 PID 文件把孤儿 node 收掉（见 kill_stale_engine）。
    if let (Ok(dir), Some(pid)) = (cache_dir(&app), child.id()) {
        let _ = std::fs::write(dir.join("engine.pid"), pid.to_string());
    }
    *state.child.lock().unwrap() = Some(child);

    // 等它起来，最多 30 秒
    for _ in 0..60 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if let Some(body) = health(port).await {
            if body.contains(HEALTH_NAME) {
                *state.port.lock().unwrap() = Some(port);
                *state.url.lock().unwrap() = Some(target);
                return Ok(CatBoot {
                    port,
                    ok: true,
                    message: format!("CAT 引擎已就绪（端口 {port}）"),
                });
            }
        }
    }

    stop_engine(&state).await;
    Err(format!(
        "CAT 引擎启动了但 30 秒内没就绪，端口 {port} 无响应。可到「设置 → 片源」换个订阅地址重试。"
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

/// 打开源自带的配置中心（网盘登录页），用系统默认浏览器打开。
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
    stop_engine(&state).await;
    Ok(())
}

/// 当前引擎在用的订阅地址，前端用它判断是否需要重新连接
#[tauri::command]
pub async fn cat_active_url(state: tauri::State<'_, CatState>) -> Result<Option<String>, String> {
    Ok(state.url.lock().unwrap().clone())
}

/// 订阅可用性检测结果
#[derive(Serialize, Deserialize)]
pub struct CatProbe {
    pub ok: bool,
    /// 引擎是否在 30 秒内就绪
    pub engine: bool,
    /// config 里的站点总数
    pub sites: usize,
    /// 实测能搜到影视的站点数
    pub working: usize,
    /// 实测总命中条数
    pub hits: usize,
    /// 命中的片名样例（最多 5 个）
    pub samples: Vec<String>,
    /// 结论文案
    pub message: String,
}

/// 测试一个订阅地址是否可用：用独立端口/独立引擎跑一次真实搜索，
/// 不影响当前正在使用的源。测完立即停掉临时引擎。
#[tauri::command]
pub async fn cat_probe(app: AppHandle, url: String) -> Result<CatProbe, String> {
    let target = url.trim().to_string();
    if target.is_empty() {
        return Err("订阅地址不能为空".to_string());
    }
    let started = std::time::Instant::now();

    let node = find_node().ok_or_else(|| "本机没找到 node，CAT 接口需要 Node 运行时才能跑".to_string())?;
    let (script, _real_work) = prepare_script(&app, &target).await?;
    let port = free_port()?;

    // 用独立临时目录跑测试引擎：脚本固定命名 index.js（满足自启守卫），
    // 且 wexfnwconfig.json / data 与正在使用的正式引擎完全隔离，测试不会影响当前源。
    let dir = cache_dir(&app)?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let probe_work = dir.join(format!("probe-{stamp}"));
    std::fs::create_dir_all(&probe_work).map_err(|e| format!("创建测试目录失败: {e}"))?;
    let probe_script = probe_work.join("index.js");
    std::fs::copy(&script, &probe_script).map_err(|e| format!("复制测试脚本失败: {e}"))?;

    // 临时引擎：kill_on_drop 保证函数结束（含提前 return）时子进程被回收
    let mut command = tokio::process::Command::new(&node);
    command
        .arg(&probe_script)
        .current_dir(&probe_work)
        .env("PORT", port.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|e| {
            let _ = std::fs::remove_dir_all(&probe_work);
            format!("启动测试引擎失败: {e}")
        })?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {e}"))?;

    let base = format!("http://127.0.0.1:{port}");
    let mut result = CatProbe {
        ok: false,
        engine: false,
        sites: 0,
        working: 0,
        hits: 0,
        samples: Vec::new(),
        message: String::new(),
    };

    // 1) 等引擎就绪
    let mut ready = false;
    for _ in 0..60 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if let Some(body) = health(port).await {
            if body.contains(HEALTH_NAME) {
                ready = true;
                break;
            }
        }
    }
    result.engine = ready;

    if ready {
        // 2) 拉站点清单
        if let Ok(resp) = client.get(format!("{base}/config")).send().await {
            if let Ok(cfg) = resp.json::<Value>().await {
                let sites = cfg
                    .get("video")
                    .and_then(|v| v.get("sites"))
                    .and_then(|s| s.as_array())
                    .cloned()
                    .unwrap_or_default();
                result.sites = sites
                    .iter()
                    .filter(|s| s.get("enable").and_then(|e| e.as_bool()).unwrap_or(true))
                    .count();

                // 3) 挑几个可搜索站点，用热门片名实测一次
                let candidates: Vec<&Value> = sites
                    .iter()
                    .filter(|s| s.get("searchable").and_then(|v| v.as_i64()).unwrap_or(0) != 0)
                    .take(8)
                    .collect();
                for s in &candidates {
                    let api = s.get("api").and_then(|a| a.as_str()).unwrap_or("");
                    if api.is_empty() {
                        continue;
                    }
                    let search_url = format!("{base}{api}/search");
                    let body = serde_json::json!({ "wd": "流浪地球", "page": 1, "quick": false });
                    if let Ok(resp) = client.post(&search_url).json(&body).send().await {
                        if let Ok(data) = resp.json::<Value>().await {
                            if let Some(list) = data.get("list").and_then(|l| l.as_array()) {
                                if !list.is_empty() {
                                    result.working += 1;
                                    result.hits += list.len();
                                    if result.samples.len() < 5 {
                                        for v in list {
                                            if let Some(name) = v.get("vod_name").and_then(|n| n.as_str()) {
                                                if !result.samples.iter().any(|x| x == name) {
                                                    result.samples.push(name.to_string());
                                                }
                                            }
                                            if result.samples.len() >= 5 {
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 测完把临时引擎收掉，确保端口释放、不影响下一次测试或正式连接
    let _ = child.kill().await;
    let _ = std::fs::remove_dir_all(&probe_work);
    let elapsed = started.elapsed().as_secs_f64();

    result.ok = result.engine && result.sites > 0 && result.working > 0;
    result.message = if result.ok {
        format!(
            "可用 · {:.1}s：引擎正常，{} 个站点，{} 个站点能搜到影视（命中 {} 条）",
            elapsed, result.sites, result.working, result.hits
        )
    } else if !result.engine {
        format!("不可用 · {:.1}s：引擎启动超时，订阅脚本可能无法运行", elapsed)
    } else if result.sites == 0 {
        format!("不可用 · {:.1}s：引擎起来了，但订阅里没有任何可用站点", elapsed)
    } else {
        format!(
            "站点可读取（{} 个），但实测没有站点能搜到影视，可能订阅已失效或站点被墙",
            result.sites
        )
    };
    Ok(result)
}
