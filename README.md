<div align="center">

# MiraLite

### Media Reimagined // 微光成影

简体中文 | [English](README.en.md)

<br>

![status](https://img.shields.io/badge/status-开发预览-blue?style=for-the-badge)
![license](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)
![stars](https://img.shields.io/github/stars/Simqiqi/MiraLite?style=for-the-badge&color=yellow)

<br>

![tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white)
![react](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=white)
![platform](https://img.shields.io/badge/platform-macOS-black?style=for-the-badge&logo=apple&logoColor=white)

<br>

![typescript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![contributors](https://img.shields.io/github/contributors/Simqiqi/MiraLite?style=for-the-badge&color=orange)

<br>

![last commit](https://img.shields.io/github/last-commit/Simqiqi/MiraLite?style=for-the-badge&label=last%20commit)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge)

<br>

[项目简介](#项目简介) · [这一版做了什么](#这一版做了什么) · [完整功能](#完整功能) · [获取与运行](#获取与运行) · [技术说明](#技术说明) · [合规声明](#合规声明)

</div>

---

## 项目简介

一个桌面端的影视播放器：把 **IPTV**、**本地媒体库**与 **CAT/TVBox 聚合站点**收进同一个窗口。基于 Tauri v2 + React 19 构建，Rust 侧负责拉起 CAT 引擎、代理 TMDB 数据与转发串流，前端负责**液态玻璃**视觉、**3D 轮播首页**与**追剧清单**。

内置 CAT/TVBox spider 引擎，可直接浏览、搜索并播放聚合站点的影视资源；影视线索来自 TMDB，实际播放仍由用户自行连接的来源提供。

<!-- 截图就位后取消注释，把图片放到 resources/screenshots/ 下即可
<div align="center">

<br>

<img src="./resources/screenshots/home.png" alt="首页 · 3D 轮播与热门榜单" width="90%">

*首页 · 3D 立体轮播与多榜单海报行*

<br>

<img src="./resources/screenshots/player.png" alt="播放 · 全屏播放层" width="90%">

*播放 · 全屏播放层与选集切换*

</div>
-->

## 这一版做了什么

- **液态玻璃**：每次启动随机生成一组色相，底层彩色光晕缓慢流动；侧栏、顶栏、设置面板、输入框、卡片与按钮统一为半透明玻璃材质（背景模糊 + 高光边缘 + 彩色折射），播放区保持纯黑以免干扰画面。
- **3D 立体轮播首页**：TMDB 影视聚合，coverflow 环廊由 rAF 驱动匀速转动，悬停暂停，点击卡片 / 箭头 / 指示点平滑转到目标，9 张卡片铺满两侧，评分角标贴在封面一角，上方不再压一张信息卡。
- **追剧清单**：播放 CAT 剧集自动记入本地清单，记录看到第几集、哪个站点、何时更新；支持「继续追」回详情选集、星标收藏、移除与清空，首页热门也能一键加入。
- **统一搜索**：顶栏一个输入框同时检索「本地 / 频道」与「CAT 跨站真实影视」，结果分区展示；CAT 部分并发多站点、按相关度排序，可再跳 CAT 搜索页看全部命中。
- **多订阅源即时切换**：可保存多个 CAT 订阅（本地 `miralite.cat.subscriptions.v1`，兼容旧单地址自动迁移），每条可改名删除，点「选择 / 使用中」立刻生效；「测试」按钮用**独立临时引擎**实测站点数与搜索命中，不干扰正在使用的源。
- **串流代理**：本地 `:9989` 逐层改写 m3u8、透传鉴权 header、支持 Range 拖动与慢启动容错，解决 CAT 直链被 CDN 判为盗链的 403。

## 完整功能

- 极简左侧导航（首页 / 追剧 / 设置，菜单整体下移避开 macOS 红绿灯）+ 顶部搜索
- 首页：TMDB 多榜单横向海报行（正在热映 / 热门电影 / 热门剧集 / 高分经典 / 高分剧集），点海报用片名跨站搜可播线路
- CAT 页（保留路由）：站点清单、分类浏览、跨站并发搜索、网盘登录引导、免登录站点筛选
- CAT 详情页：多线路 + 选集、自动换线兜底、鉴权 header 透传播放
- 电影页 / 剧集页（保留路由）：类型筛选、排序、观看进度条
- 播放器：hls.js 自适应、自定义控制条、进度回写、键盘快捷键（空格 / ←→ / M / Esc）
- 设置页：
  - 播放：自动连播、优先画质
  - 推荐：TastePrint 开关
  - 片源：CAT 订阅管理、网盘配置中心、M3U / Xtream / 本地目录三类接入、已连接源管理
  - 数据：片单、观看记录清空
- 已连接并打包 `.app` / `.dmg`

## 获取与运行

```bash
export PATH=/usr/local/bin:$PATH   # 使用系统 node v24，不要用 Marvis 内置 node
npm install

npm run dev     # 开发预览 http://127.0.0.1:5173
npm run build   # 产物输出到 dist/
```

> ⚠️ 本机 Marvis 内置的 node 带企业签名，无法 dlopen adhoc 签名的原生模块（rollup / rolldown 会直接崩）。
> 必须用系统 node 跑，否则 `npm run dev` 与 `npm run build` 都会失败。

打包：

```bash
export PATH="$HOME/.cargo/bin:/usr/local/bin:$PATH"   # Rust + 系统 node
npx tauri build --bundles app                        # 产物 src-tauri/target/release/bundle/macos/MiraLite.app
```

前端资源由 Tauri 嵌入二进制，**改动前端或 Rust 都必须重新 `tauri build`** 才会进入 `.app`。

## 技术说明

### 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 19 + TypeScript + Vite 7 |
| 样式 | Tailwind CSS v4（`@theme` 自定义设计令牌） |
| 路由 | react-router-dom（HashRouter，便于 Tauri 打包后直出） |
| 播放 | HTML5 video + hls.js（Safari 走原生 HLS） |
| 状态 | 轻量 `useSyncExternalStore` store，localStorage 持久化 |
| 影视元数据 | TMDB（Rust 代理 `api.tmdb.org`，Key 存本地配置；内置真实数据快照兜底） |
| 桌面壳 | Tauri v2（Rust），已接入并打包 `.app` / `.dmg` |

### 目录结构

```
src/
  components/   Shell 导航壳、SourcesSection 片源区块、TmdbSection 影视数据源设置、PlayerOverlay 全屏播放层、Poster/Row
  data/         演示数据（电影/剧集/频道）+ tmdbSnapshot（TMDB 真实榜单快照，离线兜底）
  lib/          types / store / catalog / m3u / cat（CAT IPC 封装）/ catSession（多订阅源·热门·跨站搜索）/ tmdb / chase（追剧清单）
  pages/        Home / Chase / Movies / TV / Cat / CatSearch / CatDetail / Player / Detail / Search / Settings
src-tauri/
  src/lib.rs           Tauri 命令注册与启动
  src/cat.rs           CAT 引擎拉起与按订阅地址哈希隔离缓存、cat_proxy、cat_probe（:9988 等，避开流代理 :9989）
  src/tmdb.rs          TMDB 榜单代理（api.tmdb.org）、Key 本地配置、连接测试
  src/stream_proxy.rs  本地串流代理（:9989），HLS 改写 + 鉴权 header 透传 + Range
```

### TMDB 榜单缓存与网络

TMDB 榜单一天只更新几次，没必要每次进首页都并发拉 5 个接口。`src/lib/tmdb.ts` 做了「内存 + localStorage」双缓存（键 `miralite.tmdb.rankings.v1`，TTL 6 小时，按地址 / 语言 / Key 指纹隔离）：

- 缓存新鲜时进首页零网络请求、秒开；
- 过期时先用旧数据渲染，后台静默刷新并无缝换上新数据（stale-while-revalidate）；
- 并发调用共享同一个请求（in-flight 去重），请求失败保留旧缓存；
- 改 Key 或点右上角刷新按钮会重新拉取。

官方 `api.themoviedb.org` 在国内被 DNS 污染不可达，实际使用官方备用域名 `api.tmdb.org`（AWS CloudFront，实测可达）。在「设置 → 影视数据源（TMDB）」填 v3 api_key 或 v4 Bearer Token 即可走实时数据，Key 只存本机 `~/Library/Application Support/com.miralite.app/tmdb.json`（权限 600），不进源码 / 二进制。未配置 Key、请求失败或浏览器预览时，自动回退到内置的 TMDB 真实数据快照。

### CAT 播放链路与鉴权 header

CAT 站点的 `/play` 接口返回的直链常带一组**必需的鉴权 header**（`Referer` / `Cookie` / `User-Agent`），缺少它们会被 CDN 判为盗链返回 403。播放链路完整透传这组 header：

```
catPlay() → { url, header }
  → PlayerOverlay(url, header)
  → viaProxy(url, header) → 127.0.0.1:9989/s?u=<url>&h=<JSON header>
  → Rust stream_proxy 解析 h，覆盖默认 Referer/UA，透传给上游与每个 m3u8 分片
```

`h` 参数中的 hop-by-hop 头（host / connection / content-length / range 等）会被代理过滤，避免破坏流式转发。

## 待办路线

- 本地媒体库刮削：文件名解析 → TMDB 元数据匹配 → 海报墙缓存
- EPG 节目单与 Xtream 完整 API（分类、VOD、系列、时移）
- Windows / Linux 打包与自动更新

## 合规声明

本项目不提供任何内容源，仅作为客户端读取用户自行连接的来源；所有观看记录与设置仅保存在本机。

## 许可证

本项目采用 [MIT](LICENSE) 许可证，可自由使用、修改与分发，保留版权与许可声明即可。
