import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clapperboard, Clock3, Play, Plus, Star, Trash2, X } from 'lucide-react'
import { readHotCache, type HotItem } from '../lib/catSession'
import {
  clearChase,
  removeChase,
  toggleStar,
  trackChase,
  useChase,
  type ChaseEntry,
} from '../lib/chase'

function ago(ts: number): string {
  const d = Math.max(0, Date.now() - ts)
  if (d < 60_000) return '刚刚'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)} 天前`
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function hueOf(name: string): number {
  return (name.charCodeAt(0) * 37 + (name.charCodeAt(1) || 11) * 13) % 360
}

function ChaseCard({ entry, onOpen }: { entry: ChaseEntry; onOpen: () => void }) {
  const [broken, setBroken] = useState(false)
  const hue = hueOf(entry.name)
  return (
    <div className="glass-panel group flex gap-3 overflow-hidden rounded-2xl p-3">
      <button
        onClick={onOpen}
        aria-label={`打开 ${entry.name}`}
        className="glass-poster relative h-[132px] w-[88px] shrink-0 overflow-hidden rounded-xl"
      >
        {entry.pic && !broken ? (
          <img
            src={entry.pic}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center p-1.5 text-center text-[11px] leading-tight text-white/55"
            style={{
              background: `linear-gradient(155deg, hsl(${hue} 55% 24%) 0%, hsl(${(hue + 32) % 360} 44% 11%) 60%, #0b0b0f 100%)`,
            }}
          >
            {entry.name.slice(0, 6)}
          </div>
        )}
        <div className="glass-sheen" />
      </button>

      <div className="flex min-w-0 flex-1 flex-col">
        <button
          onClick={onOpen}
          className="truncate text-left text-[14px] font-semibold text-fg transition hover:text-gold"
        >
          {entry.name}
        </button>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted">
          <span className="glass-chip rounded-full px-2 py-0.5 text-gold/90">{entry.siteName}</span>
          {entry.year && <span>{entry.year}</span>}
          {entry.remarks && <span className="max-w-[130px] truncate">{entry.remarks}</span>}
        </div>

        <div className="mt-auto pt-2">
          <p className="flex items-center gap-1 truncate text-[11px] text-fg/70">
            <Play size={10} className="shrink-0 text-gold" />
            {entry.episode ? `看到 ${entry.episode}` : '还没开始看'}
            {(entry.episodeCount ?? 0) > 0 && (
              <span className="text-muted/60"> · 共 {entry.episodeCount} 集</span>
            )}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted/60">
            <Clock3 size={10} /> {ago(entry.updatedAt)}更新
          </p>

          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              onClick={onOpen}
              className="glass-primary flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-semibold"
            >
              <Play size={11} fill="currentColor" /> 继续追
            </button>
            <button
              onClick={() => toggleStar(entry.key)}
              title={entry.starred ? '取消收藏' : '收藏'}
              className={`glass-btn flex h-[29px] w-[29px] items-center justify-center rounded-lg ${
                entry.starred ? 'text-gold' : 'text-muted hover:text-gold'
              }`}
            >
              <Star size={13} fill={entry.starred ? 'currentColor' : 'none'} />
            </button>
            <button
              onClick={() => removeChase(entry.key)}
              title="从追剧移除"
              className="glass-btn flex h-[29px] w-[29px] items-center justify-center rounded-lg text-muted hover:text-red-300"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function HotPick({
  item,
  tracked,
  onAdd,
  onOpen,
}: {
  item: HotItem
  tracked: boolean
  onAdd: () => void
  onOpen: () => void
}) {
  const [broken, setBroken] = useState(false)
  const name = item.vod.vod_name
  const hue = hueOf(name)
  return (
    <div className="glass-panel flex w-[164px] shrink-0 flex-col overflow-hidden rounded-xl p-2">
      <button
        onClick={onOpen}
        className="glass-poster relative aspect-[2/3] overflow-hidden rounded-lg"
        title={name}
      >
        {item.vod.vod_pic && !broken ? (
          <img
            src={item.vod.vod_pic}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center p-2 text-center text-[12px] text-white/50"
            style={{
              background: `linear-gradient(155deg, hsl(${hue} 55% 24%) 0%, hsl(${(hue + 32) % 360} 44% 11%) 60%, #0b0b0f 100%)`,
            }}
          >
            {name.slice(0, 6)}
          </div>
        )}
        <div className="glass-sheen" />
      </button>
      <div className="mt-2 truncate text-[11.5px] font-medium text-fg/90" title={name}>
        {name}
      </div>
      <div className="mt-0.5 truncate text-[10px] text-muted">{item.siteName}</div>
      <button
        onClick={onAdd}
        disabled={tracked}
        className="glass-btn mt-2 flex items-center justify-center gap-1 rounded-md py-1.5 text-[10.5px] disabled:opacity-50"
      >
        <Plus size={11} /> {tracked ? '已在追' : '加入追剧'}
      </button>
    </div>
  )
}

