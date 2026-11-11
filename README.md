---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 8ed0079d26025081b66058e9c4f6e911_b94bb44bdda711f1bc42525400638852
    ReservedCode1: AFBMQmrpWcIueC1PyiizsZxDrJjrxWvUd0+BiVKnl6CId6J7r7lqiLOfcrV1J7gxAZ9tK0oeLJ18W1GRvYYVzXt8lW3uV2//nRFmZr67LjgEt/8evQIenQR7SDTHb9Z2VP2hdkTvJm10FfXxfpH11kk87zFhjOZPcXjdOSVwcggdE75nfadvKwBIRhk=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 8ed0079d26025081b66058e9c4f6e911_b94bb44bdda711f1bc42525400638852
    ReservedCode2: AFBMQmrpWcIueC1PyiizsZxDrJjrxWvUd0+BiVKnl6CId6J7r7lqiLOfcrV1J7gxAZ9tK0oeLJ18W1GRvYYVzXt8lW3uV2//nRFmZr67LjgEt/8evQIenQR7SDTHb9Z2VP2hdkTvJm10FfXxfpH11kk87zFhjOZPcXjdOSVwcggdE75nfadvKwBIRhk=
---

# MiraLite

仿 MIRA Player 形态的 IPTV + 本地媒体库聚合播放器（Tauri v2 + React 19）。
内置 CAT/TVBox spider 引擎，可直接浏览、搜索并播放聚合站点的影视资源。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 19 + TypeScript + Vite 7 |
| 样式 | Tailwind CSS v4（`@theme` 自定义设计令牌） |
| 路由 | react-router-dom（HashRouter，便于 Tauri 打包后直出） |
| 播放 | HTML5 video + hls.js（Safari 走原生 HLS） |
| 状态 | 轻量 `useSyncExternalStore` store，localStorage 持久化 |
| 桌面壳 | Tauri v2（Rust），已接入并打包 `.app` / `.dmg` |

## 目录结构

```
src/
  components/   Shell 导航壳、PlayerOverlay 全屏播放层、Poster/Row
  data/         演示数据（电影/剧集/频道）
  lib/          types / store / catalog / m3u / cat（CAT 接口封装）
  pages/        Home / Movies / TV / Sources / Cat / CatSearch / CatDetail / Player / Detail / Search / Settings
src-tauri/
  src/lib.rs           Tauri 命令注册与启动
  src/cat.rs           CAT spider 引擎拉起、缓存、cat_proxy（:9988）
  src/stream_proxy.rs  本地串流代理（:9989），HLS 改写 + 鉴权 header 透传 + Range
```

## CAT 播放链路与鉴权 header

CAT 站点的 `/play` 接口返回的直链常带一组**必需的鉴权 header**（`Referer` / `Cookie` / `User-Agent`），
缺少它们会被 CDN 判为盗链返回 403。播放链路完整透传这组 header：

```
catPlay() → { url, header }
  → PlayerOverlay(url, header)
  → viaProxy(url, header) → 127.0.0.1:9989/s?u=<url>&h=<JSON header>
  → Rust stream_proxy 解析 h，覆盖默认 Referer/UA，透传给上游与每个 m3u8 分片
```

`h` 参数中的 hop-by-hop 头（host/connection/content-length/range 等）会被代理过滤，避免破坏流式转发。

## 运行

> ⚠️ 本机 Marvis 内置的 node 带企业签名，无法 dlopen adhoc 签名的原生模块（rollup/rolldown 会直接崩）。
> 必须用系统 node 跑，否则 `npm run build` 与 `npm run dev` 都会失败。

```bash
export PATH=/usr/local/bin:$PATH   # 使用系统 node v24，不要用 Marvis 内置 node
npm install

npm run dev     # 开发预览 http://127.0.0.1:5173
npm run build   # 产物输出到 dist/
```

## 已实现

- 左侧导航壳 + 顶部搜索，CAT 聚合 +  IPTV + 本地媒体库
- CAT 页：站点清单、分类浏览、跨站并发搜索、网盘登录引导、免登录站点筛选
- CAT 详情页：多线路 + 选集、自动换线兜底、鉴权 header 透传播放
- 首页：Hero 精选、继续观看、For You（TastePrint 加权推荐）、电影/剧集/直播四组行
- 电影页 / 剧集页：类型筛选、排序、观看进度条
- 片源页：M3U / Xtream / 本地目录三类接入，拉取真实播放列表并解析入库
- 播放器：hls.js 自适应、自定义控制条、进度回写、键盘快捷键（空格/←→/M/Esc）
- Rust 流代理（:9989）：m3u8 逐层改写、鉴权 header 透传、Range 拖动、慢启动容错
- 设置页：自动连播、优先画质、TastePrint 开关、观看记录清空

## 打包

```bash
export PATH="$HOME/.cargo/bin:/usr/local/bin:$PATH"  # Rust + 系统 node
npm run tauri build --bundles app   # 产物 src-tauri/target/release/bundle/macos/MiraLite.app
```

前端资源由 Tauri 嵌入二进制，改动**前端或 Rust 都必须重新 `tauri build`** 才会进入 `.app`。

## 待办路线

- 本地媒体库刮削：文件名解析 → TMDB 元数据匹配 → 海报墙缓存
- EPG 节目单与 Xtream 完整 API（分类、VOD、系列、时移）
- Windows / Linux 打包与自动更新

## 合规声明

本项目不提供任何内容源，仅作为客户端读取用户自行连接的来源；所有观看记录与设置仅保存在本机。
