import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Puzzle, RotateCcw, Search, Settings2, X } from 'lucide-react'
import {
  hasApp,
  normalizeInput,
  openUrl,
  tileActions,
  useTiles,
  SEARCH_ENGINE,
  type Tile,
} from '../lib/browser'

/** Edge 新标签页的三套背景，点齿轮轮换 */
const THEMES = [
  {
    name: '极光',
    css: 'radial-gradient(120% 90% at 15% 0%, #123a6b 0%, #0a1020 55%, #07070c 100%), radial-gradient(90% 70% at 90% 20%, rgba(96,165,250,0.35) 0%, transparent 60%)',
  },
  {
    name: '暮色',
    css: 'radial-gradient(120% 90% at 20% 0%, #4a2148 0%, #150d1c 58%, #07070c 100%), radial-gradient(80% 70% at 95% 25%, rgba(244,114,182,0.3) 0%, transparent 60%)',
  },
  {
    name: '深海',
    css: 'radial-gradient(120% 90% at 10% 5%, #0c4a4e 0%, #08131a 58%, #06070b 100%), radial-gradient(85% 70% at 88% 18%, rgba(34,211,238,0.28) 0%, transparent 62%)',
  },
]

function greet(h: number): string {
  if (h < 5) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 13) return '中午好'
  if (h < 18) return '下午好'
  if (h < 23) return '晚上好'
  return '夜深了'
}

function TileCard({
  tile,
  editing,
  browser,
  onRemove,
}: {
  tile: Tile
  editing: boolean
  browser: string | null
  onRemove: () => void
}) {
  return (
    <div className="group relative flex flex-col items-center gap-2">
      <button
        onClick={() => void openUrl(tile.url, browser)}
        title={tile.url}
        className="glass-panel flex h-[72px] w-[72px] items-center justify-center rounded-2xl text-[24px] font-semibold transition hover:-translate-y-0.5 hover:shadow-[0_14px_34px_-16px_rgba(0,0,0,0.9)]"
        style={{ color: tile.color }}
      >
        {tile.name.slice(0, 1).toUpperCase()}
      </button>
      <span className="max-w-[78px] truncate text-[11px] text-fg/70">{tile.name}</span>
      {editing && (
        <button
          onClick={onRemove}
          className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white/80 transition hover:text-rose-300"
        >
          <X size={11} />
        </button>
      )}
    </div>
  )
}

