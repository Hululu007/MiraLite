import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Play,
  Puzzle,
  RefreshCw,
  Search,
  Star,
} from 'lucide-react'
import {
  tmdbRankings,
  onRankingsRefresh,
  type TmdbGroup,
  type TmdbItem,
  type TmdbRankings,
} from '../lib/tmdb'

/** 焦点影片按 TMDB 热度顺序取（正在热映 → 热门电影 → 热门剧集 → 高分榜），去重、有海报，最多 18 部 */
function pickCarouselItems(groups: TmdbGroup[]): TmdbItem[] {
  const picked: TmdbItem[] = []
  const seen = new Set<string>()
  const order = ['now_playing', 'popular_movie', 'popular_tv', 'top_rated_movie', 'top_rated_tv']
  const ordered = [...groups].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  for (const g of ordered) {
    for (const it of g.items) {
      const key = it.title.replace(/\s+/g, '')
      if (!key || seen.has(key) || !it.poster) continue
      seen.add(key)
      picked.push(it)
      if (picked.length >= 18) return picked
    }
  }
  return picked
}

/** 榜单副标题：按榜单类型给准确说明 */
function rankingSubtitle(key: string): string {
  if (key === 'now_playing') return '近期上映 · 点海报搜全站可播线路'
  if (key === 'top_rated_movie' || key === 'top_rated_tv') return 'TMDB 高分 · 点海报搜全站可播线路'
  return 'TMDB 热门 · 点海报搜全站可播线路'
}

/**
 * 3D 立体旋转轮播（coverflow 风格）。
 *
 * 用 requestAnimationFrame 驱动一个连续的旋转角度 angle（单位=卡片索引），
 * 每张卡片按与 angle 的环形最短距离摆位，整个环廊匀速平滑转动。
 * - 旋转角用 tanh 饱和在 ±58°，边缘卡片不会转过 90° 翻到背面
 * - translateZ 后退刻意压小：透视会把远处卡片吸向中心，后退太多两侧就空了
 * - 一次渲染中心 ±4 共 9 张，配合间距/后退参数刚好铺满两侧
 * - 鼠标悬停 / 键盘聚焦时暂停；点击卡片或箭头/指示点缓动到目标角度
 */
