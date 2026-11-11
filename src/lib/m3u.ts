import type { MediaItem } from './types'

const ATTR_RE = /([\w-]+)="([^"]*)"/g

function parseAttrs(line: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  let m: RegExpExecArray | null
  ATTR_RE.lastIndex = 0
  while ((m = ATTR_RE.exec(line))) attrs[m[1].toLowerCase()] = m[2]
  return attrs
}

function hashHue(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

/**
 * 解析 M3U / M3U8 播放源文本为频道列表。
 * 只处理 #EXTINF 行与其后紧随的 URL 行，其余元数据忽略。
 */
export function parseM3U(text: string, sourceId?: string): MediaItem[] {
  const lines = text.split(/\r?\n/)
  const items: MediaItem[] = []
  let pending: { attrs: Record<string, string>; name: string } | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    if (line.startsWith('#EXTINF')) {
      const commaAt = line.lastIndexOf(',')
      const name = commaAt >= 0 ? line.slice(commaAt + 1).trim() : '未命名频道'
      pending = { attrs: parseAttrs(line), name }
      continue
    }

    if (line.startsWith('#')) continue

    if (pending) {
      const { attrs, name } = pending
      const group = attrs['group-title'] || '未分组'
      items.push({
        id: `ch_${sourceId ?? 'local'}_${items.length}_${hashHue(name + line)}`,
        kind: 'channel',
        title: name || attrs['tvg-name'] || '未命名频道',
        genres: [group],
        hue: hashHue(name),
        streamUrl: line,
        sourceId,
        group,
        logo: attrs['tvg-logo'],
      })
      pending = null
    }
  }

  return items
}

/**
 * 识别「不是播放列表」的常见返回内容，给出可操作的诊断原因。
 * 返回 null 表示内容形态正常，可以继续尝试解析。
 */
export function diagnoseNonPlaylist(text: string): string | null {
  const t = text.trim()
  if (!t) return '服务器返回了空内容'
  if (/^[a-f0-9]{32}$/i.test(t))
    return '这个地址返回的是 32 位 MD5 校验值，不是播放列表。TVBox/CAT 的 .md5 只是配置指纹，应换成真正的 M3U/TXT 订阅地址'
  if (/^[a-f0-9]{40}$/i.test(t) || /^[a-f0-9]{64}$/i.test(t))
    return '这个地址返回的是哈希校验值，不是播放列表'
  if (/^\s*(var|let|const|function|import)\s/.test(t))
    return '这个地址返回的是 JS 脚本（TVBox/CAT 私有接口），需要在 Android 端 Spider 环境里运行，桌面端无法直接解析'
  if (/^\s*[[{]/.test(t)) return '这个地址返回的是 JSON 数据，当前只支持 M3U/M3U8/TXT 文本播放列表'
  if (/^\s*<(!doctype|html|\?xml|head|body)/i.test(t))
    return '这个地址返回的是网页 HTML，不是播放列表'
  return null
}

/**
 * 解析 TVBox 风格的纯文本直播源（TXT）。
 * 形如：`央视频道,#genre#` 分组行 + `CCTV-1,http://xxx` 条目行。
 */
export function parseTXT(text: string, sourceId?: string): MediaItem[] {
  const items: MediaItem[] = []
  let group = '未分组'
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const commaAt = line.indexOf(',')
    if (commaAt < 0) continue
    const name = line.slice(0, commaAt).trim()
    const target = line.slice(commaAt + 1).trim()
    if (!name || !target) continue
    if (target.includes('#genre#')) {
      group = name
      continue
    }
    if (!/^[a-z]+:\/\//i.test(target)) continue
    items.push({
      id: `ch_${sourceId ?? 'local'}_${items.length}_${hashHue(name + target)}`,
      kind: 'channel',
      title: name,
      genres: [group],
      hue: hashHue(name),
      streamUrl: target,
      sourceId,
      group,
    })
  }
  return items
}

/** 统一入口：依次尝试 M3U 与 TXT 两种主流格式 */
export function parsePlaylist(text: string, sourceId?: string): MediaItem[] {
  const m3u = parseM3U(text, sourceId)
  if (m3u.length > 0) return m3u
  return parseTXT(text, sourceId)
}

export function groupByGenre(items: MediaItem[]): Map<string, MediaItem[]> {
  const map = new Map<string, MediaItem[]>()
  for (const item of items) {
    const g = item.group || item.genres[0] || '未分组'
    const arr = map.get(g) ?? []
    arr.push(item)
    map.set(g, arr)
  }
  return map
}

/** 从 Xtream 播放列表地址推导 JSON API 基址 */
export function xtreamBase(url: string): string {
  return url.replace(/\/+$/, '').replace(/\/get\.php$/, '').replace(/\/player_api\.php$/, '')
}
