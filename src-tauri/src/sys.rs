//! 与系统打交道的零碎命令。

/// 用系统浏览器打开一个链接。
/// `browser` 传应用名（如 "Microsoft Edge"）时优先用它，否则走系统默认浏览器。
#[tauri::command]
pub fn open_url(url: String, browser: Option<String>) -> Result<String, String> {
    let u = url.trim().to_string();
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err("只支持 http / https 链接".into());
    }

    let mut cmd = std::process::Command::new("open");
    if let Some(app) = browser.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        cmd.arg("-a").arg(app);
    }
    cmd.arg(&u)
        .spawn()
        .map_err(|e| format!("打开链接失败: {e}"))?;

    Ok(u)
}

/// 系统里是否存在某个 .app（用于前端决定「用 Edge 打开」按钮显不显示）
#[tauri::command]
pub fn has_app(name: String) -> bool {
    let n = name.trim();
    if n.is_empty() {
        return false;
    }
    std::path::Path::new("/Applications").join(format!("{n}.app")).exists()
        || std::path::Path::new("/System/Applications")
            .join(format!("{n}.app"))
            .exists()
}