function HotCarousel({
  items,
  onOpen,
  onRefresh,
  loading,
  live,
  totalCount,
  updatedAt,
  stale,
}: {
  items: TmdbItem[]
  onOpen: (name: string) => void
  onRefresh: () => void
  loading: boolean
  live: boolean
  totalCount: number
  updatedAt: number | null
  stale: boolean
}) {
  const pausedRef = useRef(false)
  const angleRef = useRef(0)
  const targetRef = useRef<number | null>(null)
  const [angle, setAngle] = useState(0)
  const total = items.length

  // 数据长度变化时把角度收敛到合法范围，不强制回第一张（后台静默刷新不跳帧）
  useEffect(() => {
    if (!total) return
    angleRef.current = ((angleRef.current % total) + total) % total
    targetRef.current = null
    setAngle(angleRef.current)
  }, [total])

  // 连续自动旋转：悬停暂停；点击箭头/卡片时缓动到目标角度
  useEffect(() => {
    if (total <= 1) return
    let raf = 0
    let last = performance.now()
    const SPEED = 0.00022 // 张/毫秒 ≈ 4.5 秒转一张
    const tick = (now: number) => {
      const dt = Math.min(now - last, 50)
      last = now
      const target = targetRef.current
      if (target !== null) {
        const diff = target - angleRef.current
        if (Math.abs(diff) < 0.003) {
          angleRef.current = target
          targetRef.current = null
        } else {
          angleRef.current += diff * Math.min(1, dt / 170)
        }
      } else if (!pausedRef.current) {
        angleRef.current += SPEED * dt
      }
      if (angleRef.current >= total) angleRef.current -= total
      if (angleRef.current < 0) angleRef.current += total
      setAngle(angleRef.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [total])

  if (total === 0) return null

  const centerIndex = ((Math.round(angle) % total) + total) % total

  /** 平滑转到某张卡片，走环形最短路径 */
  const goTo = (i: number) => {
    const cur = angleRef.current
    let target = ((i % total) + total) % total
    while (target - cur > total / 2) target -= total
    while (target - cur < -total / 2) target += total
    targetRef.current = target
  }

  const timeText = updatedAt
    ? new Date(updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <section className="relative mb-8">
      <div
        className="relative mx-10 h-[330px] overflow-hidden sm:h-[370px]"
        style={{ perspective: '1400px', perspectiveOrigin: '50% 45%' }}
        onMouseEnter={() => (pausedRef.current = true)}
        onMouseLeave={() => (pausedRef.current = false)}
        onFocusCapture={() => (pausedRef.current = true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) pausedRef.current = false
        }}
      >
        <div className="absolute inset-0" style={{ transformStyle: 'preserve-3d' }}>
          {items.map((it, i) => {
            // 环形最短距离：让首尾相邻，旋转连续
            let offset = i - angle
            if (offset > total / 2) offset -= total
            if (offset < -total / 2) offset += total
            const abs = Math.abs(offset)
            if (abs > 4) return null

            const isCenter = abs < 0.5
            const rotateY = -58 * Math.tanh(offset * 0.55)
            const z = -abs * 55
            const x = offset * 175
            const scale = Math.max(0.6, 1 - abs * 0.075)
            const opacity = Math.max(0.5, 1 - abs * 0.12)
            const zIndex = total - abs

            return (
              <button
                key={`${it.mediaType}-${it.id}`}
                aria-label={isCenter ? `搜索 ${it.title}` : `旋转到 ${it.title}`}
                onClick={() => (isCenter ? onOpen(it.title) : goTo(i))}
                className="glass-poster absolute left-1/2 top-1/2 h-[272px] w-[190px] cursor-pointer overflow-hidden rounded-2xl text-left outline-none sm:h-[292px] sm:w-[204px]"
                style={{
                  transform: `translate(-50%, -50%) translateX(${x}px) translateZ(${z}px) rotateY(${rotateY}deg) scale(${scale})`,
                  opacity,
                  zIndex,
                  filter: isCenter ? 'none' : `brightness(${Math.max(0.68, 1 - abs * 0.08)})`,
                }}
              >
                <PosterArt item={it} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/25" />
                <div className="glass-sheen" />

                <span className="absolute left-3 top-3 flex h-6 items-center gap-1 rounded-md bg-black/55 px-1.5 text-[10.5px] font-semibold text-gold backdrop-blur-sm">
                  <Star size={10} fill="currentColor" /> {it.rating.toFixed(1)}
                </span>

                {isCenter && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gold text-black shadow-xl">
                      <Play size={18} fill="currentColor" />
                    </span>
                  </div>
                )}

                <div className="absolute inset-x-0 bottom-0 p-3.5">
                  <div className="line-clamp-2 text-[15px] font-semibold leading-snug text-white drop-shadow">
                    {it.title}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-white/65">
                    {it.year && <span>{it.year}</span>}
                    <span>·</span>
                    <span>{it.mediaType === 'tv' ? '剧集' : '电影'}</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* 头部信息卡已去掉，右上角保留一个极简刷新入口 */}
        <button
          onClick={onRefresh}
          disabled={loading}
          title={`忽略缓存重新拉取榜单${timeText ? `（上次更新 ${timeText}）` : ''}`}
          className="glass-btn absolute right-3 top-3 z-[100] flex h-8 w-8 items-center justify-center rounded-full text-fg/70 hover:text-gold disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>

        {/* 左下角极简数据状态，不占版面 */}
        <div className="pointer-events-none absolute bottom-2 left-3 z-[100] text-[10px] text-muted/75">
          TMDB · {totalCount} 部 · {live ? '实时' : '离线'}
          {timeText && <> · 更新于 {timeText}</>}
          {stale && <span className="text-gold/90"> · 后台更新中</span>}
        </div>

        <button
          aria-label="上一个"
          onClick={() => goTo(centerIndex - 1)}
          className="glass-btn absolute left-3 top-1/2 z-[100] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-fg/85 hover:text-gold"
        >
          <ChevronLeft size={19} />
        </button>
        <button
          aria-label="下一个"
          onClick={() => goTo(centerIndex + 1)}
          className="glass-btn absolute right-3 top-1/2 z-[100] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-fg/85 hover:text-gold"
        >
          <ChevronRight size={19} />
        </button>
      </div>

      <div className="mt-1 flex items-center justify-center gap-1.5">
        {Array.from({ length: Math.min(total, 18) }, (_, i) => (
          <button
            key={i}
            aria-label={`旋转到第 ${i + 1} 张`}
            onClick={() => goTo(i)}
            className={`h-1.5 rounded-full transition-all ${
              i === centerIndex ? 'w-5 bg-gold' : 'w-1.5 bg-white/25 hover:bg-white/50'
            }`}
          />
        ))}
      </div>
    </section>
  )
}

/** 榜单横向海报行 */
function RankingRow({ group, onOpen }: { group: TmdbGroup; onOpen: (name: string) => void }) {
  return (
    <section className="animate-fade-up">
      <div className="mb-3 flex items-end justify-between px-10">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-fg">{group.label}</h2>
          <p className="mt-0.5 text-[11.5px] text-muted">{rankingSubtitle(group.key)}</p>
        </div>
        <span className="glass-chip flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-muted">
          <Search size={11} /> 跨站搜索
        </span>
      </div>
      <div className="no-scrollbar flex gap-3 overflow-x-auto px-10 pb-2">
        {group.items.map((it) => (
          <MiniPoster key={`${it.mediaType}-${it.id}`} item={it} onClick={() => onOpen(it.title)} />
        ))}
      </div>
    </section>
  )
}

/** 榜单小海报卡片 */
function MiniPoster({ item, onClick }: { item: TmdbItem; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={`${item.title} · ${item.rating.toFixed(1)}`}
      className="glass-poster group relative h-[240px] w-[160px] shrink-0 overflow-hidden rounded-xl text-left outline-none transition duration-300 ease-out hover:-translate-y-1"
    >
      <PosterArt item={item} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/20" />
      <div className="glass-sheen" />
      <span className="absolute right-2 top-2 flex items-center gap-0.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-gold backdrop-blur-sm">
        <Star size={9} fill="currentColor" /> {item.rating.toFixed(1)}
      </span>
      <div className="absolute inset-x-0 bottom-0 p-2.5">
        <div className="line-clamp-2 text-[12.5px] font-semibold leading-snug text-white drop-shadow">
          {item.title}
        </div>
        <div className="mt-0.5 text-[10px] text-white/60">{item.year}</div>
      </div>
    </button>
  )
}

/** TMDB 海报图，加载失败回退渐变占位 */
function PosterArt({ item }: { item: TmdbItem }) {
  const [broken, setBroken] = useState(false)
  if (!item.poster || broken) {
    const hue = (item.title.charCodeAt(0) * 37 + (item.title.charCodeAt(1) || 11) * 13) % 360
    return (
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(155deg, hsl(${hue} 55% 24%) 0%, hsl(${(hue + 32) % 360} 44% 11%) 60%, #0b0b0f 100%)`,
        }}
      />
    )
  }
  return (
    <img
      src={item.poster}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="absolute inset-0 h-full w-full object-cover"
    />
  )
}

export default function HomePage() {
  const navigate = useNavigate()
  const [groups, setGroups] = useState<TmdbGroup[] | null>(null)
  const [live, setLive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [stale, setStale] = useState(false)
  const hasDataRef = useRef(false)

  const apply = useCallback((data: TmdbRankings) => {
    if (!data.groups.length) throw new Error('没有拿到任何影视榜单')
    setGroups(data.groups)
    setLive(data.live)
    setUpdatedAt(data.updatedAt ?? null)
    setStale(!!data.stale)
    hasDataRef.current = true
  }, [])

  const load = useCallback(
    async (force = false) => {
      // 延迟显示 loading：缓存命中时秒开，不闪 spinner
      let timer: number | undefined
      if (force || !hasDataRef.current) {
        timer = window.setTimeout(() => setLoading(true), 120)
      }
      setErr(null)
      try {
        apply(await tmdbRankings({ force }))
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (timer) window.clearTimeout(timer)
        setLoading(false)
      }
    },
    [apply],
  )

  useEffect(() => {
    void load()
  }, [load])

  // 后台静默刷新完成后无缝换上新数据，不显示 loading
  useEffect(
    () =>
      onRankingsRefresh((data) => {
        try {
          apply(data)
        } catch {
          /* 空榜单忽略 */
        }
      }),
    [apply],
  )

  const searchFor = (name: string) => navigate(`/cat/search?name=${encodeURIComponent(name)}`)

  const carouselItems = useMemo(() => pickCarouselItems(groups ?? []), [groups])
  const totalCount = useMemo(
    () => new Set((groups ?? []).flatMap((g) => g.items).map((x) => x.mediaType + x.id)).size,
    [groups],
  )

  return (
    <div className="pb-16">
      <button
        onClick={() => navigate('/userscript/manage')}
        title="用户脚本"
        className="glass-btn fixed right-4 top-[72px] z-20 flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] text-fg/70 hover:text-gold"
      >
        <Puzzle size={12} /> 脚本
      </button>

      {err && !groups && (
        <section className="glass-panel mx-10 mb-6 mt-6 rounded-2xl p-6">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <AlertCircle size={15} className="text-amber-300" />
            影视榜单加载失败
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">{err}</p>
          <button
            onClick={() => void load(true)}
            className="glass-primary mt-4 flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12.5px] font-semibold"
          >
            重试
          </button>
        </section>
      )}

      {carouselItems.length > 0 && (
        <HotCarousel
          items={carouselItems}
          onOpen={searchFor}
          onRefresh={() => void load(true)}
          loading={loading}
          live={live}
          totalCount={totalCount}
          updatedAt={updatedAt}
          stale={stale}
        />
      )}

      {loading && !groups && (
        <div className="glass-panel mx-10 mt-16 flex flex-col items-center gap-3 rounded-2xl px-6 py-10 text-[12px] text-muted">
          <Loader2 size={20} className="animate-spin text-gold" />
          正在拉取 TMDB 影视榜单…
        </div>
      )}

      <div className="space-y-8">
        {(groups ?? [])
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <RankingRow key={g.key} group={g} onOpen={searchFor} />
          ))}
      </div>
    </div>
  )
}
