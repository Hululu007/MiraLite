//! 本地媒体库：扫目录 + TMDB 刮削。
//!
//! 只读扫描，不改动磁盘内容；刮削走 tmdb 模块里同一套鉴权与请求逻辑。
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::tmdb;

const VIDEO_EXTS: &[&str] = &[
  "mp4", "mkv", "mov", "avi", "wmv", "flv", "webm", "m4v", "ts", "m2ts", "rmvb", "rm", "mpg",
  "mpeg", "iso",
];

const MAX_FILES: usize = 4000;
const MAX_DEPTH: usize = 5;

#[derive(Serialize, Clone)]
pub struct ScannedFile {
  pub path: String,
  pub file_name: String,
  pub title: String,
  pub kind: String,
  pub year: Option<i32>,
  pub season: Option<i32>,
  pub episode: Option<i32>,
  /// 所在子目录名，剧集聚合时用
  pub folder: String,
}

fn is_video(p: &Path) -> bool {
  match p.extension() {
    Some(ext) => {
      let e = ext.to_string_lossy().to_lowercase();
      VIDEO_EXTS.contains(&e.as_str())
    }
    None => false,
  }
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
  if depth > MAX_DEPTH || out.len() >= MAX_FILES {
    return;
  }
  let rd = match std::fs::read_dir(dir) {
    Ok(r) => r,
    Err(_) => return,
  };
  for entry in rd.flatten() {
    if out.len() >= MAX_FILES {
      return;
    }
    let name = entry.file_name().to_string_lossy().to_string();
    if name.starts_with('.') {
      continue;
    }
    let p = entry.path();
    if p.is_dir() {
      let low = name.to_lowercase();
      // 跳过明显非媒体目录
      if low == "node_modules" || low == "cache" || low.contains("sample") && name.len() < 8 {
        continue;
      }
      walk(&p, depth + 1, out);
    } else if is_video(&p) {
      out.push(p);
    }
  }
}

fn is_year_token(t: &str) -> bool {
  t.len() == 4
    && t.chars().all(|c| c.is_ascii_digit())
    && matches!(&t[..2], "19" | "20")
}

fn is_junk_token(t: &str) -> bool {
  let low = t.to_lowercase();
  const JUNK: &[&str] = &[
    "1080p", "720p", "480p", "2160p", "4k", "8k", "hdr", "hdr10", "sdr", "dolby", "dv", "atmos",
    "bluray", "blu-ray", "bdrip", "brrip", "webrip", "web-dl", "webdl", "web", "hdtv", "hdrip",
    "dvdrip", "remux", "x264", "x265", "h264", "h265", "hevc", "avc", "av1", "aac", "ac3", "dts",
    "ddp", "dd5", "truehd", "10bit", "8bit", "hq", "proper", "repack", "extended", "uncut",
    "complete", "internal", "multi", "subs", "sub", "chs", "cht", "eng", "jpn", "kor",
  ];
  if JUNK.contains(&low.as_str()) {
    return true;
  }
  if low.starts_with('[') || low.starts_with('【') || low.starts_with('(') {
    return true;
  }
  // 中文常见描述词
  const CN: &[&str] = &[
    "国语", "粤语", "英语", "日语", "韩语", "中字", "中英", "双语", "中文字幕", "内嵌", "外挂",
    "合集", "完整版", "高清", "超清", "蓝光", "原盘", "未删减", "加长版", "导演剪辑版", "字幕",
  ];
  CN.iter().any(|k| low.contains(k))
}

