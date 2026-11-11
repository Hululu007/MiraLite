/**
 * CAT 会话层：站点清单、首页热门聚合、跨站搜索、条目缓存。
 *
 * 首页热门的数据来源是各站点的 home / category，条目本身带着站点的真实海报；
 * 但像「豆瓣」这种只做索引的站点是没有播放线路的，所以点击海报不直接播，
 * 而是拿片名去所有站点重新搜一遍，再从命中的结果里挑能播的一条进详情页。
 */

import {
  catActiveUrl,
  catCategory,
  catConfig,
  catHome,
  catSearch,
  catStart,
  catStatus,
  panSiteKeys,
  type CatSite,
  type CatVod,
} from './cat'

/** 旧版单地址存档：只用于迁移到新的多订阅源列表 */
export const CAT_URL_KEY = 'miralite.cat.url'
export const DEFAULT_CAT_URL = 'https://9280.kstore.vip/cat/index.js.md5'
const CAT_SUBS_KEY = 'miralite.cat.subscriptions.v1'

/** 一条影视订阅源。同一时间只有一条 enabled，首页热门/搜索都基于它。 */
export interface CatSubscription {
  id: string
  name: string
  url: string
  enabled: boolean
}

function newSubId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** 读出全部订阅源。首次使用会把旧的单地址迁进来。 */
export function readSubscriptions(): CatSubscription[] {
  try {
    const raw = localStorage.getItem(CAT_SUBS_KEY)
    if (raw) {
      const list = JSON.parse(raw) as CatSubscription[]
      if (Array.isArray(list) && list.length > 0) return list
    }
  } catch {
    /* 读坏就当没有 */
  }
  const legacy = localStorage.getItem(CAT_URL_KEY)
  const migrated: CatSubscription[] = [
    { id: newSubId(), name: '默认订阅', url: legacy || DEFAULT_CAT_URL, enabled: true },
  ]
  writeSubscriptions(migrated)
  return migrated
}

export function writeSubscriptions(list: CatSubscription[]): void {
  try {
    localStorage.setItem(CAT_SUBS_KEY, JSON.stringify(list))
    // 旧 key 同步成当前启用的地址，保证老代码路径也能读到
    const active = list.find((s) => s.enabled)
    if (active) localStorage.setItem(CAT_URL_KEY, active.url)
  } catch {
    /* 存不下不影响使用 */
  }
}

export function activeSubscription(): CatSubscription | null {
  const list = readSubscriptions()
  return list.find((s) => s.enabled) ?? list[0] ?? null
}

/** 新增一条订阅源；返回新列表。重名地址不会重复添加。 */
export function addSubscription(url: string, name?: string): CatSubscription[] {
  const target = url.trim()
  if (!target) throw new Error('订阅地址不能为空')
  const list = readSubscriptions()
  if (list.some((s) => s.url.trim() === target)) throw new Error('这个订阅地址已经添加过了')
  const item: CatSubscription = {
    id: newSubId(),
    name: name?.trim() || `订阅源 ${list.length + 1}`,
    url: target,
    enabled: false,
  }
  const next = [...list, item]
  writeSubscriptions(next)
  return next
}

export function renameSubscription(id: string, name: string): CatSubscription[] {
  const next = readSubscriptions().map((s) =>
    s.id === id ? { ...s, name: name.trim() || s.name } : s,
  )
  writeSubscriptions(next)
  return next
}

export function removeSubscription(id: string): CatSubscription[] {
  const list = readSubscriptions()
  const next = list.filter((s) => s.id !== id)
  if (next.length > 0 && !next.some((s) => s.enabled)) next[0] = { ...next[0], enabled: true }
  writeSubscriptions(next)
  return next
}

/** 清空订阅切换后失效的本地缓存（热门聚合 + 详情暂存） */
function clearCatCaches(): void {
  sitesPromise = null
  try {
    localStorage.removeItem('miralite.hot.v1')
    sessionStorage.removeItem('miralite.vodcache.v1')
  } catch {
    /* 清不掉就算了 */
  }
}

/**
 * 立即选中一个订阅源：只改本地列表、落盘并清缓存，不碰引擎。
 * 这样「点击选择」永远即时生效，连接失败也不会让选择看起来没反应。
 */
export function selectSubscription(id: string): CatSubscription[] {
  const list = readSubscriptions()
  if (!list.some((s) => s.id === id)) throw new Error('订阅源不存在')
  const next = list.map((s) => ({ ...s, enabled: s.id === id }))
  writeSubscriptions(next)
  clearCatCaches()
  return next
}

/**
 * 让引擎跑在指定订阅地址上（不修改列表）。返回解析到的站点数。
 * 已经是这个地址且引擎健康时直接返回，不重复重启。
 */
export async function connectSubscription(url: string): Promise<number> {
  const running = await catActiveUrl()
  const port = await catStatus()
  if (!port || running !== url) await catStart(url)
  const cfg = await catConfig()
  if (cfg.length === 0) throw new Error('这个订阅里没有任何可用站点')
  return cfg.length
}