export default function BrowserPage() {
  const navigate = useNavigate()
  const tiles = useTiles()
  const [q, setQ] = useState('')
  const [theme, setTheme] = useState(0)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftUrl, setDraftUrl] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [edgeOk, setEdgeOk] = useState(false)
  const [useEdge, setUseEdge] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // 本机装了 Edge 才把链接丢给它，否则走默认浏览器
  useEffect(() => {
    let alive = true
    void hasApp('Microsoft Edge').then((ok) => {
      if (!alive) return
      setEdgeOk(ok)
      setUseEdge(ok)
    })
    return () => {
      alive = false
    }
  }, [])

  const target = useEdge && edgeOk ? 'Microsoft Edge' : null

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  // 进来就能直接打字搜索
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const dateText = useMemo(
    () => `${now.getMonth() + 1}月${now.getDate()}日 星期${'日一二三四五六'[now.getDay()]}`,
    [now],
  )

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const url = normalizeInput(q)
    if (!url) return
    void openUrl(url, target)
    setQ('')
  }

  function addTile(e: React.FormEvent) {
    e.preventDefault()
    if (!draftUrl.trim()) return
    tileActions.add(draftName, draftUrl)
    setDraftName('')
    setDraftUrl('')
    setAdding(false)
  }

  return (
    <div className="relative -m-3 h-[calc(100%+24px)] overflow-y-auto">
      {/* 背景 */}
      <div
        className="pointer-events-none absolute inset-0 transition-[background] duration-500"
        style={{ background: THEMES[theme].css }}
        aria-hidden="true"
      />

      <div className="relative flex min-h-full flex-col items-center px-10 pb-10 pt-6">
        {/* 右上工具条 */}
        <div className="mb-10 flex w-full items-center justify-end gap-1.5">
          {edgeOk && (
            <button
              onClick={() => setUseEdge((v) => !v)}
              title="用 Microsoft Edge 打开链接"
              className={`glass-btn flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] ${
                useEdge ? 'text-sky-300' : 'text-fg/70'
              }`}
            >
              <span className="text-[10px]">◍</span> Edge {useEdge ? '已启用' : '已关闭'}
            </button>
          )}
          <button
            onClick={() => setTheme((t) => (t + 1) % THEMES.length)}
            title={`背景：${THEMES[theme].name}`}
            className="glass-btn flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] text-fg/70"
          >
            <Settings2 size={12} /> {THEMES[theme].name}
          </button>
          <button
            onClick={() => setEditing((v) => !v)}
            title="整理快捷方式"
            className={`glass-btn flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] ${
              editing ? 'text-gold' : 'text-fg/70'
            }`}
          >
            {editing ? '完成' : '编辑'}
          </button>
          <button
            onClick={() => tileActions.reset()}
            title="恢复默认快捷方式"
            className="glass-btn flex h-8 w-8 items-center justify-center rounded-full text-fg/70"
          >
            <RotateCcw size={12} />
          </button>
          <button
            onClick={() => navigate('/userscript/manage')}
            title="用户脚本"
            className="glass-btn flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] text-fg/70 hover:text-gold"
          >
            <Puzzle size={12} /> 脚本
          </button>
        </div>

        {/* 问候 + 搜索 */}
        <div className="w-full max-w-[620px] text-center">
          <div className="text-[13px] tracking-wide text-fg/55">{dateText}</div>
          <h1 className="mt-1.5 text-[34px] font-semibold leading-tight tracking-tight text-fg">
            {greet(now.getHours())}
          </h1>

          <form onSubmit={submit} className="relative mt-7">
            <Search
              size={15}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-fg/45"
            />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`在 ${SEARCH_ENGINE.name} 上搜索，或输入网址`}
              className="glass-panel h-12 w-full rounded-full pl-11 pr-[86px] text-[13px] text-fg placeholder:text-fg/40"
            />
            <button
              type="submit"
              className="absolute right-1.5 top-1.5 flex h-9 items-center gap-1.5 rounded-full bg-white/90 px-4 text-[12px] font-medium text-black transition hover:bg-white"
            >
              搜索
            </button>
          </form>
          <div className="mt-2 text-[10.5px] text-fg/40">
            搜索走 {SEARCH_ENGINE.name}，外部链接用
            {target ? ` ${target} ` : '系统默认浏览器'}打开
          </div>
        </div>

        {/* 快捷方式 */}
        <div className="mt-12 w-full max-w-[720px]">
          <div className="mb-3 flex items-center justify-between px-1">
            <span className="text-[11.5px] text-fg/50">快捷方式</span>
            {editing && (
              <button
                onClick={() => setAdding((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-gold"
              >
                <Plus size={11} /> 添加
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-5">
            {tiles.map((t) => (
              <TileCard
                key={t.id}
                tile={t}
                editing={editing}
                browser={target}
                onRemove={() => tileActions.remove(t.id)}
              />
            ))}
            {editing && !adding && (
              <button
                onClick={() => setAdding(true)}
                className="flex h-[72px] w-[72px] flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-white/20 text-[11px] text-fg/45 transition hover:border-gold/60 hover:text-gold"
              >
                <Plus size={16} />
                新增
              </button>
            )}
          </div>

          {adding && (
            <form onSubmit={addTile} className="glass-panel mt-5 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5">
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="名称"
                className="glass-input h-8 w-[120px] rounded-md px-2.5 text-[11.5px] text-fg"
              />
              <input
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                placeholder="网址，如 example.com"
                className="glass-input h-8 min-w-[200px] flex-1 rounded-md px-2.5 text-[11.5px] text-fg"
              />
              <button
                type="submit"
                disabled={!draftUrl.trim()}
                className="rounded-md bg-gold/90 px-3 py-1.5 text-[11.5px] font-medium text-black disabled:opacity-40"
              >
                添加
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="glass-chip rounded-md px-2.5 py-1.5 text-[11.5px] text-fg/70"
              >
                取消
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
