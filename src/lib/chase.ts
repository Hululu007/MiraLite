/**
 * 追剧清单：CAT 真实影视的本地追剧记录。
 * 播放任意剧集会自动写入；也可以在详情页 / 首页热门里手动加入。
 * 与演示媒体库的 watchlist 分开存，避免和 CAT 条目 id 混在一起。
 */
import { useSyncExternalStore } from 'react'
import type { CatVod } from './cat'
import { cacheKey } from './catSession'

export interface ChaseEntry {
  /** `${siteKey}::${vodId}` */
  key: string
  siteKey: string
  siteName: string
  vodId: string
  name: string
  pic?: string
  year?: string
  remarks?: string
  /** 最近一次播放的集名 */
  episode?: string
  /** 当前线路的总集数 */
  episodeCount?: number
  /** 星标收藏 */
  starred: boolean
  updatedAt: number
}

const KEY = 'miralite.chase.v1'
const MAX = 120

let state: ChaseEntry[] = load()
const listeners = new Set<() => void>()

function load(): ChaseEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .filter(
        (e): e is ChaseEntry =>
          !!e &&
          typeof e === 'object' &&
          typeof (e as ChaseEntry).key === 'string' &&
          typeof (e as ChaseEntry).name === 'string',
      )
      .slice(0, MAX)
  } catch {
    return []
  }
}

function commit(next: ChaseEntry[]) {
  state = next.slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* 存储不可用时保持内存态 */
  }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

function getSnapshot() {
  return state
}

export function useChase(): ChaseEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export interface ChaseSeed {
  siteKey: string
  siteName: string
  vod: CatVod
  episode?: string
  episodeCount?: number
}

/** 播放或手动点「追剧」时写入；重复播放只更新时间与集数，不丢星标 */
export function trackChase(seed: ChaseSeed): void {
  const key = cacheKey(seed.siteKey, seed.vod.vod_id)
  const prev = state.find((e) => e.key === key)
  const entry: ChaseEntry = {
    key,
    siteKey: seed.siteKey,
    siteName: seed.siteName,
    vodId: seed.vod.vod_id,
    name: seed.vod.vod_name,
    pic: seed.vod.vod_pic || prev?.pic,
    year: seed.vod.vod_year || prev?.year,
    remarks: seed.vod.vod_remarks || prev?.remarks,
    episode: seed.episode ?? prev?.episode,
    episodeCount: seed.episodeCount ?? prev?.episodeCount,
    starred: prev?.starred ?? false,
    updatedAt: Date.now(),
  }
  commit([entry, ...state.filter((e) => e.key !== key)])
}

export function toggleStar(key: string): void {
  commit(
    state.map((e) =>
      e.key === key ? { ...e, starred: !e.starred, updatedAt: Date.now() } : e,
    ),
  )
}

export function removeChase(key: string): void {
  commit(state.filter((e) => e.key !== key))
}

export function clearChase(): void {
  commit([])
}
