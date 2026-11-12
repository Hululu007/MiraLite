/**
 * Tampermonkey / Greasemonkey 用户脚本（userscript）支持。
 *
 * MiraLite 没有内嵌完整浏览器内核，所以这里不做「往真实网页注入」，
 * 而是把 userscript 当作一套可复用的「站点改写规则」：
 *   抓 HTML -> DOMParser 建一个真 Document -> 用 GM_* 兼容层执行脚本 -> 取回改写后的 DOM / 日志
 * 同一份 .user.js 既能贴进这里跑，也能继续放在浏览器里用。
 */

import { useSyncExternalStore } from 'react'
import { inTauri, viaProxy } from './cat'

const KEY = 'miralite.userscripts.v1'

export type RunAt = 'document-start' | 'document-end' | 'document-idle'

export interface UserScript {
  id: string
  name: string
  namespace?: string
  version?: string
  description?: string
  author?: string
  /** @match / @include 合并后的匹配规则 */
  matches: string[]
  excludes: string[]
  grants: string[]
  runAt: RunAt
  code: string
  enabled: boolean
  installedAt: number
  /** 导入来源，仅用于展示 */
  source: 'paste' | 'file' | 'url'
}

export interface RunLog {
  level: 'log' | 'info' | 'warn' | 'error'
  text: string
  at: number
}

export interface RunResult {
  scriptId: string
  scriptName: string
  logs: RunLog[]
  /** 脚本执行后整页 HTML */
  html: string
  /** 抓到的 http(s) 直链，方便直接丢给播放器 */
  links: string[]
  error?: string
  ms: number
}

/* ------------------------------------------------------------------ 元数据解析 */

const META_BLOCK = /\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/

