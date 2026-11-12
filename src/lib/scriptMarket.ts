/**
 * 脚本市场：按关键词搜 OpenUserJS，一键把 .user.js 拉回本地导入。
 *
 * 为什么不用 Greasy Fork 的 JSON API：它的域名在国内常被 DNS 污染，
 * 首发源选可达的 OpenUserJS，另外保留内置精选清单做兜底。
 */
import { parseUserScript, type UserScript } from './userscript'

export interface MarketHit {
  id: string
  name: string
  author: string
  desc: string
  version?: string
  installs?: number
  updated?: string
  pageUrl: string
  installUrl: string
  source: 'openuserjs' | 'builtin'
}

const OU_BASE = 'https://openuserjs.org'

/** 网络请求走本机串流代理（自带 UA 与 CORS），和用户脚本抓页同一套 */
async function getText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.text()
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&hellip;/g, '…')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeEntities(s: string): string {
  return stripTags(s)
}

/** 解析 OpenUserJS 搜索结果表格 */
export function parseOpenUserJS(html: string): MarketHit[] {
  const hits: MarketHit[] = []
  const blocks = html.split('<tr class="tr-link">').slice(1)
  for (const raw of blocks) {
    const link = raw.match(/<a href="(\/scripts\/[^"]+)"[^>]*class="tr-link-a"[^>]*><b>([\s\S]*?)<\/b>/)
    if (!link) continue
    const pageUrl = OU_BASE + link[1]
    const name = decodeEntities(link[2])
    if (!name) continue
    const author = (raw.match(/href="\/users\/([^"]+)"/) ?? [])[1] ?? ''
    const descRaw = (raw.match(/<p>([\s\S]*?)<\/p>/) ?? [])[1] ?? ''
    const version = (raw.match(/class="script-version[^"]*">([^<]+)</) ?? [])[1]?.trim()
    const installsRaw = (raw.match(/class="text-center td-fit">\s*<p>(\d+)<\/p>/) ?? [])[1]
    const updated = (raw.match(/datetime="([^"]+)"/) ?? [])[1]
    const id = link[1].replace('/scripts/', '')
    hits.push({
      id,
      name,
      author,
      desc: decodeEntities(descRaw),
      version,
      installs: installsRaw ? Number(installsRaw) : undefined,
      updated,
      pageUrl,
      installUrl: `${OU_BASE}/install/${encodeURIComponent(author)}/${encodeURIComponent(
        link[1].replace(`/scripts/${author}/`, ''),
      )}.user.js`,
      source: 'openuserjs',
    })
  }
  return hits
}

export async function searchOpenUserJS(kw: string, page = 1): Promise<MarketHit[]> {
  const q = kw.trim()
  if (!q) return []
  const url = `${OU_BASE}/?q=${encodeURIComponent(q)}${page > 1 ? `&p=${page}` : ''}`
  const html = await getText(url)
  return parseOpenUserJS(html)
}

/** 拉脚本原文（.user.js），能直接喂给 parseUserScript */
export async function fetchScriptCode(url: string): Promise<string> {
  const code = await getText(url)
  if (!code.includes('==UserScript==')) {
    throw new Error('这个链接返回的不是用户脚本原文')
  }
  return code
}

/** 搜索 + 导入一步到位 */
export async function installMarketScript(hit: MarketHit): Promise<UserScript> {
  let code = ''
  try {
    code = await fetchScriptCode(hit.installUrl)
  } catch {
    // install 直链被挡时，退一步从详情页找 install 链接
    const page = await getText(hit.pageUrl)
    const m = page.match(/href="(\/install\/[^"]+\.user\.js)"/)
    if (!m) throw new Error('详情页里没找到安装地址')
    code = await fetchScriptCode(OU_BASE + m[1])
  }
  const parsed = parseUserScript(code, 'url')
  if (!parsed.name || parsed.name === '未命名脚本') parsed.name = hit.name
  return parsed
}

/**
 * 内置精选：MiraLite 这类「抓页 + 改播放地址」场景最常用的几类脚本。
 * 直接从 OpenUserJS 页面上取，不硬编码代码，避免版本过期。
 */
export const CURATED: Array<Pick<MarketHit, 'name' | 'desc'> & { kw: string }> = [
  { name: '全网 VIP 视频解析', desc: '把爱优腾等播放页换成可直链播放的解析地址', kw: 'VIP 视频解析' },
  { name: 'B 站使用增强', desc: 'B 站视频下载与播放页增强', kw: 'bilibili 增强' },
  { name: 'YouTube 下载助手', desc: 'YouTube 页面视频与字幕下载', kw: 'youtube download' },
  { name: '字幕嗅探', desc: '从播放页里挖出字幕文件地址', kw: 'subtitle sniffer' },
  { name: '短链跳转绕过', desc: '跳过各类中转页直达真实地址', kw: 'bypass shortlinks' },
]