/// 从文件名里猜：标题、年份、季、集
fn parse_stem(stem: &str) -> (String, Option<i32>, Option<i32>, Option<i32>) {
  let normalized = stem.replace(['.', '_', '　'], " ");
  let normalized = normalized.replace('[', " [").replace('(', " (");
  let tokens: Vec<&str> = normalized.split_whitespace().collect();

  let mut year: Option<i32> = None;
  let mut season: Option<i32> = None;
  let mut episode: Option<i32> = None;
  let mut cut = tokens.len();

  let mut idx = 0;
  while idx < tokens.len() {
    let t = tokens[idx];
    let low = t.to_lowercase();

    // SxxExx / S01 / EP03 / E05
    let mut matched = false;
    if low.len() >= 2 && low.starts_with('s') {
      let digits: String = low[1..].chars().take_while(|c| c.is_ascii_digit()).collect();
      if !digits.is_empty() {
        if let Ok(n) = digits.parse::<i32>() {
          if n <= 50 {
            season = Some(n);
            matched = true;
            let rest = &low[1 + digits.len()..];
            if let Some(rest_e) = rest.strip_prefix('e') {
              let ep: String = rest_e.chars().take_while(|c| c.is_ascii_digit()).collect();
              if let Ok(e) = ep.parse::<i32>() {
                episode = Some(e);
              }
            }
          }
        }
      }
    }
    if !matched {
      if let Some(rest) = low.strip_prefix("ep") {
        let ep: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(e) = ep.parse::<i32>() {
          if e > 0 {
            episode = Some(e);
            matched = true;
          }
        }
      }
    }
    // 第12集 / 第2季
    if !matched && t.starts_with('第') {
      let digits: String = t.chars().skip(1).take_while(|c| c.is_ascii_digit()).collect();
      if let Ok(n) = digits.parse::<i32>() {
        if t.ends_with('集') {
          episode = Some(n);
          matched = true;
        } else if t.ends_with('季') {
          season = Some(n);
          matched = true;
        }
      }
    }

    if year.is_none() && is_year_token(t) {
      year = Some(t.parse::<i32>().unwrap_or(0));
      if cut == tokens.len() {
        cut = idx;
      }
    }
    if is_junk_token(t) && cut == tokens.len() {
      cut = idx;
    }
    if matched && cut == tokens.len() {
      cut = idx;
    }
    idx += 1;
  }

  let mut title = tokens[..cut].join(" ").trim().to_string();
  if title.is_empty() {
    title = stem.to_string();
  }
  // 去掉尾部多余的连字符
  title = title.trim_matches(|c: char| c == '-' || c == ' ' || c == '·').to_string();
  (title, year, season, episode)
}

fn folder_of(p: &Path) -> String {
  p.parent()
    .and_then(|x| x.file_name())
    .map(|x| x.to_string_lossy().to_string())
    .unwrap_or_default()
}

/// 扫描目录（只读），递归最多 5 层，最多 4000 个视频文件
#[tauri::command]
pub async fn scan_media_dir(path: String) -> Result<Vec<ScannedFile>, String> {
  let root = PathBuf::from(&path);
  if !root.exists() {
    return Err(format!("路径不存在：{path}"));
  }
  if !root.is_dir() {
    return Err("请选择一个文件夹".to_string());
  }
  let mut files = Vec::new();
  tauri::async_runtime::spawn_blocking(move || {
    walk(&root, 0, &mut files);
    files
  })
  .await
  .map_err(|e| format!("扫描失败：{e}"))
  .map(|files| {
    files
      .into_iter()
      .map(|p| {
        let file_name = p
          .file_name()
          .map(|x| x.to_string_lossy().to_string())
          .unwrap_or_default();
        let stem = p
          .file_stem()
          .map(|x| x.to_string_lossy().to_string())
          .unwrap_or_default();
        let (title, year, season, episode) = parse_stem(&stem);
        let folder = folder_of(&p);
        // 剧集：文件名带集号，或所在目录像剧名（含季）
        let kind = if episode.is_some() || season.is_some() {
          "series"
        } else {
          "movie"
        };
        ScannedFile {
          path: p.to_string_lossy().to_string(),
          file_name,
          title,
          kind: kind.to_string(),
          year,
          season,
          episode,
          folder,
        }
      })
      .collect()
  })
}

