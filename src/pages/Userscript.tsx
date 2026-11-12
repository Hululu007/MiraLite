import { useMemo, useRef, useState } from 'react'
import { Copy, CornerUpLeft, FileCode2, Play, Plus, Trash2, Upload, Download, Wand2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import PlayerOverlay from '../components/PlayerOverlay'
import { inTauri } from '../lib/cat'
import {
  fetchPage,
  parseUserScript,
  pickScripts,
  runScript,
  runScripts,
  scriptActions,
  serialize,
  useUserScripts,
  type RunResult,
  type UserScript,
} from '../lib/userscript'

const SAMPLE = `// ==UserScript==
// @name         示例 · 抓取页面里的 m3u8
// @namespace    miralite.demo
// @version      1.0.0
// @description  演示：从页面脚本里抠出播放地址，写进 console
// @match        *://*/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

GM_addStyle('body{outline:2px solid #e8b44c}');
const html = document.documentElement.outerHTML;
const found = html.match(/https?:\\/\\/[^"'\\s]+\\.m3u8[^"'\\s]*/g) || [];
console.log('命中播放地址', found.length, found.slice(0, 3));`

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition ${
        on ? 'bg-gold shadow-[0_0_18px_-4px_rgba(232,180,76,0.75)]' : 'bg-white/14'
      }`}
    >
      <span
        className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all ${
          on ? 'left-[19px]' : 'left-[3px]'
        }`}
      />
    </button>
  )
}

