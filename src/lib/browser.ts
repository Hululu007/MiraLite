/**
 * Edge 风格新标签页用到的小工具：打开外链、快捷磁贴存储。
 * MiraLite 没有内嵌浏览器内核，所以磁贴和搜索都交给系统浏览器打开。
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

export async function hasApp(name: string): Promise<boolean> {
  if (!inTauri()) return false
  try {
    return (await invoke('has_app', { name })) as boolean
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ 快捷磁贴 */

const KEY = 'miralite.browser.tiles.v1'

export interface Tile {
  id: string
  name: string
  url: string
  /** 磁贴底色，直接用 CSS 颜色 */
  color: string
}

const DEFAULT_TILES: Tile[] = [
  { id: 't_bili', name: '哔哩哔哩', url: 'https://www.bilibili.com', color: '#fb7299' },
  { id: 't_zhihu', name: '知乎', url: 'https://www.zhihu.com', color: '#0066ff' },
  { id: 't_douban', name: '豆瓣', url: 'https://www.douban.com', color: '#2e963b' },
  { id: 't_github', name: 'GitHub', url: 'https://github.com', color: '#8b949e' },
  { id: 't_ytb', name: 'YouTube', url: 'https://www.youtube.com', color: '#ff0033' },
  { id: 't_taobao', name: '淘宝', url: 'https://www.taobao.com', color: '#ff5000' },
  { id: 't_weibo', name: '微博', url: 'https://weibo.com', color: '#e6162d' },
  { id: 't_tmdb', name: 'TMDB', url: 'https://www.themoviedb.org', color: '#01b4e4' },
]

const TILE_COLORS = ['#0078d4', '#fb7299', '#0066ff', '#2e963b', '#8b949e', '#ff5000', '#e6162d', '#01b4e4']

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
  // example.com / a.b.cn/path 这类直接当网址
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return `https://${s}`
  return SEARCH_ENGINE.build(s)
}
