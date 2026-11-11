import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Poster from '../components/Poster'
import { useCatalog } from '../lib/catalog'
import { useLibrary } from '../lib/store'

export default function TvPage() {
  const navigate = useNavigate()
  const { series } = useCatalog()
  const { progress } = useLibrary()
  const [onlyUnfinished, setOnlyUnfinished] = useState(false)

  const list = useMemo(() => {
    if (!onlyUnfinished) return series
    return series.filter((s) => {
      const p = progress[s.id]
      return !p || p.position / Math.max(p.duration, 1) < 0.95
    })
  }, [series, onlyUnfinished, progress])

  return (
    <div className="px-10 pb-16 pt-7">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">剧集</h1>
          <p className="mt-1 text-[12px] text-muted">共 {list.length} 部 · 按季追更</p>
        </div>
        <button
          onClick={() => setOnlyUnfinished((v) => !v)}
          className={`rounded-lg border px-3 py-1.5 text-[11.5px] transition ${
            onlyUnfinished
              ? 'border-gold/60 bg-gold/15 text-gold'
              : 'border-line/70 text-muted hover:text-fg'
          }`}
        >
          仅未看完
        </button>
      </div>

      <div className="flex flex-wrap gap-3.5">
        {list.map((item) => {
          const p = progress[item.id]
          return (
            <Poster
              key={item.id}
              item={item}
              width={158}
              badge={item.seasons ? `${item.seasons} 季` : undefined}
              progress={p && p.duration ? p.position / p.duration : 0}
              onOpen={() => navigate(`/item/${item.id}`)}
            />
          )
        })}
      </div>
    </div>
  )
}
