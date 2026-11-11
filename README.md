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

仿 MIRA Player 形态的 IPTV + 本地媒体库聚合播放器（Tauri + Web 前端）。
当前为 **Phase 1：前端骨架与交互**，尚未接入 Rust 壳。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 19 + TypeScript + Vite 7 |
| 样式 | Tailwind CSS v4（`@theme` 自定义设计令牌） |
| 路由 | react-router-dom（HashRouter，便于 Tauri 打包后直出） |
| 播放 | HTML5 video + hls.js（Safari 走原生 HLS） |
| 状态 | 轻量 `useSyncExternalStore` store，localStorage 持久化 |
| 桌面壳 | Tauri v2（**待接入**，本机尚未安装 Rust 工具链） |

## 目录结构

```
src/
  components/   Shell 导航壳、Poster 海报、Row 横向行
  data/         演示数据（电影/剧集/频道）
  lib/          types 类型、store 状态、catalog 目录聚合、m3u 解析
  pages/        Home / Movies / TV / Sources / Detail / Player / Search / Settings
```

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

- 左侧导航壳 + 顶部搜索，四个主页面
- 首页：Hero 精选、继续观看、For You（TastePrint 加权推荐）、电影/剧集/直播四组行
- 电影页：类型筛选 + 评分/年份/名称排序 + 观看进度条
- 剧集页：季数角标 + 仅未看完筛选
- 详情页：元信息、播放/片单、分集网格、相似作品
- 片源页：M3U / Xtream / 本地目录三类接入，拉取真实播放列表并解析入库
- 播放器：hls.js 自适应、自定义控制条、进度回写、键盘快捷键（空格/←→/M/Esc）
- 设置页：自动连播、优先画质、TastePrint 开关、观看记录清空
- M3U 解析器：识别 `#EXTINF` 属性（tvg-id / tvg-logo / group-title）与流地址

## 待办路线

- **Phase 2** 接入 Tauri v2 壳：装 rustup，实现 Rust 侧 HTTP 代理（绕开浏览器 CORS）、本地目录扫描、系统播放能力
- **Phase 3** 本地媒体库刮削：文件名解析 → TMDB 元数据匹配 → 海报墙缓存
- **Phase 4** EPG 节目单与 Xtream 完整 API（分类、VOD、系列、时移）
- **Phase 5** 打包 `.app` / `.dmg` / Windows / Linux 安装包与自动更新

## 合规声明

本项目不提供任何内容源，仅作为客户端读取用户自行连接的来源；所有观看记录与设置仅保存在本机。
*（内容由AI生成，仅供参考）*