/** 确保引擎在跑，且跑的是当前启用的订阅；不一致就切过去。 */
export async function ensureEngine(): Promise<void> {
  const sub = activeSubscription()
  if (!sub) throw new Error('还没有影视订阅源，去「设置 → 片源」添加一个')
  const port = await catStatus()
  const running = await catActiveUrl()
  if (!port || running !== sub.url) await catStart(sub.url)
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then((v) => {
      clearTimeout(t)
      resolve(v)
    }).catch((e) => {
      clearTimeout(t)
      reject(e)
    })
  })
}

let sitesPromise: Promise<CatSite[]> | null = null

/** 拿到全部站点（进程内缓存一次），引擎没起来就抛错 */
export function ensureSites(force = false): Promise<CatSite[]> {
  if (!sitesPromise || force) {
    sitesPromise = (async () => {
      // 引擎没起、或在用的是另一个订阅时，自动切到当前启用的源
      await ensureEngine()
      const cfg = await catConfig()
      if (cfg.length === 0) throw new Error('这个订阅里没有任何可用站点')
      return cfg
    })().catch((e) => {
      sitesPromise = null
      throw e
    })
  }
  return sitesPromise
}

export function siteOf(key: string, name?: string): CatSite {
  return { key, name: name || key, type: 3 }
}

export interface HotItem {
  siteKey: string
  siteName: string
  vod: CatVod
}

export interface HotSection {
  title: string
  subtitle: string
  items: HotItem[]
}

interface HotSource {
  key: string
  name: string
  title: string
  subtitle: string
  classId?: string
}

/**
 * 首页热门的取样站点：都是实测能出列表、海报齐全的站。
 * classId 有值就走分类，否则用站点首页。
 */
const HOT_SOURCES: HotSource[] = [
  { key: 'nodejs_douban', name: '豆瓣', title: '豆瓣热门', subtitle: '实时口碑榜' },
  { key: 'nodejs_douban', name: '豆瓣', title: '热播剧集', subtitle: '在追的都在这', classId: 'tv_hot' },
  { key: 'nodejs_qwmkv', name: '七味4K', title: '4K 热播', subtitle: '高码率片源' },
  { key: 'nodejs_guazi', name: '瓜子秒播', title: '秒播热榜', subtitle: '点开就播，不用等' },
  { key: 'nodejs_guanying', name: '观影4K', title: '观影精选', subtitle: '直链秒开' },
  { key: 'nodejs_wexDuBoKu', name: '独播', title: '独播推荐', subtitle: 'TMDB 高清海报' },
  { key: 'nodejs_pianku', name: '片库', title: '片库精选', subtitle: '老片新剧一网打尽' },
]

const HOT_KEY = 'miralite.hot.v1'
const HOT_TTL = 3 * 60 * 60 * 1000

export function readHotCache(): HotSection[] | null {
  try {
    const raw = localStorage.getItem(HOT_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as { at: number; sections: HotSection[] }
    if (!c?.sections?.length) return null
    return c.sections
  } catch {
    return null
  }
}

function writeHotCache(sections: HotSection[]) {
  try {
    localStorage.setItem(HOT_KEY, JSON.stringify({ at: Date.now(), sections }))
  } catch {
    /* 存不下不影响展示 */
  }
}

function hotValid(): boolean {
  try {
    const raw = localStorage.getItem(HOT_KEY)
    if (!raw) return false
    const c = JSON.parse(raw) as { at: number }
    return Date.now() - c.at < HOT_TTL
  } catch {
    return false
  }
}

export function isHotFresh(): boolean {
  return hotValid()
}

/** 拉一份新的热门聚合（多站点并发，单站失败就跳过；失败的源会补拉一轮） */
export async function buildHot(): Promise<HotSection[]> {
  // 必须用 config 里的真实站点对象：它带着 api 路径（如 /spider/douban/3），
  // 自己拼 key 会拼成 /spider/nodejs_douban/3 直接 404。
  const all = await ensureSites()
  const byKey = new Map(all.map((s) => [s.key, s]))

  const fetchOne = async (src: HotSource): Promise<HotSection | null> => {
    const site = byKey.get(src.key)
    if (!site) return null
    try {
      const r = src.classId
        ? await withTimeout(catCategory(site, src.classId, 1), 20000)
        : await withTimeout(catHome(site), 20000)
      const items = (r.list ?? [])
        .filter((v) => v.vod_name && v.vod_pic)
        .slice(0, 20)
        .map((v) => ({ siteKey: src.key, siteName: src.name, vod: v }))
      if (items.length === 0) return null
      return { title: src.title, subtitle: src.subtitle, items }
    } catch {
      return null
    }
  }

  // 第一轮：引擎刚起来时部分站点冷启动慢，会超时
  const first = await Promise.all(HOT_SOURCES.map(fetchOne))
  const result = HOT_SOURCES.map((_, i) => first[i])

  // 第二轮：只补拉第一轮没拿到内容的源，引擎此时已经热了
  const missIdx = result.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0)
  if (missIdx.length > 0) {
    const retried = await Promise.all(missIdx.map((i) => fetchOne(HOT_SOURCES[i])))
    missIdx.forEach((i, k) => {
      result[i] = retried[k]
    })
  }

  const valid = result.filter((s): s is HotSection => !!s)
  if (valid.length > 0) writeHotCache(valid)
  return valid
}

