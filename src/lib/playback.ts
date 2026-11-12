/**
 * 播放进度记忆：CAT 真实影视看到哪一集、哪一秒，全部只留在本机。
 *
 * 与追剧清单（chase.ts）分开存：
 * - chase 记「这部剧最近看的是第几集」，给追剧页用；
 * - playback 记「这一集具体看到第几分钟」，给续播与首页「继续观看」用。
 *
 * 一集看完（进度 ≥ 95%）就删掉记录，避免首页一直挂着已看完的片子。
 */
import { useSyncExternalStore } from 'react'
import type { CatVod } from './cat'

export interface PlaybackEntry {
  /** `${siteKey}::${vodId}` */
  key: string
  siteKey: string
  siteName: string
  vodId: string
  name: string
  pic?: string
  remarks?: string
  /** 上次播放的线路名（CAT 的 vod_play_from） */
  lineFlag: string
  /** 上次播放的集名与集 id */
  epName: string
  epId: string
  /** 该集在当前线路里的下标，续播时用来定位「下一集」 */
  epIndex: number
  position: number
  duration: number
  updatedAt: number
}

const KEY = 'miralite.playback.v1'
const MAX = 60
/** 进度超过这个比例就算看完，不再续播 */
const DONE_RATIO = 0.95
/** 少于这个秒数不值得记（刚点开就退出） */
const MIN_SECONDS = 5

let state: PlaybackEntry[] = load()
const listeners = new Set<() => void>()

function load(): PlaybackEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .filter(
        (e): e is PlaybackEntry =>
          !!e &&
          typeof e === 'object' &&
          typeof (e as PlaybackEntry).key === 'string' &&
          typeof (e as PlaybackEntry).name === 'string',
      )
      .slice(0, MAX)
  } catch {
    return []
  }
}

function commit(next: PlaybackEntry[]) {
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

export function usePlayback(): PlaybackEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function playbackKey(siteKey: string, vodId: string): string {
  return `${siteKey}::${vodId}`
}

export function getPlayback(siteKey: string, vodId: string): PlaybackEntry | null {
  return state.find((e) => e.key === playbackKey(siteKey, vodId)) ?? null
}

export interface PlaybackSeed {
  siteKey: string
  siteName: string
  vod: CatVod
  lineFlag: string
  epName: string
  epId: string
  epIndex: number
}

/** 记录某一集的播放进度；看完就删记录 */
export function savePlayback(seed: PlaybackSeed, position: number, duration: number): void {
  const key = playbackKey(seed.siteKey, seed.vod.vod_id)
  const pos = Math.max(0, Math.floor(position || 0))
  const dur = Math.max(0, Math.floor(duration || 0))
  if (dur > 0 && pos / dur >= DONE_RATIO) {
    if (state.some((e) => e.key === key)) commit(state.filter((e) => e.key !== key))
    return
  }
  if (pos < MIN_SECONDS) {
    // 还没真正看进去，只保留原有记录不动
    return
  }
  const prev = state.find((e) => e.key === key)
  const entry: PlaybackEntry = {
    key,
    siteKey: seed.siteKey,
    siteName: seed.siteName,
    vodId: seed.vod.vod_id,
    name: seed.vod.vod_name,
    pic: seed.vod.vod_pic || prev?.pic,
    remarks: seed.vod.vod_remarks || prev?.remarks,
    lineFlag: seed.lineFlag,
    epName: seed.epName,
    epId: seed.epId,
    epIndex: seed.epIndex,
    position: pos,
    duration: dur,
    updatedAt: Date.now(),
  }
  commit([entry, ...state.filter((e) => e.key !== key)])
}

export function removePlayback(key: string): void {
  commit(state.filter((e) => e.key !== key))
}

export function clearPlayback(): void {
  commit([])
}

/** 首页「继续观看」用：最近看过的前 N 条 */
export function recentPlayback(limit = 12): PlaybackEntry[] {
  return [...state].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
}

/** 秒数格式化成 12:34 / 1:02:03 */
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`
}
