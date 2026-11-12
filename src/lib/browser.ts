/**
 * Edge 风格新标签页 + 应用内嵌浏览用到的小工具。
 * 内嵌网页走 Rust 侧的 child webview（原生视图），点快捷方式不跳系统浏览器。
 */

import { invoke } from '@tauri-apps/api/core'
import { useSyncExternalStore } from 'react'
import { inTauri } from './cat'

export async function openUrl(url: string, browser?: string | null): Promise<void> {
  if (!inTauri()) {
    window.open(url, '_blank', 'noopener')
    return
  }
  await invoke('open_url', { url, browser: browser ?? null })
}

/* ------------------------------------------------------- 应用内嵌网页（child webview） */

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

/** 页面内给原生视图留的位置（逻辑像素，与 CSS 像素一致） */
export const EMBED_BOX = {
  left: 86, // 左侧胶囊菜单宽度
  right: 12, // 主区右留白
  top: 116, // 顶栏 64 + 内嵌工具条 40 + 上留白 12
  bottom: 12,
}

export function embedBounds(): Bounds {
  return {
    x: EMBED_BOX.left,
    y: EMBED_BOX.top,
    w: window.innerWidth - EMBED_BOX.left - EMBED_BOX.right,
    h: window.innerHeight - EMBED_BOX.top - EMBED_BOX.bottom,
  }
}

export async function embedOpen(url: string, b: Bounds = embedBounds()): Promise<void> {
  if (!inTauri()) {
    window.open(url, '_blank', 'noopener')
    return
  }
  await invoke('embed_open', { url, ...b })
}

export async function embedSyncBounds(b: Bounds = embedBounds()): Promise<void> {
  if (!inTauri()) return
  try {
    await invoke('embed_set_bounds', { ...b })
  } catch {
    /* 已经没有内嵌页了 */
  }
}

export async function embedClose(): Promise<void> {
  if (!inTauri()) return
  try {
    await invoke('embed_close')
  } catch {
    /* ignore */
  }
}

export async function embedEval(js: string): Promise<void> {
  if (!inTauri()) return
  try {
    await invoke('embed_eval', { js })
  } catch {
    /* ignore */
  }
}

export const embedActions = {
  back: () => embedEval('history.back()'),
  reload: () => embedEval('location.reload()'),
}

/* ------------------------------------------------------------------ 快捷磁贴 */

const KEY = 'miralite.browser.tiles.v2'

export interface Tile {
  id: string
  name: string
  url: string
  /** 磁贴底色，直接用 CSS 颜色 */
  color: string
}

const DEFAULT_TILES: Tile[] = [
  { id: 't_qq', name: '腾讯视频', url: 'https://v.qq.com', color: '#00a4ff' },
  { id: 't_iqiyi', name: '爱奇艺', url: 'https://www.iqiyi.com', color: '#00be06' },
  { id: 't_youku', name: '优酷', url: 'https://www.youku.com', color: '#1ba5e0' },
  { id: 't_mgtv', name: '芒果TV', url: 'https://www.mgtv.com', color: '#ff6a00' },
  { id: 't_bili', name: '哔哩哔哩', url: 'https://www.bilibili.com', color: '#fb7299' },
]

const TILE_COLORS = ['#00a4ff', '#00be06', '#1ba5e0', '#ff6a00', '#fb7299', '#8b949e', '#e6162d']

function loadTiles(): Tile[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_TILES
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as Tile[]) : DEFAULT_TILES
  } catch {
    return DEFAULT_TILES
  }
}

let tiles: Tile[] = loadTiles()
const listeners = new Set<() => void>()

function commit(next: Tile[]) {
  tiles = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* 存不下就只留内存态 */
  }
  listeners.forEach((l) => l())
}

export function useTiles(): Tile[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => tiles,
    () => tiles,
  )
}

export const tileActions = {
  add(name: string, url: string) {
    const host = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    const t: Tile = {
      id: `t_${Date.now().toString(36)}`,
      name: name.trim() || host,
      url: url.startsWith('http') ? url : `https://${url}`,
      color: TILE_COLORS[tiles.length % TILE_COLORS.length],
    }
    commit([...tiles, t])
  },
  remove(id: string) {
    commit(tiles.filter((t) => t.id !== id))
  },
  reset() {
    commit(DEFAULT_TILES)
  },
}

/* ------------------------------------------------------------------ 搜索 */

export const SEARCH_ENGINE = {
  name: 'Bing',
  build: (q: string) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
}

/** 把「输入框内容」变成可打开地址：像域名的直接访问，否则当搜索词 */
export function normalizeInput(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return `https://${s}`
  return SEARCH_ENGINE.build(s)
}
