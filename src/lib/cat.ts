/**
 * CAT / TVBox 接口的前端封装。
 *
 * 这类源不是播放列表，而是一个本地 spider 服务：
 *   GET  /config                        -> 站点清单
 *   POST /spider/{key}/{type}/home      -> 站点分类
 *   POST /spider/{key}/{type}/category  -> 分类下的影片
 *   POST /spider/{key}/{type}/detail    -> 详情 + 播放线路
 *   POST /spider/{key}/{type}/play      -> 真实播放地址
 * 服务由 Rust 侧拉起，请求经 cat_proxy 转发以绕开 webview 的跨域限制。
 */

import { invoke } from '@tauri-apps/api/core'

export const inTauri = () => '__TAURI_INTERNALS__' in window

const invokeFn = () => (inTauri() ? invoke : null)

export interface CatBoot {
  port: number
  ok: boolean
  message: string
}

export interface CatSite {
  key: string
  name: string
  type: number
  api?: string
  searchable?: number
  quickSearch?: number
  filterable?: number
}

export interface CatClass {
  type_id: string
  type_name: string
}

export interface CatVod {
  vod_id: string
  vod_name: string
  vod_pic?: string
  vod_remarks?: string
  vod_year?: string
  vod_area?: string
  vod_actor?: string
  vod_director?: string
  vod_content?: string
  vod_play_from?: string
  vod_play_url?: string
}

export interface CatListResult {
  page: number
  pagecount: number
  total: number
  list: CatVod[]
  class?: CatClass[]
  filters?: Record<string, unknown>
}

export async function catStart(url: string): Promise<CatBoot> {
  const invoke = invokeFn()
  if (!invoke) throw new Error('CAT 接口需要在桌面版里使用')
  return (await invoke('cat_start', { url })) as CatBoot
}

export async function catStatus(): Promise<number | null> {
  const invoke = invokeFn()
  if (!invoke) return null
  try {
    return (await invoke('cat_status')) as number | null
  } catch {
    return null
  }
}

export async function catStop(): Promise<void> {
  const invoke = invokeFn()
  if (invoke) await invoke('cat_stop')
}

async function call<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const invoke = invokeFn()
  if (!invoke) throw new Error('CAT 接口需要在桌面版里使用')
  return (await invoke('cat_proxy', {
    path,
    method: body ? 'POST' : 'GET',
    body: body ?? null,
  })) as T
}

/** 拉取站点清单 */
export async function catConfig(): Promise<CatSite[]> {
  const cfg = await call<{ video?: { sites?: CatSite[] } }>('/config')
  return (cfg.video?.sites ?? []).filter((s) => s.api)
}

/** 站点根路径，形如 /spider/wogg/3 */
function base(site: CatSite): string {
  return site.api ?? `/spider/${site.key}/3`
}

export function catHome(site: CatSite) {
  return call<CatListResult>(`${base(site)}/home`, {})
}

export function catCategory(site: CatSite, id: string, page = 1, filter = false) {
  return call<CatListResult>(`${base(site)}/category`, { id, page, filter })
}

export function catDetail(site: CatSite, id: string) {
  return call<CatListResult>(`${base(site)}/detail`, { id })
}

export function catSearch(site: CatSite, wd: string, page = 1) {
  return call<CatListResult>(`${base(site)}/search`, { wd, page, quick: false })
}

export interface CatPlayResult {
  url?: string
  parse?: number
  header?: Record<string, string>
  msg?: string
}

/** 交给播放器的完整播放源：直链 + 站点返回的鉴权 header */
export interface PlayingSource {
  url: string
  header?: Record<string, string>
}

export function catPlay(site: CatSite, flag: string, id: string) {
  return call<CatPlayResult>(`${base(site)}/play`, { flag, id })
}

/** 打开源自带的配置中心（网盘登录页），用系统默认浏览器打开 */
export async function catOpenConfig(): Promise<string> {
  const invoke = invokeFn()
  if (!invoke) throw new Error('CAT 接口需要在桌面版里使用')
  return (await invoke('cat_open_config')) as string
}

export interface PanProvider {
  configured: boolean
  login: boolean
  state: string
  label: string
}

/**
 * 查网盘登录状态。
 * 这个源的所有影片都存放在网盘里，play 时由 spider 用你的网盘 Cookie 换直链，
 * 所以没登录网盘，播放必然报「未配置 Cookie」。
 */