function ScriptCard({
  script,
  onRun,
  onEdit,
  onDelete,
  onExport,
}: {
  script: UserScript
  onRun: () => void
  onEdit: () => void
  onDelete: () => void
  onExport: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="glass-panel mb-3 overflow-hidden rounded-2xl">
      <div className="flex items-start gap-4 px-5 py-4">
        <div className="glass-logo mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-gold">
          <FileCode2 size={16} strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-[13px] font-medium text-fg/90">{script.name}</div>
            <span className="glass-chip shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted">
              v{script.version}
            </span>
            {!script.enabled && (
              <span className="shrink-0 rounded bg-white/8 px-1.5 py-0.5 text-[10px] text-muted">已停用</span>
            )}
          </div>
          {script.description && (
            <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted">{script.description}</div>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {script.matches.slice(0, 4).map((m) => (
              <span
                key={m}
                className="glass-inset max-w-[220px] truncate rounded px-1.5 py-0.5 font-mono text-[10px] text-fg/60"
              >
                {m}
              </span>
            ))}
            {script.matches.length > 4 && (
              <span className="text-[10px] text-muted">+{script.matches.length - 4}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Toggle on={script.enabled} onChange={() => scriptActions.toggle(script.id)} />
        </div>
      </div>
      <div className="flex items-center gap-1 border-t border-white/8 px-4 py-2">
        <button onClick={onRun} className="glass-chip flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-fg/75">
          <Play size={11} /> 试运行
        </button>
        <button onClick={() => setOpen(!open)} className="glass-chip rounded-md px-2 py-1 text-[11px] text-fg/75">
          {open ? '收起源码' : '看源码'}
        </button>
        <button onClick={onEdit} className="glass-chip rounded-md px-2 py-1 text-[11px] text-fg/75">
          编辑
        </button>
        <button onClick={onExport} className="glass-chip flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-fg/75">
          <Download size={11} /> 导出
        </button>
        <button
          onClick={onDelete}
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted transition hover:text-rose-300"
        >
          <Trash2 size={11} /> 删除
        </button>
      </div>
      {open && (
        <pre className="max-h-[240px] overflow-auto border-t border-white/8 bg-black/25 px-4 py-3 font-mono text-[10.5px] leading-relaxed text-fg/65">
          {script.code}
        </pre>
      )}
    </div>
  )
}

function LogView({
  results,
  onPlay,
  onCopy,
}: {
  results: RunResult[]
  onPlay: (url: string) => void
  onCopy: (url: string) => void
}) {
  if (results.length === 0) return null
  return (
    <div className="glass-panel mt-5 overflow-hidden rounded-2xl">
      <div className="border-b border-white/10 px-5 py-3 text-[12.5px] font-medium text-fg/85">
        执行结果 · {results.length} 个脚本命中
      </div>
      <div className="divide-y divide-white/8">
        {results.map((r) => (
          <div key={r.scriptId} className="px-5 py-3">
            <div className="flex items-center gap-2 text-[12px] text-fg/85">
              <span className={r.error ? 'text-rose-300' : 'text-gold'}>{r.scriptName}</span>
              <span className="text-[10.5px] text-muted">{r.ms}ms</span>
              {r.links.length > 0 && <span className="text-[10.5px] text-muted">· {r.links.length} 条直链</span>}
            </div>
            <div className="mt-1.5 max-h-[180px] overflow-auto rounded-lg bg-black/25 px-3 py-2 font-mono text-[10.5px] leading-relaxed">
              {r.logs.length === 0 && <div className="text-muted">（脚本没有输出）</div>}
              {r.logs.map((l, i) => (
                <div
                  key={i}
                  className={
                    l.level === 'error'
                      ? 'text-rose-300'
                      : l.level === 'warn'
                        ? 'text-amber-300'
                        : 'text-fg/65'
                  }
                >
                  {l.text}
                </div>
              ))}
            </div>
            {r.links.length > 0 && (
              <div className="mt-2 space-y-1">
                {r.links.slice(0, 6).map((u) => (
                  <div key={u} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 truncate font-mono text-[10px] text-emerald-300/80">{u}</div>
                    <button
                      onClick={() => onPlay(u)}
                      className="glass-chip flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-fg/75"
                    >
                      <Play size={9} /> 播放
                    </button>
                    <button
                      onClick={() => onCopy(u)}
                      className="glass-chip flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-fg/75"
                    >
                      <Copy size={9} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function UserscriptPage() {
  const navigate = useNavigate()
  const scripts = useUserScripts()
  const [draft, setDraft] = useState('')
  const [target, setTarget] = useState('')
  const [results, setResults] = useState<RunResult[]>([])
  const [msg, setMsg] = useState('')
  const [editing, setEditing] = useState<UserScript | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const preview = useMemo(() => (draft.trim() ? parseUserScript(draft) : null), [draft])
  const hits = useMemo(() => (target.trim() ? pickScripts(scripts, target.trim()) : []), [scripts, target])

  function notice(t: string) {
    setMsg(t)
    window.setTimeout(() => setMsg(''), 2600)
  }

  async function commit() {
    let text = draft
    if (!text.trim()) return
    let source: UserScript['source'] = 'paste'
    // 贴的是脚本直链（如 jsdelivr / greasyfork 原始链接）时先拉回原文，别把链接当代码存
    if (/^https?:\/\/\S+$/.test(text.trim()) && !text.includes('==UserScript==')) {
      try {
        text = await fetchPage(text.trim())
        source = 'url'
      } catch (e) {
        notice(`拉取脚本失败：${e instanceof Error ? e.message : String(e)}`)
        return
      }
    }
    const parsed = editing ? { ...parseUserScript(text), id: editing.id } : parseUserScript(text, source)
    scriptActions.add(parsed)
    setDraft('')
    setEditing(null)
    notice(`已${editing ? '保存' : '导入'}「${parsed.name}」`)
  }

  function importFile(f: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      const parsed = parseUserScript(text, 'file')
      scriptActions.add(parsed)
      notice(`已从文件导入「${parsed.name}」`)
    }
    reader.readAsText(f)
  }

  async function runTarget() {
    const url = target.trim()
    if (!url) return
    try {
      const html = await fetchPage(url)
      const r = runScripts(scripts, url, html)
      setResults(r)
      if (r.length === 0) notice('没有脚本匹配这个地址')
    } catch (e) {
      notice(`抓取失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function runSingle(script: UserScript) {
    const url = target.trim() || script.matches[0]
    try {
      const html = await fetchPage(url)
      setResults([runScript(script, url, html)])
    } catch (e) {
      notice(`执行失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function exportScript(script: UserScript) {
    const blob = new Blob([serialize(script)], { type: 'text/javascript' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${script.name.replace(/[\\/:*?"<>|]/g, '_')}.user.js`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="px-10 pb-16 pt-7">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="mb-1 flex items-center gap-2 text-[22px] font-semibold tracking-tight">
            用户脚本
            <span className="rounded-md bg-gold/15 px-1.5 py-0.5 text-[10px] font-normal text-gold">
              Tampermonkey · Greasemonkey
            </span>
          </h1>
          <p className="text-[12px] text-muted">
            导入 .user.js，按 @match 在抓回的页面上执行，用 GM_* 兼容层改写 DOM 或抠出播放地址
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted">
            共 {scripts.length} 个 · 启用 {scripts.filter((s) => s.enabled).length}
          </span>
          <button
            onClick={() => navigate('/userscript')}
            className="glass-chip flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-fg/75"
          >
            <CornerUpLeft size={11} /> 返回首页
          </button>
        </div>
      </div>

      {/* 导入区 */}
      <div className="glass-panel mb-6 overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div className="text-[12.5px] font-medium text-fg/85">
            {editing ? `编辑：${editing.name}` : '导入脚本'}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDraft(SAMPLE)}
              className="glass-chip flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-fg/75"
            >
              <Wand2 size={11} /> 填入示例
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="glass-chip flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-fg/75"
            >
              <Upload size={11} /> 选文件
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".js,.user.js,text/javascript"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) importFile(f)
                e.target.value = ''
              }}
            />
          </div>
        </div>
        <div className="px-5 py-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="粘贴 // ==UserScript== 开头的完整脚本，或点右上角选一个 .user.js 文件"
            spellCheck={false}
            className="glass-input h-[190px] w-full resize-y rounded-xl px-3.5 py-3 font-mono text-[11px] leading-relaxed text-fg placeholder:text-muted/70"
          />
          <div className="mt-3 flex items-center gap-3">
            <div className="min-w-0 flex-1 text-[11px] text-muted">
              {preview ? (
                <span className="truncate">
                  识别到 <span className="text-fg/80">{preview.name}</span> v{preview.version} ·{' '}
                  {preview.matches.length} 条 match · @{preview.runAt}
                </span>
              ) : (
                '未检测到元数据块时会按普通脚本导入，默认 @match *://*/*'
              )}
            </div>
            {editing && (
              <button
                onClick={() => {
                  setEditing(null)
                  setDraft('')
                }}
                className="glass-chip rounded-md px-2.5 py-1.5 text-[11px] text-fg/70"
              >
                取消
              </button>
            )}
            <button
              onClick={commit}
              disabled={!draft.trim()}
              className="flex items-center gap-1 rounded-lg bg-gold/90 px-3 py-1.5 text-[11.5px] font-medium text-black transition disabled:opacity-40"
            >
              <Plus size={12} /> {editing ? '保存修改' : '导入'}
            </button>
          </div>
          {msg && <div className="mt-2 text-[11px] text-gold">{msg}</div>}
        </div>
      </div>

      {/* 脚本库 */}
      {scripts.length === 0 ? (
        <div className="glass-panel rounded-2xl px-5 py-10 text-center text-[12px] text-muted">
          还没有脚本。贴一段 .user.js 进来，或用「填入示例」看一下能做什么。
        </div>
      ) : (
        scripts.map((s) => (
          <ScriptCard
            key={s.id}
            script={s}
            onRun={() => runSingle(s)}
            onEdit={() => {
              setEditing(s)
              setDraft(serialize(s))
            }}
            onExport={() => exportScript(s)}
            onDelete={() => scriptActions.remove(s.id)}
          />
        ))
      )}

      {/* 试运行 */}
      <div className="glass-panel mt-6 overflow-hidden rounded-2xl">
        <div className="border-b border-white/10 px-5 py-3 text-[12.5px] font-medium text-fg/85">试运行</div>
        <div className="px-5 py-4">
          <div className="flex items-center gap-2">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="https://example.com/page（抓这个页面，跑所有命中的脚本）"
              className="glass-input h-9 min-w-0 flex-1 rounded-lg px-3 font-mono text-[11.5px] text-fg"
            />
            <button
              onClick={runTarget}
              disabled={!target.trim() || scripts.length === 0}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-gold/90 px-3 py-2 text-[11.5px] font-medium text-black transition disabled:opacity-40"
            >
              <Play size={12} /> 运行
            </button>
          </div>
          <div className="mt-2 text-[11px] text-muted">
            {target.trim()
              ? hits.length > 0
                ? `命中 ${hits.length} 个脚本：${hits.map((h) => h.name).join('、')}`
                : '没有脚本匹配这个地址'
              : inTauri()
                ? '请求走本地 9989 代理，带 Safari UA 与 Referer，站点不会因防盗链回 403'
                : '浏览器预览下直接抓取，跨域站点可能被拦截'}
          </div>
        </div>
      </div>

      <LogView
        results={results}
        onPlay={(u) => setPlaying(u)}
        onCopy={(u) => {
          void navigator.clipboard?.writeText(u)
          notice('已复制地址')
        }}
      />

      {playing && <PlayerOverlay url={playing} onClose={() => setPlaying(null)} />}
    </div>
  )
}
