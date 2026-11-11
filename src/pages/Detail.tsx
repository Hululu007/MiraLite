import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Clock, Play, Plus, Star } from 'lucide-react'
import Poster from '../components/Poster'
import Row from '../components/Row'
import { useCatalog } from '../lib/catalog'
import { actions, useLibrary } from '../lib/store'

export default function DetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const catalog = useCatalog()
  const { progress, watchlist } = useLibrary()
  const item = id ? catalog.byId[id] : undefined

  const similar = useMemo(() => {
    if (!item) return []
    return catalog.items
      .filter((x) => x.id !== item.id && x.kind === item.kind && x.genres.some((g) => item.genres.includes(g)))
      .slice(0, 10)
  }, [item, catalog])

  if (!item) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-muted">
        找不到该条目
        <button onClick={() => navigate(-1)} className="ml-3 text-gold underline">
          返回
        </button>
      </div>
    )
  }

  const p = progress[item.id]
  const watchedRatio = p && p.duration ? p.position / p.duration : 0
  const inList = watchlist.includes(item.id)
  const episodes = item.seasons && item.episodes ? Array.from({ length: item.episodes }, (_, i) => i + 1) : []

  return (
    <div className="pb-16">
      <div className="relative h-[320px]">
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(115deg, hsl(${item.hue} 58% 24%) 0%, hsl(${(item.hue + 36) % 360} 42% 10%) 46%, #08080a 100%)`,
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#08080a]/95 via-[#08080a]/30 to-transparent" />
        <button
          onClick={() => navigate(-1)}
          className="glass-btn absolute left-10 top-6 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] text-white/85"
        >
          <ArrowLeft size={13} /> 返回
        </button>

        <div className="absolute inset-x-10 bottom-7 flex gap-6">
          <div className="glass-poster shrink-0 overflow-hidden rounded-xl">
            <Poster item={item} width={132} />
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <h1 className="text-[26px] font-semibold leading-tight tracking-tight">{item.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11.5px] text-muted">
              {item.year && <span>{item.year}</span>}
              {item.rating && (
                <span className="flex items-center gap-1 text-gold">
                  <Star size={11} fill="currentColor" /> {item.rating.toFixed(1)}
                </span>
              )}
              {item.runtime && (
                <span className="flex items-center gap-1">
                  <Clock size={11} /> {item.runtime} 分钟
                </span>
              )}
              {item.seasons && <span>{item.seasons} 季 / {item.episodes} 集</span>}
              <span>{item.genres.join(' · ')}</span>
            </div>
            <p className="mt-3 max-w-[600px] text-[12.5px] leading-relaxed text-fg/65">{item.overview}</p>

            <div className="mt-4 flex items-center gap-2.5">
              <button
                onClick={() => navigate(`/play/${item.id}`)}
                className="glass-primary flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12.5px] font-semibold"
              >
                <Play size={13} fill="currentColor" />
                {watchedRatio > 0.01 && watchedRatio < 0.95 ? '继续播放' : '播放'}
              </button>
              <button
                onClick={() => actions.toggleWatchlist(item.id)}
                className="glass-btn flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] text-fg/85"
              >
                {inList ? <Check size={13} /> : <Plus size={13} />}
                {inList ? '已在片单' : '加入片单'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {episodes.length > 0 && (
        <div className="mt-6 px-10">
          <h2 className="mb-3 text-[14px] font-semibold">第 1 季</h2>
          <div className="grid grid-cols-4 gap-2.5">
            {episodes.map((ep) => (
              <button
                key={ep}
                onClick={() => navigate(`/play/${item.id}`)}
                className="glass-inset group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left"
              >
                <span className="text-[13px] font-semibold text-muted group-hover:text-gold">
                  {String(ep).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-fg/85">第 {ep} 集</span>
                  <span className="block text-[10.5px] text-muted">{45} 分钟</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {similar.length > 0 && (
        <div className="mt-9">
          <Row title="相似作品" subtitle="同类型推荐">
            {similar.map((s) => (
              <Poster key={s.id} item={s} width={140} onOpen={() => navigate(`/item/${s.id}`)} />
            ))}
          </Row>
        </div>
      )}
    </div>
  )
}