export async function catPanStatus(): Promise<Record<string, PanProvider>> {
  try {
    const r = await call<{ code?: number; data?: { providers?: Record<string, PanProvider> } }>(
      '/website/api/status',
    )
    return r.data?.providers ?? {}
  } catch {
    return {}
  }
}

/** 判断一条播放报错是不是「该去登录网盘」了 */
export function isPanAuthError(msg: string): boolean {
  return /cookie|网盘|登录|配置中心|未配置|token/i.test(msg)
}

const PAN_KEY = 'miralite.cat.panSites'

/**
 * 实测确认必须登录网盘才能播放的站点。
 * 这套源一共 98 个站点，绝大多数（动漫/秒播/短剧/听书/直播…）都是直链，开箱即播；
 * 只有几个 4K 聚合站把文件放在网盘里。播放失败时报网盘错误的会自动补进来。
 */
const KNOWN_PAN_SITES = [
  'nodejs_duoduo',
  'nodejs_huajuan',
  'nodejs_kuaiying',
  'nodejs_labi',
  'nodejs_shandian',
  'nodejs_wogg',
  'nodejs_zhinan4k',
]

export function panSiteKeys(): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(PAN_KEY) ?? '[]') as string[]
    return new Set([...KNOWN_PAN_SITES, ...saved])
  } catch {
    return new Set(KNOWN_PAN_SITES)
  }
}

/** 某个站点播不动、且报的是网盘未登录，记下来，之后列表里打标 */
export function markPanSite(key: string): void {
  const s = panSiteKeys()
  if (s.has(key)) return
  s.add(key)
  try {
    localStorage.setItem(PAN_KEY, JSON.stringify([...s]))
  } catch {
    /* 存不下就算了，只是少个提示 */
  }
}

/**
 * CAT 的 vod_play_url 形如 `线路名$地址#线路名2$地址2`，
 * 剧集则是 `第01集$token#第02集$token`。这里统一拆成线路数组。
 */
export function parsePlayLines(vod: CatVod): { flag: string; episodes: { name: string; id: string }[] }[] {
  const froms = (vod.vod_play_from ?? '').split('$$$').filter(Boolean)
  const groups = (vod.vod_play_url ?? '').split('$$$').filter(Boolean)
  return groups.map((g, gi) => ({
    flag: froms[gi] ?? String(gi),
    episodes: g
      .split('#')
      .filter(Boolean)
      .map((seg) => {
        const i = seg.indexOf('$')
        if (i < 0) return { name: seg, id: seg }
        return { name: seg.slice(0, i), id: seg.slice(i + 1) }
      }),
  }))
}

/** 网盘线路的典型线路名，命中说明要登录网盘才能播 */
const PAN_LINE_WORD = /夸克|百度|阿里|115|123|天翼|UC|迅雷|网盘/i

export function isPanLine(flag: string): boolean {
  return PAN_LINE_WORD.test(flag)
}

/** 优先返回可直接播放（非网盘）的线路下标，全为网盘时退回 0 */
export function pickBestLine(lines: { flag: string }[]): number {
  if (lines.length === 0) return 0
  const i = lines.findIndex((l) => !isPanLine(l.flag))
  return i >= 0 ? i : 0
}

/** 本地串流代理端口，与 Rust 侧 stream_proxy 保持一致 */
export const STREAM_PROXY_PORT = 9989

/**
 * 所有外链统一走本地代理：
 * 1) 代理层会补 Referer / Safari UA，绕过直链站点的 403 防盗链
 * 2) 本地 http 源不受 CORS 与 ATS 限制
 * 3) m3u8 会被逐层改写，多级嵌套也能播
 * 4) CAT /play 返回的鉴权 header（Cookie/Referer）透传给代理，否则需登录的直链必 403
 */
export function viaProxy(url: string, header?: Record<string, string> | null): string {
  if (!url) return url
  if (url.startsWith(`http://127.0.0.1:${STREAM_PROXY_PORT}`)) return url
  let s = `http://127.0.0.1:${STREAM_PROXY_PORT}/s?u=${encodeURIComponent(url)}`
  if (header && Object.keys(header).length > 0) {
    s += `&h=${encodeURIComponent(JSON.stringify(header))}`
  }
  return s
}
