//! TMDB 影视数据源。
//!
//! 官方 API 域名 api.themoviedb.org 在国内被 DNS 污染，实测不可达；
//! 备用官方域名 api.tmdb.org（AWS CloudFront）可正常访问，两种鉴权都支持：
//!   - api_key=<v3 key>
//!   - Authorization: Bearer <v4 read token>
//! 这里用 Rust reqwest 走 HTTP 代理/直连请求，绕开 webview 跨域，
//! 并把 Key 存在本地配置文件（不硬编码进二进制）。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

pub const DEFAULT_BASE: &str = "https://api.tmdb.org/3";

/// 本地配置：api_key 可为 v3 key，也可为 v4 bearer token（以 eyJ 开头自动按 Bearer 处理）
#[derive(Serialize, Deserialize, Clone)]
pub struct TmdbConfig {
    pub api_key: String,
    #[serde(default = "default_base")]
    pub base_url: String,
    #[serde(default = "default_lang")]
    pub language: String,
}

fn default_base() -> String { DEFAULT_BASE.to_string() }
fn default_lang() -> String { "zh-CN".to_string() }

impl Default for TmdbConfig {
    fn default() -> Self {
        Self { api_key: String::new(), base_url: default_base(), language: default_lang() }
    }
}

/// 前端可见的配置（不泄露完整 key）
#[derive(Serialize)]
pub struct TmdbConfigView {
    pub configured: bool,
    pub api_key_hint: String,
    pub base_url: String,
    pub language: String,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("拿不到应用数据目录: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {e}"))?;
    Ok(dir.join("tmdb.json"))
}

pub(crate) fn load_config(app: &AppHandle) -> TmdbConfig {
    let path = match config_path(app) { Ok(p) => p, Err(_) => return TmdbConfig::default() };
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str::<TmdbConfig>(&s).unwrap_or_default(),
        Err(_) => TmdbConfig::default(),
    }
}