/** 可直接播放（免登录）的站点排序，靠前的先搜，命中最快 */
const PREFERRED = [
  'nodejs_guazi',
  'nodejs_guanying',
  'nodejs_qwmkv',
  'nodejs_pianku',
  'nodejs_wexDuBoKu',
  'nodejs_bobo',
  'nodejs_wencai',
  'nodejs_libvio',
  'nodejs_hanxiaoquan',
  'nodejs_muou',
  'nodejs_jutou',
  'nodejs_wexYueYue',
  'nodejs_appv7xiaoyouzi',
  'nodejs_rebo',
]

/** 免登录直链站的优先度，越小越优先 */
export function preferredRank(key: string): number {
  const i = PREFERRED.indexOf(key)
  return i < 0 ? 100 : i
}

export interface SearchHit {
  siteKey: string
  siteName: string
  vod: CatVod
  score: number
  pan: boolean
}

function nameScore(target: string, name: string): number {
  const a = target.replace(/\s+/g, '')
  const b = name.replace(/\s+/g, '')
  if (a === b) return 3
  if (a.startsWith(b) || b.startsWith(a)) return 2
  if (a.includes(b) || b.includes(a)) return 1
  return 0
}

/**
 * 跨站搜索：按偏好顺序挑站点并发搜，每搜完一个就回调一批，
 * 页面可以边搜边展示，不用等全部站点回来。
 */
export async function searchAcross(
  name: string,
  hooks: { onBatch?: (hits: SearchHit[]) => void; onProgress?: (done: number, total: number) => void } = {},
  shouldStop: () => boolean = () => false,
): Promise<SearchHit[]> {
  const all = await ensureSites()
  const pan = panSiteKeys()
  const usable = all.filter((s) => s.searchable !== 0 && s.key !== 'nodejs_douban')
  const queue = [...usable]
    .sort(
      (a, b) =>
        preferredRank(a.key) - preferredRank(b.key) ||
        Number(pan.has(a.key)) - Number(pan.has(b.key)),
    )
    .slice(0, 20)

  const total = queue.length
  let done = 0
  const collected: SearchHit[] = []

  const worker = async () => {
    for (;;) {
      if (shouldStop()) return
      const s = queue.shift()
      if (!s) return
      try {
        const r = await withTimeout(catSearch(s, name, 1), 9000)
        const hits = (r.list ?? [])
          .filter((v) => v.vod_name)
          .slice(0, 12)
          .map((v) => ({
            siteKey: s.key,
            siteName: s.name,
            vod: v,
            score: nameScore(v.vod_name, name),
            pan: pan.has(s.key),
          }))
        if (hits.length > 0 && !shouldStop()) {
          collected.push(...hits)
          hooks.onBatch?.(hits)
        }
      } catch {
        /* 这个站点搜不动，跳过 */
      } finally {
        done += 1
        hooks.onProgress?.(done, total)
      }
    }
  }

  await Promise.all([worker(), worker(), worker(), worker(), worker()])
  return collected
}

const VOD_KEY = 'miralite.vodcache.v1'
const VOD_MAX = 60

interface VodCacheEntry {
  siteKey: string
  siteName: string
  vod: CatVod
}

function readVodCache(): Record<string, VodCacheEntry> {
  try {
    return JSON.parse(sessionStorage.getItem(VOD_KEY) ?? '{}') as Record<string, VodCacheEntry>
  } catch {
    return {}
  }
}

export function cacheKey(siteKey: string, vodId: string): string {
  return `${siteKey}::${vodId}`
}

/** 点海报时先把条目存一份，详情页就能立刻渲染出海报和标题 */
export function rememberVod(siteKey: string, siteName: string, vod: CatVod): void {
  try {
    const box = readVodCache()
    box[cacheKey(siteKey, vod.vod_id)] = { siteKey, siteName, vod }
    const keys = Object.keys(box)
    if (keys.length > VOD_MAX) {
      for (const k of keys.slice(0, keys.length - VOD_MAX)) delete box[k]
    }
    sessionStorage.setItem(VOD_KEY, JSON.stringify(box))
  } catch {
    /* 缓存失败就退化成详情页现拉 */
  }
}

export function recallVod(siteKey: string, vodId: string): VodCacheEntry | null {
  return readVodCache()[cacheKey(siteKey, vodId)] ?? null
}
