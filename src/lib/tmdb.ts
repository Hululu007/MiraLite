/**
 * TMDB 影视数据源。
 *
 * 官方 api.themoviedb.org 在国内被 DNS 污染不可达，实际使用备用官方域名
 * api.tmdb.org（AWS CloudFront），两种鉴权都支持：
 *   - v3 api_key=<32位key>
 *   - v4 Authorization: Bearer <eyJ... read token>
 *
 * 鉴权与请求都在 Rust 侧完成（Key 存本地配置、不进前端源码/二进制），
 * 前端只通过 Tauri IPC 拿规范化后的榜单数据。
 * 未配置 Key 时自动回退到内置的 TMDB 真实数据快照，保证首页始终有内容。
 */
import { invoke } from '@tauri-apps/api/core'
import { TMDB_SNAPSHOT } from '../data/tmdbSnapshot'
import { inTauri } from './cat'

export interface TmdbItem {
  id: number
  mediaType: 'movie' | 'tv'
  title: string
  originalTitle: string
  poster: string
  backdrop: string
  year: string
  rating: number
  overview: string
}

export interface TmdbGroup {
  key: string
  label: string
  items: TmdbItem[]
}

export interface TmdbConfigView {
  configured: boolean
  api_key_hint: string
  base_url: string
  language: string
}

export interface TmdbTestResult {
  ok: boolean
  count: number
  samples: string[]
  message: string
}

export const TMDB_DEFAULT_BASE = 'https://api.tmdb.org/3'

export async function tmdbGetConfig(): Promise<TmdbConfigView> {
  if (!inTauri()) {
    return {
      configured: false,
      api_key_hint: '',
      base_url: TMDB_DEFAULT_BASE,
      language: 'zh-CN',
    }
  }
  return (await invoke('tmdb_get_config')) as TmdbConfigView
}

export async function tmdbSetConfig(
  apiKey: string,
  baseUrl?: string,
  language?: string,
): Promise<TmdbConfigView> {
  const cfg = (await invoke('tmdb_set_config', {
    apiKey,
    baseUrl: baseUrl ?? null,
    language: language ?? null,
  })) as TmdbConfigView
  // 配置变了，榜单缓存立即失效，下次进首页按新配置拉取
  clearRankingsCache()
  return cfg
}

export async function tmdbTest(): Promise<TmdbTestResult> {
  return (await invoke('tmdb_test')) as TmdbTestResult
}

export interface TmdbRankings {
  groups: TmdbGroup[]
  live: boolean
  /** 数据实际拉取时间（毫秒时间戳），用于界面显示「更新于」 */
  updatedAt?: number
  /** true = 正在用过期缓存顶着，后台已发起静默刷新 */
  stale?: boolean
}

/* ============================ 榜单缓存 ============================
 * TMDB 榜单一天只更新几次，没必要每次进首页都并发拉 5 个接口。
 * - 内存 + localStorage 双缓存，TTL 6 小时
 * - 缓存按配置指纹隔离，改 Key / 地址 / 语言自动失效
 * - 过期时先返回旧数据秒开，后台静默刷新并通知订阅者无缝更新
 * - 同一时刻只发一个真实请求（in-flight 去重），失败保留旧数据
 * ================================================================== */

const RANKINGS_CACHE_KEY = 'miralite.tmdb.rankings.v1'
const RANKINGS_TTL = 6 * 60 * 60 * 1000

interface RankingsCache {
  fingerprint: string
  savedAt: number
  groups: TmdbGroup[]
  live: boolean
}

let memCache: RankingsCache | null = null
let inFlight: Promise<TmdbRankings> | null = null
const listeners = new Set<(data: TmdbRankings) => void>()

function configFingerprint(cfg: TmdbConfigView | null): string {
  return cfg?.configured
    ? `${cfg.base_url}|${cfg.language}|${cfg.api_key_hint}`
    : `offline|${TMDB_DEFAULT_BASE}|zh-CN`
}

function readCache(): RankingsCache | null {
  if (memCache) return memCache
  try {
    const raw = localStorage.getItem(RANKINGS_CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as RankingsCache
    if (!c || typeof c.savedAt !== 'number' || typeof c.fingerprint !== 'string') return null
    if (!Array.isArray(c.groups) || c.groups.length === 0) return null
    memCache = c
    return c
  } catch {
    return null
  }
}

function writeCache(c: RankingsCache): void {
  memCache = c
  try {
    localStorage.setItem(RANKINGS_CACHE_KEY, JSON.stringify(c))
  } catch {
    /* 存储配额不足时忽略，内存缓存仍然生效 */
  }
}

/** 清除榜单缓存（保存配置 / 手动清缓存时调用） */
export function clearRankingsCache(): void {
  memCache = null
  try {
    localStorage.removeItem(RANKINGS_CACHE_KEY)
  } catch {
    /* ignore */
  }
}

/** 订阅后台静默刷新完成后的新榜单，供首页无缝更新 */
export function onRankingsRefresh(fn: (data: TmdbRankings) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function cached(c: RankingsCache, stale = false): TmdbRankings {
  return { groups: c.groups, live: c.live, updatedAt: c.savedAt, stale }
}

function offline(): TmdbRankings {
  return { groups: TMDB_SNAPSHOT, live: false, updatedAt: Date.now() }
}

async function fetchLive(fp: string): Promise<TmdbRankings> {
  const data = (await invoke('tmdb_rankings')) as TmdbRankings
  if (!data?.groups?.length) throw new Error('TMDB 榜单为空')
  const now = Date.now()
  const result: TmdbRankings = { ...data, updatedAt: now }
  writeCache({
    fingerprint: fp,
    savedAt: now,
    groups: result.groups,
    live: result.live,
  })
  for (const fn of listeners) {
    try {
      fn(result)
    } catch {
      /* 单个订阅者出错不影响其他 */
    }
  }
  return result
}

/** 同一时刻只允许一个拉取请求，并发调用共享同一个 Promise */
function startFetch(fp: string): Promise<TmdbRankings> {
  if (!inFlight) {
    inFlight = fetchLive(fp).finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

/**
 * 获取榜单（带缓存）。
 *   - 缓存新鲜：直接返回，一次网络请求都不发
 *   - 缓存过期：先返回旧数据渲染，后台静默刷新并通知界面更新
 *   - 无缓存 / force：前台拉取；失败时退回旧缓存或内置快照
 */
export async function tmdbRankings(opts: { force?: boolean } = {}): Promise<TmdbRankings> {
  if (!inTauri()) return offline()

  let cfg: TmdbConfigView | null = null
  try {
    cfg = await tmdbGetConfig()
  } catch {
    /* 读配置失败按未配置处理 */
  }
  const fp = configFingerprint(cfg)
  const cache = readCache()
  const usable = !!cache && cache.fingerprint === fp && cache.live
  const fresh = usable && Date.now() - cache!.savedAt < RANKINGS_TTL

  // 手动强制刷新：忽略缓存，失败时尽量保留旧数据
  if (opts.force) {
    try {
      return await startFetch(fp)
    } catch {
      return usable ? cached(cache!, true) : offline()
    }
  }

  // 核心优化：缓存新鲜，直接返回，零网络请求
  if (fresh) return cached(cache!)

  // 过期但有缓存：先把旧数据交出去渲染，后台刷新完再通知界面更新
  if (usable) {
    void startFetch(fp).catch(() => {
      /* 刷新失败就继续用旧数据，不打扰用户 */
    })
    return cached(cache!, true)
  }

  // 完全没有可用缓存：前台拉取，首屏需要等待
  try {
    return await startFetch(fp)
  } catch {
    return offline()
  }
}