/** 从一个 .user.js 原文里解析元数据块，解析失败也不抛错，尽量给个能用的壳 */
export function parseUserScript(code: string, source: UserScript['source'] = 'paste'): UserScript {
  const block = META_BLOCK.exec(code)?.[1] ?? ''
  const meta: Record<string, string[]> = {}

  for (const line of block.split('\n')) {
    const m = /^\s*\/\/\s*@([\w:-]+)\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    const k = m[1].toLowerCase()
    ;(meta[k] ??= []).push(m[2])
  }

  const matches = [...(meta.match ?? []), ...(meta.include ?? [])]
  const runAtRaw = (meta['run-at']?.[0] ?? 'document-end').toLowerCase()
  const runAt: RunAt =
    runAtRaw === 'document-start' || runAtRaw === 'document-idle' ? (runAtRaw as RunAt) : 'document-end'

  return {
    id: `us_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: meta.name?.[0] ?? guessName(code),
    namespace: meta.namespace?.[0],
    version: meta.version?.[0] ?? '0.0.0',
    description: meta.description?.[0],
    author: meta.author?.[0] ?? meta.contributor?.[0],
    matches: matches.length > 0 ? matches : ['*://*/*'],
    excludes: meta.exclude ?? [],
    grants: meta.grant ?? ['none'],
    runAt,
    code,
    enabled: true,
    installedAt: Date.now(),
    source,
  }
}

function guessName(code: string): string {
  const first = code.split('\n').find((l) => l.trim() && !l.trim().startsWith('//'))
  return first ? first.trim().slice(0, 28) : '未命名脚本'
}

/* ------------------------------------------------------------------ 匹配规则 */

function globToRegExp(glob: string): RegExp | null {
  const s = glob.trim()
  if (!s) return null
  // /regex/ 形式原样当正则
  if (s.length > 2 && s.startsWith('/') && s.endsWith('/')) {
    try {
      return new RegExp(s.slice(1, -1))
    } catch {
      return null
    }
  }
  const escaped = s
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\.\*\\.\*/g, '\\..*') // *.example.com 里第一个 * 不能吃掉协议
  return new RegExp(`^${escaped}$`, 'i')
}

/** 站点地址的等价写法：「https://a.com」「https://a.com/」应视作同一页，@match 两种写法都能命中 */
function urlVariants(url: string): string[] {
  const base = url.split('#')[0]
  const out = new Set<string>([url, base])
  for (const u of [url, base]) {
    out.add(u.endsWith('/') ? u.slice(0, -1) : u + '/')
  }
  return Array.from(out).filter(Boolean)
}

function testPattern(pattern: string, variants: string[]): boolean {
  const re = globToRegExp(pattern)
  return re ? variants.some((v) => re.test(v)) : false
}

export function matchesUrl(script: UserScript, url: string): boolean {
  const variants = urlVariants(url)
  if (!script.matches.some((p) => testPattern(p, variants))) return false
  return !script.excludes.some((p) => testPattern(p, variants))
}

export function pickScripts(scripts: UserScript[], url: string): UserScript[] {
  return scripts.filter((s) => s.enabled && matchesUrl(s, url))
}

/* ------------------------------------------------------------------ 存储 */

let state: UserScript[] = load()
const listeners = new Set<() => void>()

function load(): UserScript[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as UserScript[]) : []
  } catch {
    return []
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* 存不下就只留内存态 */
  }
}

function set(next: UserScript[]) {
  state = next
  persist()
  listeners.forEach((l) => l())
}

export function useUserScripts(): UserScript[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
    () => state,
  )
}

export const scriptActions = {
  add(script: UserScript) {
    // 同 namespace+name 视为升级而不是新装
    const exists = state.find(
      (s) => s.name === script.name && (s.namespace ?? '') === (script.namespace ?? ''),
    )
    set(exists ? state.map((s) => (s.id === exists.id ? { ...script, id: exists.id } : s)) : [...state, script])
  },
  toggle(id: string) {
    set(state.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)))
  },
  update(id: string, patch: Partial<UserScript>) {
    set(state.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  },
  remove(id: string) {
    set(state.filter((s) => s.id !== id))
  },
}

/* ------------------------------------------------------------------ GM_* 兼容层 */

interface GmEnv {
  logs: RunLog[]
  doc: Document
  store: Record<string, unknown>
}

function gmStore(scriptId: string): Record<string, unknown> {
  const k = `miralite.userscript.gm.${scriptId}`
  try {
    return JSON.parse(localStorage.getItem(k) ?? '{}')
  } catch {
    return {}
  }
}

function saveGmStore(scriptId: string, data: Record<string, unknown>) {
  try {
    localStorage.setItem(`miralite.userscript.gm.${scriptId}`, JSON.stringify(data))
  } catch {
    /* 忽略 */
  }
}

function safeJson(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** 把脚本放到一个带 GM_* 的伪 window 里跑，返回本次执行环境 */
function runOne(script: UserScript, url: string, html: string): RunResult {
  const t0 = performance.now()
  const env: GmEnv = { logs: [], doc: new DOMParser().parseFromString(html, 'text/html'), store: gmStore(script.id) }
  const log = (level: RunLog['level']) => (...args: unknown[]) => {
    env.logs.push({ level, text: args.map(safeJson).join(' '), at: Date.now() })
  }

  const gm = {
    GM_info: {
      script: {
        name: script.name,
        version: script.version,
        description: script.description,
        matches: script.matches,
        grants: script.grants,
        namespace: script.namespace,
      },
      scriptHandler: 'MiraLite',
      version: '1.0',
    },
    GM_setValue: (k: string, v: unknown) => {
      env.store[k] = v
      saveGmStore(script.id, env.store)
    },
    GM_getValue: (k: string, d?: unknown) => (k in env.store ? env.store[k] : d),
    GM_deleteValue: (k: string) => {
      delete env.store[k]
      saveGmStore(script.id, env.store)
    },
    GM_listValues: () => Object.keys(env.store),
    GM_addStyle: (css: string) => {
      const el = env.doc.createElement('style')
      el.textContent = css
      env.doc.head?.appendChild(el)
      return el
    },
    GM_log: log('log'),
    GM_notification: (arg: unknown) => {
      const text = typeof arg === 'string' ? arg : (arg as { text?: string })?.text ?? ''
      env.logs.push({ level: 'info', text: `[通知] ${text}`, at: Date.now() })
    },
    GM_openInTab: (u: string) => {
      env.logs.push({ level: 'info', text: `[打开] ${u}`, at: Date.now() })
    },
    GM_registerMenuCommand: (label: string) => {
      env.logs.push({ level: 'log', text: `[菜单] ${label}`, at: Date.now() })
    },
    GM_xmlhttpRequest: (opt: {
      method?: string
      url: string
      data?: string
      headers?: Record<string, string>
      responseType?: string
      onload?: (r: unknown) => void
      onerror?: (e: unknown) => void
      ontimeout?: () => void
    }) => {
      fetch(opt.url, { method: opt.method ?? 'GET', body: opt.data, headers: opt.headers })
        .then(async (r) => {
          const text = await r.text()
          opt.onload?.({ status: r.status, statusText: r.statusText, responseText: text, finalUrl: r.url })
        })
        .catch((e) => {
          env.logs.push({ level: 'warn', text: `[GM_xmlhttpRequest 失败] ${String(e)}`, at: Date.now() })
          opt.onerror?.(e)
        })
      return { abort() {} }
    },
  }

  // 伪 window：脚本里的 window.xxx / unsafeWindow.xxx 都能落到这里
  const fakeLocation = {
    href: url,
    host: safeHost(url),
    hostname: safeHost(url).split(':')[0],
    protocol: url.slice(0, url.indexOf(':') + 1),
    pathname: safePath(url),
    search: safeSearch(url),
  }
  const fakeWindow: Record<string, unknown> = {
    location: fakeLocation,
    document: env.doc,
    console: { log: log('log'), info: log('info'), warn: log('warn'), error: log('error') },
    ...gm,
  }
  fakeWindow.window = fakeWindow
  fakeWindow.unsafeWindow = fakeWindow
  fakeWindow.self = fakeWindow

  let error: string | undefined
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'window',
      'document',
      'location',
      'console',
      'unsafeWindow',
      `"use strict";\n${script.code}`,
    )
    fn(
      fakeWindow,
      env.doc,
      fakeLocation,
      fakeWindow.console,
      fakeWindow,
    )
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    env.logs.push({ level: 'error', text: error, at: Date.now() })
  }

  const html2 = env.doc.documentElement?.outerHTML ?? html
  return {
    scriptId: script.id,
    scriptName: script.name,
    logs: env.logs,
    html: html2,
    links: extractLinks(html2),
    error,
    ms: Math.round(performance.now() - t0),
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}
function safePath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return '/'
  }
}
function safeSearch(url: string): string {
  try {
    return new URL(url).search
  } catch {
    return ''
  }
}

const MEDIA_EXT = /\.(m3u8|mp4|flv|mkv|mp3|m4a|ts)(\?|#|$)/i

/** 从改写后的 HTML 里挖出可直接播放的直链 */
export function extractLinks(html: string): string[] {
  const out = new Set<string>()
  const re = /(https?:\/\/[^\s"'<>()\\]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const u = m[1].replace(/&amp;/g, '&')
    if (MEDIA_EXT.test(u)) out.add(u)
  }
  return [...out].slice(0, 50)
}

/** 对一段 HTML 依次跑所有命中的脚本 */
export function runScripts(scripts: UserScript[], url: string, html: string): RunResult[] {
  return pickScripts(scripts, url).map((s) => runOne(s, url, html))
}

/** 单跑一个脚本（脚本卡片上的「试运行」） */
export function runScript(script: UserScript, url: string, html: string): RunResult {
  return runOne(script, url, html)
}

/** 生成可再次导入的 .user.js 文本（导出用） */
export function serialize(script: UserScript): string {
  const head = [
    '// ==UserScript==',
    `// @name         ${script.name}`,
    script.namespace ? `// @namespace    ${script.namespace}` : '',
    `// @version      ${script.version ?? '0.0.0'}`,
    script.description ? `// @description  ${script.description}` : '',
    script.author ? `// @author       ${script.author}` : '',
    ...script.matches.map((m) => `// @match        ${m}`),
    ...script.excludes.map((m) => `// @exclude      ${m}`),
    ...script.grants.map((g) => `// @grant        ${g}`),
    `// @run-at       ${script.runAt}`,
    '// ==/UserScript==',
  ]
  return `${head.filter(Boolean).join('\n')}\n\n${script.code}`
}

