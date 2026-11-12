/**
 * 站点开关：用户可以在设置里禁用某些站点，禁用的站点不再参与
 * 首页热门聚合、跨站搜索与详情页线路兜底。
 *
 * 只存 key 集合，不动 CAT 引擎配置；换订阅/重启都保留。
 */
import { useSyncExternalStore } from 'react'
import type { CatSite } from './cat'

const KEY = 'miralite.site.disabled.v1'

let state: Set<string> = load()
const listeners = new Set<() => void>()

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return new Set()
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

function commit(next: Set<string>) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]))
  } catch {
    /* 存不下只是少个记忆 */
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

export function useDisabledSites(): Set<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function isSiteDisabled(key: string): boolean {
  return state.has(key)
}

export function toggleSiteDisabled(key: string): Set<string> {
  const next = new Set(state)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  commit(next)
  return next
}

export function setSitesDisabled(keys: string[]): void {
  commit(new Set(keys))
}

export function clearDisabledSites(): void {
  commit(new Set())
}

export function disabledSiteCount(): number {
  return state.size
}

/** 过滤掉用户禁用的站点；全被禁用时返回空数组由调用方兜底 */
export function applySitePrefs(sites: CatSite[]): CatSite[] {
  if (state.size === 0) return sites
  return sites.filter((s) => !state.has(s.key))
}
