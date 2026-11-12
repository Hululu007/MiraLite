/**
 * 本地媒体库：扫描本机目录、按 TMDB 刮削、转成 MediaItem 落进片库。
 *
 * 只读磁盘，不移动不改名；播放走 asset 协议（tauri.conf 已开 assetProtocol）。
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { inTauri } from './cat'
import type { TmdbItem } from './tmdb'
import type { MediaItem } from './types'

export interface ScannedFile {
  path: string
  fileName: string
  title: string
  kind: 'movie' | 'series'
  year?: number
  season?: number
  episode?: number
  folder: string
}

/** 扫描结果聚合后的一个片子（电影 1 个文件，剧集 1 组文件） */
export interface LocalGroup {
  key: string
  title: string
  kind: 'movie' | 'series'
  year?: number
  files: ScannedFile[]
}

function djb2(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i += 1) h = (h * 33 + s.charCodeAt(i)) % 0x7fffffff
  return h
}

export function mediaId(key: string): string {
  return `local-${djb2(key).toString(36)}`
}

export async function pickFolder(): Promise<string> {
  if (!inTauri()) throw new Error('只有打包后的 App 能调系统选择框')
  return (await invoke('pick_media_folder')) as string
}

export async function scanDir(path: string): Promise<ScannedFile[]> {
  if (!inTauri()) throw new Error('扫描本地目录需要在 App 里运行')
  const raw = (await invoke('scan_media_dir', { path })) as Array<Record<string, unknown>>
  return raw.map((f) => ({
    path: String(f.path ?? ''),
    fileName: String(f.fileName ?? ''),
    title: String(f.title ?? ''),
    kind: (f.kind === 'series' ? 'series' : 'movie') as ScannedFile['kind'],
    year: typeof f.year === 'number' ? f.year : undefined,
    season: typeof f.season === 'number' ? f.season : undefined,
    episode: typeof f.episode === 'number' ? f.episode : undefined,
    folder: String(f.folder ?? ''),
  }))
}

export async function searchTmdb(query: string, kind: 'movie' | 'series'): Promise<TmdbItem[]> {
  if (!inTauri()) throw new Error('刮削需要在 App 里运行')
  const raw = (await invoke('tmdb_search', { query, kind })) as TmdbItem[]
  return Array.isArray(raw) ? raw : []
}

/** 电影一文件一条，剧集按标题合并成一条 */
export function groupScanned(files: ScannedFile[]): LocalGroup[] {
  const map = new Map<string, LocalGroup>()
  for (const f of files) {
    const title = (f.title || f.fileName.replace(/\.[^.]+$/, '')).trim()
    if (!title) continue
    // 剧集优先用所在文件夹做标题（常见「剧名/剧名.S01E01.mkv」结构）
    const guess =
      f.kind === 'series' && f.folder && !/season|s\d{1,2}$/i.test(f.folder) && f.folder.length > 1
        ? f.folder
        : title
    const key = `${f.kind}:${guess.toLowerCase()}`
    const exist = map.get(key)
    if (exist) {
      exist.files.push(f)
      if (!exist.year && f.year) exist.year = f.year
    } else {
      map.set(key, { key, title: guess, kind: f.kind, year: f.year, files: [f] })
    }
  }
  // 剧集内按集号排序
  return [...map.values()].map((g) => ({
    ...g,
    files: [...g.files].sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0)),
  }))
}

export interface ScrapeResult {
  group: LocalGroup
  tmdb?: TmdbItem
  error?: string
}

/** 逐条刮削：拿标题（+年份）去 TMDB 搜，取第一条 */
export async function scrapeGroups(
  groups: LocalGroup[],
  onProgress?: (done: number, total: number, current: ScrapeResult) => void,
): Promise<ScrapeResult[]> {
  const out: ScrapeResult[] = []
  for (let i = 0; i < groups.length; i += 1) {
    const g = groups[i]
    let tmdb: TmdbItem | undefined
    let error: string | undefined
    try {
      const hits = await searchTmdb(g.title, g.kind)
      if (hits.length > 0) {
        // 有年份时优先同年份的结果
        tmdb = (g.year && hits.find((h) => h.year === String(g.year))) || hits[0]
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
    const r: ScrapeResult = { group: g, tmdb, error }
    out.push(r)
    onProgress?.(i + 1, groups.length, r)
  }
  return out
}

/** 把刮削结果转成片库条目 */
export function toMediaItems(results: ScrapeResult[], sourceId: string): MediaItem[] {
  return results.map(({ group, tmdb }) => {
    const first = group.files[0]
    const hue = djb2(group.title) % 360
    const item: MediaItem = {
      id: mediaId(group.key),
      kind: group.kind,
      title: tmdb?.title || group.title,
      year: tmdb?.year ? Number(tmdb.year) || group.year : group.year,
      genres: ['本地'],
      rating: tmdb?.rating || undefined,
      overview: tmdb?.overview || `${group.files.length} 个文件 · 来自本地目录`,
      hue,
      streamUrl: first ? convertFileSrc(first.path) : undefined,
      sourceId,
      group: '本地媒体库',
      poster: tmdb?.poster || undefined,
      seasons: group.kind === 'series' ? 1 : undefined,
      episodes: group.kind === 'series' ? group.files.length : undefined,
    }
    return item
  })
}
