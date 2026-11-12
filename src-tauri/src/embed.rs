//! 应用内嵌网页：在主窗口里挂一个 child webview，用原生视图承载目标站点，
//! 这样点快捷方式不用跳系统浏览器，全部留在 MiraLite 自己的界面里。

use tauri::{LogicalPosition, LogicalSize, WebviewBuilder, WebviewUrl, Window};

const LABEL: &str = "embed";

fn parse(url: &str) -> Result<tauri::Url, String> {
    let u = url.trim();
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err("只支持 http / https 链接".into());
    }
    u.parse().map_err(|e| format!("网址不合法: {e}"))
}

fn pad(w: f64, h: f64) -> (f64, f64) {
    (w.max(120.0), h.max(80.0))
}

fn find(window: &Window) -> Option<tauri::Webview> {
    window.webviews().into_iter().find(|v| v.label() == LABEL)
}

/// 打开（或换到）内嵌网页，位置尺寸用窗口内逻辑坐标。
#[tauri::command]
pub async fn embed_open(
    window: Window,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let target = parse(&url)?;
    if let Some(old) = find(&window) {
        let _ = old.close();
    }
    let (w, h) = pad(w, h);
    window
        .add_child(
            WebviewBuilder::new(LABEL, WebviewUrl::External(target)),
            LogicalPosition::new(x, y),
            LogicalSize::new(w, h),
        )
        .map_err(|e| format!("内嵌网页失败: {e}"))?;
    Ok(())
}

/// 跟着窗口尺寸重排；内嵌页不存在时静默返回。
#[tauri::command]
pub fn embed_set_bounds(window: Window, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    if let Some(v) = find(&window) {
        let (w, h) = pad(w, h);
        v.set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        v.set_size(LogicalSize::new(w, h)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn embed_close(window: Window) -> Result<(), String> {
    if let Some(v) = find(&window) {
        v.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 在内嵌页里跑一段 JS（后退 / 刷新 / 取当前地址都靠它）
#[tauri::command]
pub fn embed_eval(window: Window, js: String) -> Result<(), String> {
    if let Some(v) = find(&window) {
        v.eval(&js).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn embed_exists(window: Window) -> bool {
    find(&window).is_some()
}
