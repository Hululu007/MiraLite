<div align="center">

# MiraLite

### Media Reimagined

[简体中文](README.md) | English

<br>

![status](https://img.shields.io/badge/status-dev%20preview-blue?style=for-the-badge)
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

[Overview](#overview) · [What's in this release](#whats-in-this-release) · [Features](#features) · [Build & Run](#build--run) · [Technical Notes](#technical-notes) · [Compliance](#compliance)

</div>

---

## Overview

A desktop media player that puts **IPTV**, **your local media library**, and **CAT/TVBox aggregator sites** into one window. Built on Tauri v2 + React 19: the Rust side boots the CAT engine, proxies TMDB data and forwards the stream; the frontend carries the liquid-glass look, the 3D coverflow home and the watchlist.

The CAT/TVBox spider engine is built in, so you can browse, search and play titles from aggregator sites directly. Metadata comes from TMDB; playback still comes from sources you connect yourself.

<!-- Drop screenshots into resources/screenshots/ and uncomment
<div align="center">

<br>

<img src="./resources/screenshots/home.png" alt="Home · 3D coverflow and ranking rows" width="90%">

*Home · 3D coverflow and multi-ranking poster rows*

<br>

<img src="./resources/screenshots/player.png" alt="Player · full-screen overlay" width="90%">

*Player · full-screen overlay and episode switching*

</div>
-->

## What's in this release

- **Liquid glass**: a fresh hue set on every launch, with a coloured haze drifting underneath. Sidebar, top bar, settings panel, inputs, cards and buttons all share translucent glass (backdrop blur, specular edge, coloured refraction), while the video area stays pure black so it never competes with the picture.
- **3D coverflow home**: TMDB aggregation with a rAF-driven carousel rotating at constant speed — hover pauses it, clicking a card, arrow or dot smoothly targets it, nine cards fill both sides, and the rating chip sits on the cover corner with no info card above.
- **Watchlist**: playing a CAT series records it locally — which episode, which site, when it updated. "Continue" jumps back to the detail page to pick the next episode; star, remove or clear from the list, and add titles from the home page in one tap.
- **Unified search**: one box searches local content and channels together with CAT cross-site titles, results shown in sections. The CAT part fans out across sites concurrently and ranks by relevance, with a link to the full CAT search page.
- **Multiple subscriptions, instant switching**: several CAT sources are stored in `miralite.cat.subscriptions.v1` (an old single address migrates automatically). Rename or delete each entry, and "select / in use" switches the active source immediately — home rankings, search and playback all follow it. The "test" button spins up a separate temporary engine to measure site count and search hits without touching the source you are using.
- **Stream proxy**: a local `:9989` proxy rewrites m3u8 playlists layer by layer, forwards auth headers, supports Range seeking and tolerates slow starts — fixing the 403s you get when a CDN treats CAT direct links as hotlink abuse.

## Features

- Minimal left nav (Home / Watchlist / Settings, shifted down to clear the macOS traffic lights) plus top search for CAT aggregation, IPTV and local library
- Home: TMDB poster rows for In Theatres / Popular Movies / Popular TV / Top Rated Movies / Top Rated TV; tapping a poster cross-site searches a playable route by title
- CAT page (route kept for home links): site list, category browsing, concurrent cross-site search, cloud-drive login guide, no-login-only site filter
- CAT detail: multiple routes plus episode list, automatic route fallback, auth-header passthrough playback
- Movies / TV pages (routes kept, not in the menu): genre filter, sorting, progress bar
- Player: hls.js adaptive streaming, custom control bar, progress write-back, keyboard shortcuts (Space / ←→ / M / Esc)
- Settings:
  - Playback: auto-play next, preferred quality
  - Recommendations: TastePrint toggle
  - Sources:
    - CAT subscriptions: multiple sources saved locally, rename and delete, instant switching between them, "test" using an isolated temporary engine, and the active subscription warms up on launch
    - Cloud-drive setup, M3U / Xtream / local folder onboarding, connected source management
  - Data: clear watchlist and watch history
- Built and packaged as `.app` / `.dmg`

## Build & Run

```bash
export PATH=/usr/local/bin:$PATH   # use the system node v24, not the node bundled with Marvis
npm install

npm run dev     # dev preview at http://127.0.0.1:5173
npm run build   # output in dist/
```

> ⚠️ The node bundled with Marvis on this machine carries an enterprise signature and cannot `dlopen` adhoc-signed native modules (rollup / rolldown crash outright). You have to run on the system node, otherwise both `npm run dev` and `npm run build` fail.

Packaging:

```bash
export PATH="$HOME/.cargo/bin:/usr/local/bin:$PATH"   # Rust + system node
npx tauri build --bundles app                        # output: src-tauri/target/release/bundle/macos/MiraLite.app
```

Frontend assets are embedded into the binary by Tauri, so **any change to the frontend or to Rust needs a fresh `tauri build`** before it reaches the `.app`.

## Technical Notes

### Stack

| Layer | Choice |
| --- | --- |
| Frontend | React 19 + TypeScript + Vite 7 |
| Styling | Tailwind CSS v4 (`@theme` design tokens) |
| Routing | react-router-dom (HashRouter, so a Tauri bundle can serve routes directly) |
| Playback | HTML5 video + hls.js (native HLS on Safari) |
| State | Lightweight `useSyncExternalStore` store, persisted to localStorage |
| Metadata | TMDB (Rust proxy to `api.tmdb.org`, key stored locally; bundled real-data snapshot as fallback) |
| Shell | Tauri v2 (Rust), wired up and packaged as `.app` / `.dmg` |

### Layout

```
src/
  components/   Shell nav, SourcesSection, TmdbSection, PlayerOverlay, Poster/Row
  data/         demo data (movies / series / channels) + tmdbSnapshot (real TMDB ranking snapshot, offline fallback)
  lib/          types / store / catalog / m3u / cat (CAT IPC wrapper) / catSession (multi-source · trending · cross-site search) / tmdb / chase
  pages/        Home / Chase / Movies / TV / Cat / CatSearch / CatDetail / Player / Detail / Search / Settings
src-tauri/
  src/lib.rs           Tauri command registration and startup
  src/cat.rs           CAT engine startup, per-subscription-address hashed cache, cat_proxy, cat_probe (:9988, kept off the stream proxy's :9989)
  src/tmdb.rs          TMDB ranking proxy (api.tmdb.org), local key config, connection test
  src/stream_proxy.rs  Local stream proxy (:9989), HLS rewriting + auth header passthrough + Range
```

### TMDB rankings cache and network

TMDB rankings only refresh a few times a day, so there is no point firing five requests every time the home page opens. `src/lib/tmdb.ts` keeps a memory + localStorage double cache (key `miralite.tmdb.rankings.v1`, TTL 6 hours, isolated by address / language / key fingerprint):

- Fresh cache means zero network requests and an instant home page.
- Expired cache still renders the old data first, refreshes silently in the background and swaps in the new data seamlessly (stale-while-revalidate).
- Concurrent callers share one in-flight request, and a failed request keeps the old cache.
- Changing the key, or hitting the refresh button in the top-right corner, triggers a refetch.

The official `api.themoviedb.org` is DNS-poisoned and unreachable from mainland China, so the app uses the official alternate domain `api.tmdb.org` (AWS CloudFront, verified reachable). Enter a v3 api_key or v4 Bearer Token under Settings → TMDB metadata source to go live; the key is stored only on this machine at `~/Library/Application Support/com.miralite.app/tmdb.json` (mode 600) and never lands in the source tree or the binary. With no key, a failed request, or a browser preview, the app falls back to the bundled real TMDB snapshot.

### CAT playback chain and auth headers

Direct links returned by a CAT site's `/play` endpoint usually carry a set of **required auth headers** (`Referer` / `Cookie` / `User-Agent`); without them the CDN treats the request as hotlink abuse and returns 403. The playback chain forwards that header set end to end:

```
catPlay() → { url, header }
  → PlayerOverlay(url, header)
  → viaProxy(url, header) → 127.0.0.1:9989/s?u=<url>&h=<JSON header>
  → Rust stream_proxy parses h, overrides the default Referer/UA, and passes it upstream to every m3u8 segment
```

Hop-by-hop headers in the `h` parameter (host / connection / content-length / range, etc.) are filtered out by the proxy so they cannot break streaming.

## Roadmap

- Local library scraping: filename parsing → TMDB metadata matching → cached poster wall
- EPG schedules and the full Xtream API (categories, VOD, series, time-shift)
- Windows / Linux packaging and auto-update

## Compliance

This project ships no content sources of its own. It is a client that reads sources the user connects; every watch record and setting stays on the local machine.

## License

Released under the [MIT](LICENSE) license — free to use, modify and redistribute, provided the copyright and permission notice are kept.
