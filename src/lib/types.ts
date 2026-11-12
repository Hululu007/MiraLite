export type MediaKind = 'movie' | 'series' | 'channel'

export interface MediaItem {
  id: string
  kind: MediaKind
  title: string
  year?: number
  genres: string[]
  rating?: number
  runtime?: number
  overview?: string
  /** 用于生成确定性渐变海报的色相 */
  hue: number
  /** TMDB 刮削来的海报地址（可选，有就优先渲染图片） */
  poster?: string
  streamUrl?: string
  sourceId?: string
  group?: string
  logo?: string
  /** 剧集专属 */
  seasons?: number
  episodes?: number
}

export type SourceKind = 'm3u' | 'xtream' | 'local'

export interface Source {
  id: string
  kind: SourceKind
  name: string
  url: string
  username?: string
  password?: string
  addedAt: number
  enabled: boolean
  itemCount: number
}

export interface ProgressEntry {
  position: number
  duration: number
  updatedAt: number
}

export interface Prefs {
  /** 推荐行偏好：偏好类型加权 */
  tastePrint: boolean
  autoplayNext: boolean
  preferQuality: 'auto' | '1080p' | '720p'
}

export interface LibraryState {
  sources: Source[]
  watchlist: string[]
  progress: Record<string, ProgressEntry>
  prefs: Prefs
}

export interface CatalogState {
  items: MediaItem[]
  byId: Record<string, MediaItem>
  channels: MediaItem[]
  movies: MediaItem[]
  series: MediaItem[]
}