/// 调系统文件夹选择框（macOS）
#[tauri::command]
pub async fn pick_media_folder() -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(|| {
    let script = "POSIX path of (choose folder with prompt \"选择媒体文件夹\")";
    let out = std::process::Command::new("osascript")
      .arg("-e")
      .arg(script)
      .output()
      .map_err(|e| format!("调起选择框失败：{e}"))?;
    if !out.status.success() {
      return Err("已取消".to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
  })
  .await
  .map_err(|e| format!("选择框异常：{e}"))?
}

/// TMDB 搜索：多结果，交给用户挑
#[tauri::command]
pub async fn tmdb_search(
  app: AppHandle,
  query: String,
  kind: Option<String>,
) -> Result<serde_json::Value, String> {
  let cfg = tmdb::load_config_pub(&app);
  let q = query.trim().to_string();
  if q.is_empty() {
    return Ok(serde_json::json!([]));
  }
  let endpoint = match kind.as_deref() {
    Some("series") | Some("tv") => "search/tv",
    Some("movie") => "search/movie",
    _ => "search/multi",
  };
  let data = tmdb::request_pub(&cfg, endpoint, &[("query", q.as_str()), ("include_adult", "false")])
    .await?;
  let media_type = match kind.as_deref() {
    Some("series") | Some("tv") => "tv",
    Some("movie") => "movie",
    _ => "",
  };
  let list = data
    .get("results")
    .and_then(|v| v.as_array())
    .cloned()
    .unwrap_or_default()
    .into_iter()
    .filter(|x| {
      if media_type.is_empty() {
        matches!(
          x.get("media_type").and_then(|v| v.as_str()),
          Some("movie") | Some("tv")
        )
      } else {
        true
      }
    })
    .take(12)
    .map(|x| {
      let mt = if media_type.is_empty() {
        x.get("media_type").and_then(|v| v.as_str()).unwrap_or("movie")
      } else {
        media_type
      };
      tmdb::normalize_pub(&x, mt)
    })
    .collect::<Vec<_>>();
  Ok(serde_json::Value::Array(list))
}

#[cfg(test)]
mod tests {
  use super::parse_stem;

  #[test]
  fn movie_with_year_and_tags() {
    let (t, y, s, e) = parse_stem("流浪地球2.2023.2160p.WEB-DL.x265.中字");
    assert_eq!(t, "流浪地球2");
    assert_eq!(y, Some(2023));
    assert_eq!(s, None);
    assert_eq!(e, None);
  }

  #[test]
  fn movie_english() {
    let (t, y, _, _) = parse_stem("Interstellar.2014.1080p.BluRay.x264");
    assert_eq!(t, "Interstellar");
    assert_eq!(y, Some(2014));
  }

  #[test]
  fn episode_sxxexx() {
    let (t, _, s, e) = parse_stem("The.Mandalorian.S01E03.1080p.WEB");
    assert_eq!(t, "The Mandalorian");
    assert_eq!(s, Some(1));
    assert_eq!(e, Some(3));
  }

  #[test]
  fn episode_chinese() {
    let (t, _, _, e) = parse_stem("狂飙 第12集 1080p");
    assert_eq!(t, "狂飙");
    assert_eq!(e, Some(12));
  }

  #[test]
  fn episode_only_keeps_stem() {
    let (t, _, _, e) = parse_stem("S02E05");
    assert!(!t.is_empty());
    assert_eq!(e, Some(5));
  }

  #[test]
  fn bracket_tags_cut() {
    let (t, _, _, _) = parse_stem("沙丘2 [HDR] 2024");
    assert_eq!(t, "沙丘2");
  }
}

#[cfg(test)]
mod scan_tests {
  use super::{parse_stem, walk};
  use std::path::PathBuf;

  #[test]
  fn scan_smoke() {
    let root: PathBuf = std::env::temp_dir().join("miralite_scan_smoke");
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("狂飙")).unwrap();
    std::fs::create_dir_all(root.join(".hidden")).unwrap();
    for f in [
      "流浪地球2.2023.2160p.WEB-DL.x265.中字.mp4",
      "Interstellar.2014.1080p.BluRay.mkv",
      "狂飙/狂飙 第12集 1080p.mp4",
      "狂飙/狂飙 第13集 1080p.mp4",
      ".hidden/x.mp4",
      "notes.txt",
    ] {
      std::fs::write(root.join(f), b"").unwrap();
    }
    let mut out = Vec::new();
    walk(&root, 0, &mut out);
    let names: Vec<String> = out
      .iter()
      .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
      .collect();
    println!("扫到 {} 个: {:?}", out.len(), names);
    assert_eq!(out.len(), 4, "应扫到 4 个视频（跳过隐藏目录与非视频）");
    for p in &out {
      let stem = p.file_stem().unwrap().to_string_lossy().to_string();
      println!("{} -> {:?}", stem, parse_stem(&stem));
    }
    std::fs::remove_dir_all(&root).ok();
  }
}