fn save_config(app: &AppHandle, cfg: &TmdbConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let text = serde_json::to_string_pretty(cfg).map_err(|e| format!("序列化配置失败: {e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("写入配置失败: {e}"))
}

fn mask(key: &str) -> String {
    if key.is_empty() { return String::new() }
    if key.len() <= 10 { return format!("{}***", &key[..3.min(key.len())]) }
    format!("{}***{}", &key[..6], &key[key.len()-4..])
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {e}"))
}

/// 请求 TMDB：v4 token 走 Bearer，v3 key 走 query
pub(crate) async fn request(cfg: &TmdbConfig, endpoint: &str, extra: &[(&str, &str)]) -> Result<Value, String> {
    if cfg.api_key.trim().is_empty() {
        return Err("还没有配置 TMDB API Key".to_string());
    }
    let base = cfg.base_url.trim().trim_end_matches('/');
    let url = format!("{base}/{endpoint}");
    let c = client()?;
    let mut req = c.get(&url).query(&[("language", cfg.language.as_str())]);
    for (k, v) in extra { req = req.query(&[(k, v)]); }
    let key = cfg.api_key.trim();
    // eyJ 开头的是 JWT（v4 read access token）
    if key.starts_with("eyJ") {
        req = req.header("Authorization", format!("Bearer {key}"));
    } else {
        req = req.query(&[("api_key", key)]);
    }
    let resp = req.send().await.map_err(|e| format!("请求 TMDB 失败: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("TMDB 返回 HTTP {status}: {}", &body[..body.len().min(200)]));
    }
    resp.json::<Value>().await.map_err(|e| format!("解析 TMDB 数据失败: {e}"))
}

#[tauri::command]
pub async fn tmdb_get_config(app: AppHandle) -> Result<TmdbConfigView, String> {
    let cfg = load_config(&app);
    Ok(TmdbConfigView {
        configured: !cfg.api_key.trim().is_empty(),
        api_key_hint: mask(cfg.api_key.trim()),
        base_url: cfg.base_url,
        language: cfg.language,
    })
}

#[tauri::command]
pub async fn tmdb_set_config(
    app: AppHandle,
    api_key: String,
    base_url: Option<String>,
    language: Option<String>,
) -> Result<TmdbConfigView, String> {
    let mut cfg = load_config(&app);
    cfg.api_key = api_key.trim().to_string();
    if let Some(b) = base_url {
        let b = b.trim();
        if !b.is_empty() { cfg.base_url = b.to_string(); }
    }
    if let Some(l) = language {
        let l = l.trim();
        if !l.is_empty() { cfg.language = l.to_string(); }
    }
    save_config(&app, &cfg)?;
    Ok(TmdbConfigView {
        configured: !cfg.api_key.is_empty(),
        api_key_hint: mask(&cfg.api_key),
        base_url: cfg.base_url,
        language: cfg.language,
    })
}

/// 测试 Key：拉一次 movie/popular，返回片名样例
#[tauri::command]
pub async fn tmdb_test(app: AppHandle) -> Result<serde_json::Value, String> {
    let cfg = load_config(&app);
    let data = request(&cfg, "movie/popular", &[("page", "1")]).await?;
    let results = data.get("results").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let samples: Vec<String> = results.iter()
        .take(5)
        .filter_map(|x| x.get("title").and_then(|t| t.as_str()).map(|s| s.to_string()))
        .collect();
    Ok(json!({
        "ok": !results.is_empty(),
        "count": results.len(),
        "samples": samples,
        "message": if results.is_empty() { "连接成功但没有影片数据".to_string() }
                   else { format!("连接成功，返回 {} 部影片", results.len()) },
    }))
}

/// 榜单定义：key / 标题 / 端点 / 媒体类型
const RANKINGS: [(&str, &str, &str, &str); 5] = [
    ("now_playing", "正在热映", "movie/now_playing", "movie"),
    ("popular_movie", "热门电影", "movie/popular", "movie"),
    ("popular_tv", "热门剧集", "tv/popular", "tv"),
    ("top_rated_movie", "高分经典", "movie/top_rated", "movie"),
    ("top_rated_tv", "高分剧集", "tv/top_rated", "tv"),
];

/// 规范化单条 TMDB 结果 -> 前端 TmdbItem
pub(crate) fn normalize(x: &Value, media_type: &str) -> Value {
    let title = x.get("title").or_else(|| x.get("name")).and_then(|v| v.as_str()).unwrap_or("");
    let original = x.get("original_title").or_else(|| x.get("original_name")).and_then(|v| v.as_str()).unwrap_or("");
    let poster = x.get("poster_path").and_then(|v| v.as_str()).unwrap_or("");
    let backdrop = x.get("backdrop_path").and_then(|v| v.as_str()).unwrap_or("");
    let date = x.get("release_date").or_else(|| x.get("first_air_date")).and_then(|v| v.as_str()).unwrap_or("");
    let rating = x.get("vote_average").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let overview = x.get("overview").and_then(|v| v.as_str()).unwrap_or("");
    // 按字符边界安全截取，避免切在中文 UTF-8 中间导致 panic
    let overview_short: String = overview.chars().take(160).collect();
    json!({
        "id": x.get("id").and_then(|v| v.as_i64()).unwrap_or(0),
        "mediaType": media_type,
        "title": title,
        "originalTitle": original,
        "poster": if poster.is_empty() { String::new() } else { format!("https://image.tmdb.org/t/p/w500{poster}") },
        "backdrop": if backdrop.is_empty() { String::new() } else { format!("https://image.tmdb.org/t/p/w780{backdrop}") },
        "year": &date[..date.len().min(4)],
        "rating": (rating * 10.0).round() / 10.0,
        "overview": overview_short,
    })
}

/// 拉全部榜单（串行，任一失败不影响其他组；全失败才报错）
#[tauri::command]
pub async fn tmdb_rankings(app: AppHandle) -> Result<Value, String> {
    let cfg = load_config(&app);
    let mut groups: Vec<Value> = Vec::new();
    let mut last_err: Option<String> = None;
    for (key, label, endpoint, media_type) in RANKINGS {
        match request(&cfg, endpoint, &[("page", "1")]).await {
            Ok(data) => {
                let results = data.get("results").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                let items: Vec<Value> = results.iter()
                    .take(20)
                    .map(|x| normalize(x, media_type))
                    .filter(|x| x.get("poster").and_then(|p| p.as_str()).map(|s| !s.is_empty()).unwrap_or(false))
                    .collect();
                groups.push(json!({ "key": key, "label": label, "items": items }));
            }
            Err(e) => last_err = Some(e),
        }
    }
    if groups.is_empty() {
        return Err(last_err.unwrap_or_else(|| "拉取 TMDB 榜单失败".to_string()));
    }
    Ok(json!({ "groups": groups, "live": true }))
}

/// 供本地媒体库刮削复用（跨模块访问私有实现）
pub(crate) fn load_config_pub(app: &AppHandle) -> TmdbConfig {
  load_config(app)
}

pub(crate) async fn request_pub(
  cfg: &TmdbConfig,
  endpoint: &str,
  extra: &[(&str, &str)],
) -> Result<Value, String> {
  request(cfg, endpoint, extra).await
}

pub(crate) fn normalize_pub(x: &Value, media_type: &str) -> Value {
  normalize(x, media_type)
}
