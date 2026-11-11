import { useSyncExternalStore } from 'react'
import type { LibraryState, MediaItem, ProgressEntry, Source } from './types'

const KEY = 'miralite.state.v1'

interface StoreState extends LibraryState {
  /** 由用户导入的源解析出的频道/媒体条目 */
  channels: MediaItem[]
}

const initialState: StoreState = {
  sources: [],
  watchlist: [],
  progress: {},
  prefs: { tastePrint: true, autoplayNext: true, preferQuality: 'auto' },
  channels: [],
}

let state: StoreState = load()
const listeners = new Set<() => void>()

function load(): StoreState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return initialState
    const parsed = JSON.parse(raw) as Partial<StoreState>
    return {
      ...initialState,
      ...parsed,
      prefs: { ...initialState.prefs, ...parsed.prefs },
      channels: parsed.channels ?? [],
    }
  } catch {
    return initialState
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* 存储不可用时静默降级为内存态 */
  }
}

function set(updater: (prev: StoreState) => StoreState) {
  state = updater(state)
  persist()
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return state
}

export function useLibrary(): StoreState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export const actions = {
  addSource(source: Omit<Source, 'id' | 'addedAt' | 'enabled' | 'itemCount'> & { itemCount?: number }) {
    const next: Source = {
      ...source,
      id: `src_${Date.now().toString(36)}`,
      addedAt: Date.now(),
      enabled: true,
      itemCount: source.itemCount ?? 0,
    }
    set((s) => ({ ...s, sources: [...s.sources, next] }))
    return next
  },

  updateSource(id: string, patch: Partial<Source>) {
    set((s) => ({
      ...s,
      sources: s.sources.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    }))
  },

  removeSource(id: string) {
    set((s) => ({
      ...s,
      sources: s.sources.filter((x) => x.id !== id),
      channels: s.channels.filter((c) => c.sourceId !== id),
    }))
  },

  /** 用某个源最新解析出来的条目替换该源原有条目 */
  setSourceChannels(sourceId: string, items: MediaItem[]) {
    set((s) => ({
      ...s,
      channels: [...s.channels.filter((c) => c.sourceId !== sourceId), ...items],
      sources: s.sources.map((x) => (x.id === sourceId ? { ...x, itemCount: items.length } : x)),
    }))
  },

  setProgress(itemId: string, entry: ProgressEntry) {
    set((s) => ({ ...s, progress: { ...s.progress, [itemId]: entry } }))
  },

  clearProgress(itemId: string) {
    set((s) => {
      const next = { ...s.progress }
      delete next[itemId]
      return { ...s, progress: next }
    })
  },

  toggleWatchlist(itemId: string) {
    set((s) => ({
      ...s,
      watchlist: s.watchlist.includes(itemId)
        ? s.watchlist.filter((x) => x !== itemId)
        : [...s.watchlist, itemId],
    }))
  },

  setPrefs(patch: Partial<LibraryState['prefs']>) {
    set((s) => ({ ...s, prefs: { ...s.prefs, ...patch } }))
  },
}