/* ------------------------------------------------------------------ 抓页与播放兜底 */

/** 抓一个地址的正文；桌面版统一走 9989 代理（补 UA/Referer，绕防盗链与跨域） */
export async function fetchPage(url: string): Promise<string> {
  const endpoint = inTauri() ? viaProxy(url) : url
  const res = await fetch(endpoint)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.text()
}

export interface ProbeResult {
  /** 命中的脚本名 */
  matched: string[]
  /** 脚本挖出来的、可以直接喂给播放器的地址 */
  links: string[]
  logs: RunLog[]
  error?: string
}

/**
 * 播放兜底：一条线路播不动时，看看有没有脚本愿意接手这个地址。
 * 抓回页面（或播放列表本身）-> 跑 @match 命中的脚本 -> 收集新地址。
 * 没有脚本命中时成本为零，直接返回。
 */
export async function probeWithScripts(url: string): Promise<ProbeResult> {
  const matched = pickScripts(state, url)
  if (matched.length === 0 || !url) return { matched: [], links: [], logs: [] }

  let html = ''
  try {
    html = await fetchPage(url)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { matched: matched.map((m) => m.name), links: [], logs: [], error: `抓取失败：${error}` }
  }

  const results = runScripts(state, url, html)
  const seen = new Set<string>()
  const links: string[] = []
  const logs: RunLog[] = []
  for (const r of results) {
    logs.push(...r.logs)
    // 原地址本身不算「抢救成功」
    for (const l of r.links) {
      if (l === url || seen.has(l)) continue
      seen.add(l)
      links.push(l)
    }
  }
  return { matched: results.map((r) => r.scriptName), links, logs }
}