export default function ChasePage() {
  const navigate = useNavigate()
  const entries = useChase()
  const [onlyStarred, setOnlyStarred] = useState(false)

  const trackedKeys = useMemo(() => new Set(entries.map((e) => e.key)), [entries])
  const shown = useMemo(
    () => (onlyStarred ? entries.filter((e) => e.starred) : entries),
    [entries, onlyStarred],
  )

  // 首页热门缓存里挑一批可一键加入的剧，避免新用户进来是一片空白
  const hot = useMemo<HotItem[]>(() => {
    const picked: HotItem[] = []
    const seen = new Set<string>()
    for (const sec of readHotCache() ?? []) {
      for (const it of sec.items) {
        if (!it.vod?.vod_name) continue
        const k = it.vod.vod_name.replace(/\s+/g, '')
        if (seen.has(k)) continue
        seen.add(k)
        picked.push(it)
        if (picked.length >= 12) break
      }
      if (picked.length >= 12) break
    }
    return picked
  }, [])

  const openDetail = (siteKey: string, vodId: string) =>
    navigate(`/cat/item?site=${encodeURIComponent(siteKey)}&id=${encodeURIComponent(vodId)}`)

  return (
    <div className="pb-16">
      <section className="mx-10 mb-5 flex items-end justify-between pt-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-gold/15 px-1.5 py-0.5 text-[10px] font-medium text-gold">
              我的片单
            </span>
            <span className="text-[11px] text-muted/70">{entries.length} 部在追</span>
          </div>
          <h1 className="mt-1.5 text-[20px] font-semibold tracking-tight">追剧</h1>
          <p className="mt-0.5 text-[11.5px] text-muted">
            播过的剧会自动记在这里，点「继续追」回到选集
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="glass-panel flex rounded-lg p-0.5">
            <button
              onClick={() => setOnlyStarred(false)}
              className={`rounded-md px-3 py-1.5 text-[11px] transition ${
                !onlyStarred ? 'bg-gold/15 text-gold' : 'text-muted hover:text-fg'
              }`}
            >
              全部
            </button>
            <button
              onClick={() => setOnlyStarred(true)}
              className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-[11px] transition ${
                onlyStarred ? 'bg-gold/15 text-gold' : 'text-muted hover:text-fg'
              }`}
            >
              <Star size={11} fill={onlyStarred ? 'currentColor' : 'none'} /> 收藏
            </button>
          </div>
          {entries.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm('确定清空追剧清单？这个操作不能撤销。')) clearChase()
              }}
              className="glass-btn flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] text-muted hover:text-red-300"
            >
              <Trash2 size={12} /> 清空
            </button>
          )}
        </div>
      </section>

      {entries.length === 0 ? (
        <div className="glass-panel mx-10 flex flex-col items-center gap-3 rounded-2xl px-6 py-12 text-center">
          <div className="glass-logo flex h-12 w-12 items-center justify-center rounded-2xl text-gold">
            <Clapperboard size={22} />
          </div>
          <div className="text-[14px] font-medium">还没有在追的剧</div>
          <p className="max-w-[440px] text-[11.5px] leading-relaxed text-muted">
            在首页点一张热门海报，进入详情选一集播放，就会自动记到这里；也可以直接在下面点「加入追剧」。
          </p>
          <button
            onClick={() => navigate('/')}
            className="glass-primary mt-1 flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-semibold"
          >
            去首页找剧
          </button>
        </div>
      ) : shown.length === 0 ? (
        <div className="glass-panel mx-10 rounded-2xl px-6 py-12 text-center text-[12px] text-muted">
          还没有收藏的剧，点卡片上的 ☆ 就能收进这里
        </div>
      ) : (
        <div className="mx-10 grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
          {shown.map((e) => (
            <ChaseCard
              key={e.key}
              entry={e}
              onOpen={() => openDetail(e.siteKey, e.vodId)}
            />
          ))}
        </div>
      )}

      {hot.length > 0 && (
        <section className="mt-9">
          <div className="mb-3 flex items-end justify-between px-10">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-fg">热门剧集 · 一键追</h2>
              <p className="mt-0.5 text-[11.5px] text-muted">来自首页热门缓存，先加入再慢慢看</p>
            </div>
            <span className="glass-chip rounded-full px-2.5 py-1 text-[11px] text-muted">
              点海报进详情
            </span>
          </div>
          <div className="no-scrollbar flex gap-3 overflow-x-auto px-10 pb-2">
            {hot.map((it) => (
              <HotPick
                key={`${it.siteKey}-${it.vod.vod_id}`}
                item={it}
                tracked={trackedKeys.has(`${it.siteKey}::${it.vod.vod_id}`)}
                onAdd={() =>
                  trackChase({ siteKey: it.siteKey, siteName: it.siteName, vod: it.vod })
                }
                onOpen={() => openDetail(it.siteKey, it.vod.vod_id)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
