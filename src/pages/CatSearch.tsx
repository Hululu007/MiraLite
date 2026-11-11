import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Loader2, Lock, Search } from 'lucide-react'
import CatPoster from '../components/CatPoster'
import { preferredRank, rememberVod, searchAcross, type SearchHit } from '../lib/catSession'

export default function CatSearchPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const name = (params.get('name') ?? '').trim()

  const [hits, setHits] = useState<SearchHit[]>([])
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [onlyFree, setOnlyFree] = useState(true)
  const stop = useRef(false)

  useEffect(() => {
    stop.current = false
    if (!name) return
    setHits([])
    setDone(0)
    setTotal(0)
    setErr(null)
    setRunning(true)
    void (async () => {
      try {
        await searchAcross(
          name,
          {
            onBatch: (batch) => setHits((prev) => dedupe([...prev, ...batch])),
            onProgress: (d, t) => {
              setDone(d)
              setTotal(t)
            },
          },
          () => stop.current,
        )
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setRunning(false)
      }
    })()
    return () => {
      stop.current = true
    }
  }, [name])

  const shown = hits
    .filter((h) => (onlyFree ? !h.pan : true))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(a.pan) - Number(b.pan) ||
        preferredRank(a.siteKey) - preferredRank(b.siteKey),
    )

  const open = (h: SearchHit) => {
    rememberVod(h.siteKey, h.siteName, h.vod)
    navigate(`/cat/item?site=${encodeURIComponent(h.siteKey)}&id=${encodeURIComponent(h.vod.vod_id)}`)
  }

  const freeCount = hits.filter((h) => !h.pan).length

  return (
    <div className="h-full overflow-y-auto px-10 pb-16 pt-6">
      <div className="mb-5 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 rounded-lg border border-line/70 px-2.5 py-1.5 text-[11.5px] text-muted transition hover:text-fg"
        >
          <ArrowLeft size={13} /> 返回
        </button>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
            <Search size={15} className="text-gold" />
            <span className="truncate">「{name || '空搜索'}」</span>
          </h1>
          <p className="mt-0.5 text-[11.5px] text-muted">
            {running
              ? `正在各站点搜索… ${done}/${total || '…'} 个站点`
              : `搜索完成，${hits.length} 条命中（${freeCount} 条免登录可播）`}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {running && <Loader2 size={14} className="animate-spin text-gold" />}
          <div className="flex gap-1">
            <button
              onClick={() => setOnlyFree(true)}
              className={`rounded-md border px-2 py-1 text-[10.5px] transition ${
                onlyFree ? 'border-gold/55 bg-gold/10 text-gold' : 'border-line/60 text-muted hover:text-fg'
              }`}
            >
              免登录 {freeCount}
            </button>
            <button
              onClick={() => setOnlyFree(false)}
              className={`rounded-md border px-2 py-1 text-[10.5px] transition ${
                !onlyFree ? 'border-gold/55 bg-gold/10 text-gold' : 'border-line/60 text-muted hover:text-fg'
              }`}
            >
              全部 {hits.length}
            </button>
          </div>
        </div>
      </div>

      {err && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/8 px-3 py-2 text-[11.5px] leading-relaxed text-red-300">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      {!name && <div className="mt-20 text-center text-[12.5px] text-muted">没带片名，回首页点一张海报吧</div>}

      {name && shown.length === 0 && !running && !err && (
        <div className="mt-20 text-center text-[12.5px] text-muted">
          {hits.length === 0 ? '所有站点都没搜到这部片，换个片名再试试' : '免登录站点没命中，切到「全部」看看网盘源'}
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-4">
        {shown.map((h) => (
          <div key={h.siteKey + h.vod.vod_id} className="relative">
            <CatPoster
              name={h.vod.vod_name}
              pic={h.vod.vod_pic}
              remarks={h.vod.vod_remarks}
              width={118}
              onClick={() => open(h)}
            />
            <div className="mt-1 flex items-center gap-1 text-[10px] text-muted/80">
              <span className="truncate">{h.siteName}</span>
              {h.pan && <Lock size={8} className="shrink-0 text-amber-300/70" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 同站点同 id 只留一条（并发搜索时可能重复回调） */
function dedupe(list: SearchHit[]): SearchHit[] {
  const map = new Map<string, SearchHit>()
  for (const h of list) {
    const k = `${h.siteKey}::${h.vod.vod_id}`
    const prev = map.get(k)
    if (!prev || h.score > prev.score) map.set(k, h)
  }
  return [...map.values()]
}