/* ------------------------------------------------- 注入到内嵌 webview（真实页面） */

const GM_HEAD = [
  'var META = __META__;',
  'var PREFIX = "miralite.userscript.gm." + META.id + ".";',
  'function readVal(k, d) { try { var r = localStorage.getItem(PREFIX + k); return r === null ? d : JSON.parse(r) } catch (e) { return d } }',
  'window.GM_info = { script: { name: META.name, namespace: META.namespace, version: META.version, description: "", matches: [] }, scriptHandler: "MiraLite", version: "1.0", scriptMetaStr: "" };',
  'window.GM_setValue = function (k, v) { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)) } catch (e) {} };',
  'window.GM_getValue = function (k, d) { return readVal(k, d) };',
  'window.GM_deleteValue = function (k) { try { localStorage.removeItem(PREFIX + k) } catch (e) {} };',
  'window.GM_listValues = function () { var out = []; try { for (var i = 0; i < localStorage.length; i++) { var key = localStorage.key(i); if (key && key.indexOf(PREFIX) === 0) out.push(key.slice(PREFIX.length)) } } catch (e) {} return out };',
  'window.GM_addStyle = function (css) { var st = document.createElement("style"); st.textContent = css; (document.head || document.documentElement).appendChild(st); return st };',
  'window.GM_log = function () { try { console.log.apply(console, ["[MiraLite]"].concat([].slice.call(arguments))) } catch (e) {} };',
  'window.GM_notification = function (o) { try { console.log("[MiraLite]", (o && (o.title || o.text)) || "") } catch (e) {} };',
  'window.GM_openInTab = function (u) { try { window.open(u, "_blank") } catch (e) {} };',
  'window.GM_registerMenuCommand = function () {};',
  'window.GM_xmlhttpRequest = function (d) {',
  '  var ac = typeof AbortController !== "undefined" ? new AbortController() : null;',
  '  var opt = { method: (d.method || "GET").toUpperCase(), headers: d.headers || {}, credentials: "include" };',
  '  if (ac) opt.signal = ac.signal;',
  '  if (d.data !== undefined && opt.method !== "GET") opt.body = d.data;',
  '  fetch(d.url, opt).then(function (r) { return r.text().then(function (t) { return { r: r, t: t } }) })',
  '    .then(function (x) { if (d.onload) d.onload({ status: x.r.status, statusText: x.r.statusText, readyState: 4, responseText: x.t, finalUrl: x.r.url, responseHeaders: "" }) })',
  '    .catch(function (e) { if (d.onerror) d.onerror(e) });',
  '  return { abort: function () { if (ac) ac.abort() } };',
  '};',
  'window.unsafeWindow = window;',
].join('\n')

/**
 * 生成一段可直接丢进内嵌 webview 执行的 JS：GM_* 兼容层 + 用户脚本本体。
 * 与浏览器里的 Tampermonkey 行为对齐（document-end 时机），脚本出错不影响其它脚本。
 */
export function buildInjectScript(s: UserScript): string {
  const meta = JSON.stringify({
    id: s.id,
    name: s.name,
    namespace: s.namespace ?? '',
    version: s.version ?? '0.0.0',
  })
  return [
    '(function () {',
    '  try {',
    GM_HEAD.replace('__META__', meta),
    '    var RUN = function () {',
    '      try {',
    '        (function () {',
    s.code,
    '        }).call(window);',
    '        console.log("[MiraLite] 脚本已执行: " + META.name);',
    '      } catch (e) { console.warn("[MiraLite] 脚本出错: " + (e && e.message)); }',
    '    };',
    '    // 注入时机对齐 Tampermonkey 的 document-end：DOM 就绪后再跑脚本本体',
    '    if (document.readyState === "loading") {',
    '      document.addEventListener("DOMContentLoaded", RUN, { once: true });',
    '    } else { RUN(); }',
    '  } catch (e) { console.warn("[MiraLite] 脚本注入失败: " + (e && e.message)); }',
    '})();',
  ].join('\n')
}

/** 多个脚本拼成一个注入包，空数组返回空串（零注入开销） */
export function buildInjectBundle(scripts: UserScript[]): string {
  return scripts.map(buildInjectScript).join('\n;\n')
}
