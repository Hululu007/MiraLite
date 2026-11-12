import { useEffect, useState } from 'react'
import { FolderOpen, Loader2, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { actions, useLibrary } from '../lib/store'
import {
  groupScanned,
  pickFolder,
  scanDir,
  scrapeGroups,
  toMediaItems,
  type LocalGroup,
  type ScannedFile,
} from '../lib/localLibrary'

const DIR_KEY = 'miralite.local.dir.v1'

/**
 * 设置页「本地媒体库」：选目录 → 扫描 → 勾选 → 刮削入库。
 * 入库后条目会直接出现在「电影」「电视」页，播放走 asset 协议。
 */
export default function LocalLibrary() {
  const { sources } = useLibrary()
  const [dir, setDir] = useState(() => localStorage.getItem(DIR_KEY) ?? '')
  const [files, setFiles] = useState<ScannedFile[] | null>(null)
  const [groups, setGroups] = useState<LocalGroup[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'scan' | 'scrape' | null>(null)
  const [prog, setProg] = useState({ done: 0, total: 0 })
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const localSources = sources.filter((s) => s.kind === 'local')

  useEffect(() => {
    if (dir) localStorage.setItem(DIR_KEY, dir)
  }, [dir])

  function notice(t: string) {
    setMsg(t)
    window.setTimeout(() => setMsg(''), 3000)
  }

  async function scan(path: string) {
    if (!path) return
    setBusy('scan')
    setErr('')
    setMsg('')
    setFiles(null)
    try {
      const list = await scanDir(path)
      const gs = groupScanned(list)
      setFiles(list)
      setGroups(gs)
      setPicked(new Set(gs.map((g) => g.key)))
      if (gs.length === 0) setErr('这个目录里没找到视频文件')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function choose() {
    try {
      const p = await pickFolder()
      if (!p) return
      setDir(p)
      await scan(p)
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      if (!m.includes('取消')) setErr(m)
    }
  }

  async function scrapeAndSave() {
    const target = groups.filter((g) => picked.has(g.key))
    if (target.length === 0) {
      setErr('先勾选要入库的片子')
      return
    }
    setBusy('scrape')
    setErr('')
    setProg({ done: 0, total: target.length })
    try {
      const results = await scrapeGroups(target, (done, total) => setProg({ done, total }))
      const src = actions.addSource({
        kind: 'local',
        name: `本地 · ${dir.split('/').filter(Boolean).pop() || '媒体库'}`,
        url: dir,
        itemCount: results.length,
      })
      actions.setSourceChannels(src.id, toMediaItems(results, src.id))
      const miss = results.filter((r) => !r.tmdb).length
      notice(
        `已入库 ${results.length} 部${miss > 0 ? `，其中 ${miss} 部没刮到 TMDB 信息` : ''}`,
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const movies = groups.filter((g) => g.kind === 'movie').length
  const series = groups.filter((g) => g.kind === 'series').length

  return (
    <div className="px-5 py-3.5">
      <div className="text-[12.5px] text-fg/90">本地媒体库</div>
      <div className="mt-0.5 text-[11px] leading-snug text-muted">
        选一个存片的文件夹，扫描后去 TMDB 刮封面与简介，条目会直接进「电影」「电视」
      </div>

      <div className="glass-inset mt-2.5 flex items-center gap-2 rounded-lg px-2.5 py-1.5">
        <FolderOpen size={12} className="shrink-0 text-muted" />
        <input
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void scan(dir)
          }}
          placeholder="/Users/mac/Movies"
          className="w-full bg-transparent text-[11.5px] text-fg/85 outline-none placeholder:text-muted/60"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void choose()}
          className="glass-chip rounded-md px-2.5 py-1 text-[11px] text-fg/75 hover:text-gold"
        >
          选择文件夹
        </button>
        <button
          onClick={() => void scan(dir)}
          disabled={!dir || busy !== null}
          className="glass-chip flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] text-fg/75 disabled:opacity-40"
        >
          <RefreshCw size={11} /> 扫描
        </button>
        {groups.length > 0 && (
          <button
            onClick={() => void scrapeAndSave()}
            disabled={busy !== null || picked.size === 0}
            className="flex items-center gap-1 rounded-lg bg-gold/90 px-2.5 py-1 text-[11px] font-medium text-black disabled:opacity-40"
          >
            {busy === 'scrape' ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Sparkles size={11} />
            )}
            {busy === 'scrape'
              ? `刮削 ${prog.done}/${prog.total}`
              : `刮削并入库（${picked.size}）`}
          </button>
        )}
      </div>

      {busy === 'scan' && (
        <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
          <Loader2 size={12} className="animate-spin text-gold" /> 正在扫目录…
        </div>
      )}
      {err && <div className="mt-2 text-[11px] text-amber-200/90">{err}</div>}
      {msg && <div className="mt-2 text-[11px] text-gold">{msg}</div>}

      {groups.length > 0 && (
        <>
          <div className="mt-2.5 flex items-center justify-between text-[10.5px] text-muted">
            <span>
              {files?.length ?? 0} 个文件 · {movies} 部电影 · {series} 部剧集
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPicked(new Set(groups.map((g) => g.key)))}
                className="hover:text-gold"
              >
                全选
              </button>
              <button onClick={() => setPicked(new Set())} className="hover:text-gold">
                全不选
              </button>
            </div>
          </div>
          <div className="no-scrollbar mt-1.5 max-h-[260px] overflow-y-auto rounded-lg border border-white/8">
            {groups.map((g) => {
              const on = picked.has(g.key)
              return (
                <button
                  key={g.key}
                  onClick={() => {
                    const next = new Set(picked)
                    if (on) next.delete(g.key)
                    else next.add(g.key)
                    setPicked(next)
                  }}
                  className="flex w-full items-center gap-2.5 border-b border-white/6 px-3 py-2 text-left last:border-b-0 hover:bg-white/4"
                >
                  <span
                    className={`h-3.5 w-3.5 shrink-0 rounded border ${
                      on ? 'border-gold bg-gold/80' : 'border-white/25'
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] text-fg/88">{g.title}</span>
                    <span className="block truncate text-[10px] text-muted/70">
                      {g.kind === 'series' ? `剧集 · ${g.files.length} 集` : '电影'}
                      {g.year ? ` · ${g.year}` : ''}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}

      {localSources.length > 0 && (
        <div className="mt-3.5">
          <div className="text-[11px] text-muted">已入库的本地库</div>
          <div className="mt-1.5 space-y-1">
            {localSources.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg border border-white/8 px-2.5 py-1.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-[11.5px] text-fg/85">{s.name}</div>
                  <div className="truncate text-[10px] text-muted/70">
                    {s.itemCount} 部 · {s.url}
                  </div>
                </div>
                <button
                  onClick={() => actions.removeSource(s.id)}
                  title="从片库移除（不删磁盘文件）"
                  className="ml-2 shrink-0 text-muted hover:text-red-300"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
