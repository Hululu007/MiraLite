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
| 影视元数据 | TMDB（Rust 代理 `api.tmdb.org`，Key 存本地配置；内置真实数据快照兜底） |
| 桌面壳 | Tauri v2（Rust），已接入并打包 `.app` / `.dmg` |

## 目录结构

```
src/
  components/   Shell 导航壳、SourcesSection 片源区块、TmdbSection 影视数据源设置、PlayerOverlay 全屏播放层、Poster/Row
  data/         演示数据（电影/剧集/频道）+ tmdbSnapshot（TMDB 真实榜单快照，离线兜底）
  lib/          types / store / catalog / m3u / cat（CAT IPC 封装）/ catSession（多订阅源·热门·跨站搜索）/ tmdb（TMDB 数据源）/ chase（追剧清单）
  pages/        Home / Chase / Movies / TV / Cat / CatSearch / CatDetail / Player / Detail / Search / Settings
src-tauri/
  src/lib.rs           Tauri 命令注册与启动
  src/cat.rs           CAT 引擎拉起与按订阅地址哈希隔离缓存、cat_proxy、cat_probe（:9988 等，避开流代理 :9989）
  src/tmdb.rs          TMDB 榜单代理（api.tmdb.org）、Key 本地配置、连接测试
  src/stream_proxy.rs  本地串流代理（:9989），HLS 改写 + 鉴权 header 透传 + Range
```

## TMDB 影视聚合首页

首页是 TMDB 影视聚合：**3D 立体自动旋转轮播**（coverflow 环廊，rAF 驱动匀速转动、悬停暂停、
点击卡片/箭头/指示点平滑转到目标，9 张卡片铺满两侧）作为头部焦点，上方不再有信息卡；
下方按「正在热映 / 热门电影 / 热门剧集 / 高分经典 / 高分剧集」分多榜单横向海报行。点任意海报会用片名跳到
CAT 跨站搜索页找可播线路（TMDB 只提供元数据，播放仍由 CAT 聚合站提供）。

> **榜单缓存**：TMDB 榜单一天只更新几次，没必要每次进首页都并发拉 5 个接口。`src/lib/tmdb.ts` 做了
> 「内存 + localStorage」双缓存（键 `miralite.tmdb.rankings.v1`，TTL 6 小时，按 地址/语言/Key 指纹隔离）。
> 缓存新鲜时进首页零网络请求、秒开；过期时先用旧数据渲染、后台静默刷新并无缝换上新数据（stale-while-revalidate）；
> 并发调用共享同一个请求（in-flight 去重），请求失败保留旧缓存；改 Key / 手动点右上角刷新按钮会重新拉取。
> 左下角极简行显示「TMDB · N 部 · 实时/离线 · 更新于 HH:MM」。

> **网络与 Key**：官方 `api.themoviedb.org` 在国内被 DNS 污染不可达，实际使用官方备用域名 `api.tmdb.org`
> （AWS CloudFront，实测可达）。在「设置 → 影视数据源（TMDB）」填 v3 api_key 或 v4 Bearer Token 即可走实时数据，
> Key 只存本机 `~/Library/Application Support/com.miralite.app/tmdb.json`（权限 600），不进源码/二进制。
> 未配置 Key、请求失败或浏览器预览时，自动回退到内置的 TMDB 真实数据快照，首页始终有内容。

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

- 极简左侧导航（首页 / 追剧 / 设置，菜单整体下移避开 macOS 红绿灯）+ 顶部搜索，CAT 聚合 + IPTV + 本地媒体库
- **追剧**：播放 CAT 剧集自动记入本地清单，记录看到第几集 / 站点 / 更新时间；支持「继续追」回详情选集、星标收藏、移除与清空；首页热门可一键加入
- **液态玻璃视觉**：每次打开随机生成一组色相，底层彩色光晕渐变缓慢流动；侧栏、顶栏、设置面板、输入框、卡片与按钮统一使用半透明玻璃材质（背景模糊 + 高光边缘 + 彩色折射），播放区保持纯黑避免干扰
- 首页：**TMDB 影视聚合** — 头部 **3D 立体自动旋转轮播**（rAF 匀速转动、悬停暂停、点击平滑切换、9 张卡片铺满两侧、评分角标，无顶部信息卡），下方「正在热映/热门电影/热门剧集/高分经典/高分剧集」多榜单横向海报行，点海报跨站搜可播线路。数据源为 TMDB 实时 API（Rust 代理 + 本地 Key 配置），带 6 小时双缓存（进首页零网络秒开、过期后台静默刷新），失败自动回退内置真实快照
- CAT 页（保留路由，供首页跳转）：站点清单、分类浏览、跨站并发搜索、网盘登录引导、免登录站点筛选
- **统一搜索**：顶栏搜索框同时检索「本地/频道」与「CAT 跨站真实影视」，结果分区展示；CAT 部分并发多站点、按相关度排序，并可跳 CAT 搜索页查看全部
- CAT 详情页：多线路 + 选集、自动换线兜底、鉴权 header 透传播放
- 电影页 / 剧集页（保留路由，不在菜单展示）：类型筛选、排序、观看进度条
- 播放器：hls.js 自适应、自定义控制条、进度回写、键盘快捷键（空格/←→/M/Esc）
- Rust 流代理（:9989）：m3u8 逐层改写、鉴权 header 透传、Range 拖动、慢启动容错
- 设置页：
  - 播放：自动连播、优先画质
  - 推荐：TastePrint 开关
  - **片源**：
    - 影视订阅：可保存**多个 CAT 订阅源**（本地 `miralite.cat.subscriptions.v1`，兼容旧单地址自动迁移）；每条可改名、删除，点列表前的「选择 / 使用中」**即时切换**（同一时间一个生效，首页热门/搜索/播放都基于它）；「测试」按钮用**独立临时引擎**实测站点数与搜索命中，不影响正在用的源；应用启动时自动预热当前启用的订阅
    - 网盘配置中心、M3U / Xtream / 本地目录三类接入、已连接源管理
  - 数据：片单、观看记录清空

## 打包

```bash
export PATH="$HOME/.cargo/bin:/usr/local/bin:$PATH"  # Rust + 系统 node
npx tauri build --bundles app       # 产物 src-tauri/target/release/bundle/macos/MiraLite.app
```

前端资源由 Tauri 嵌入二进制，改动**前端或 Rust 都必须重新 `tauri build`** 才会进入 `.app`。

## 待办路线

- 本地媒体库刮削：文件名解析 → TMDB 元数据匹配 → 海报墙缓存
- EPG 节目单与 Xtream 完整 API（分类、VOD、系列、时移）
- Windows / Linux 打包与自动更新

## 合规声明

本项目不提供任何内容源，仅作为客户端读取用户自行连接的来源；所有观看记录与设置仅保存在本机。
