import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react'
import CatPoster from '../components/CatPoster'
import Poster from '../components/Poster'
import { useCatalog } from '../lib/catalog'
import { inTauri } from '../lib/cat'
import { preferredRank, rememberVod, searchAcross, type SearchHit } from '../lib/catSession'

export default function SearchPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const catalog = useCatalog()
  const q = (params.get('q') ?? params.get('name') ?? '').trim()

  // 本地演示片 + 用户导入的频道
  const local = useMemo(() => {
    if (!q) return []
    const kw = q.toLowerCase()
    return catalog.items.filter(
      (i) =>
        i.title.toLowerCase().includes(kw) ||
        i.genres.some((g) => g.toLowerCase().includes(kw)) ||
        (i.group ?? '').toLowerCase().includes(kw),
    )
  }, [q, catalog])

  // CAT 跨站真实影视
  const [hits, setHits] = useState<SearchHit[]>([])
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const stop = useRef(false)

  useEffect(() => {
    stop.current = false
    setHits([])
    setDone(0)
    setTotal(0)
    setErr(null)
    if (!q || !inTauri()) {
      setRunning(false)
      return
    }
    setRunning(true)
    void (async () => {
      try {
        await searchAcross(
          q,
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
  }, [q])

  const shown = hits
    .filter((h) => h.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(a.pan) - Number(b.pan) ||
        preferredRank(a.siteKey) - preferredRank(b.siteKey),
    )
    .slice(0, 48)

  const openCat = (h: SearchHit) => {
    rememberVod(h.siteKey, h.siteName, h.vod)
    navigate(`/cat/item?site=${encodeURIComponent(h.siteKey)}&id=${encodeURIComponent(h.vod.vod_id)}`)
  }

  return (
    <div className="px-10 pb-16 pt-7">
      <h1 className="text-[20px] font-semibold tracking-tight">
        {q ? `“${q}” 的搜索结果` : '搜索'}
      </h1>
      <p className="mt-1 text-[12px] text-muted">
        {running
          ? `正在跨站搜索影视… ${done}/${total || '…'} 个站点`
          : `影视 ${shown.length} 部 · 本地频道 ${local.length} 个`}
      </p>

      {err && (
        <div className="glass-alert mt-4 flex items-start gap-2 rounded-lg px-3 py-2 text-[11.5px] leading-relaxed text-red-200">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      {/* CAT 跨站影视 */}
      <section className="mt-6">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">影视片源</h2>
            <p className="mt-0.5 text-[11.5px] text-muted">跨站点搜可播线路，点海报进详情页</p>
          </div>
          {q && (
            <button
              onClick={() => navigate(`/cat/search?name=${encodeURIComponent(q)}`)}
              className="glass-btn flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] text-muted transition hover:text-gold"
            >
              查看全部 <ArrowRight size={12} />
            </button>
          )}
        </div>

        {running && shown.length === 0 && (
          <div className="glass-panel flex items-center gap-2 rounded-2xl px-6 py-10 text-[12px] text-muted">
            <Loader2 size={16} className="animate-spin text-gold" />
            正在从各个站点搜「{q}」…
          </div>
        )}

        {!running && shown.length === 0 && !err && (
          <div className="glass-inset rounded-2xl px-6 py-10 text-center text-[12.5px] text-muted">
            {!inTauri()
              ? '浏览器预览只搜本地频道，桌面版会同时跨站搜真实影视。'
              : q
                ? '所有站点都没搜到这部片，换个片名试试，或到「设置 → 片源」连接更多订阅源。'
                : '输入片名开始搜索'}
          </div>
        )}

        {shown.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-4">
            {shown.map((h) => (
              <div key={h.siteKey + h.vod.vod_id} className="relative">
                <CatPoster
                  name={h.vod.vod_name}
                  pic={h.vod.vod_pic}
                  remarks={h.vod.vod_remarks}
                  width={118}
                  onClick={() => openCat(h)}
                />
                <div className="mt-1 truncate text-[10px] text-muted/80">{h.siteName}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 本地演示片 + 频道 */}
      <section className="mt-9">
        <h2 className="mb-3 text-[15px] font-semibold tracking-tight">本地 / 频道</h2>
        {local.length === 0 ? (
          <div className="glass-inset rounded-2xl px-6 py-8 text-center text-[12px] text-muted">
            没有匹配的本地影片或频道
          </div>
        ) : (
          <div className="flex flex-wrap gap-3.5">
            {local.map((item) => (
              <Poster
                key={item.id}
                item={item}
                width={150}
                onOpen={() =>
                  navigate(item.kind === 'channel' ? `/play/${item.id}` : `/item/${item.id}`)
                }
              />
            ))}
          </div>
        )}
      </section>
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
