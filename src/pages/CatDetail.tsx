import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Star,
} from 'lucide-react'
import PlayerOverlay from '../components/PlayerOverlay'
import { trackChase, useChase } from '../lib/chase'
import {
  catDetail,
  catOpenConfig,
  catPlay,
  isPanAuthError,
  isPanLine,
  markPanSite,
  parsePlayLines,
  pickBestLine,
  type CatSite,
  type CatVod,
  type PlayingSource,
} from '../lib/cat'
import { cacheKey, ensureSites, recallVod, withTimeout } from '../lib/catSession'
import { probeWithScripts } from '../lib/userscript'

export default function CatDetailPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const siteKey = params.get('site') ?? ''
  const vodId = params.get('id') ?? ''
  const cached = recallVod(siteKey, vodId)

  const [vod, setVod] = useState<CatVod | null>(cached?.vod ?? null)
  const [lineIndex, setLineIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [needPanLogin, setNeedPanLogin] = useState(false)

  const [playing, setPlaying] = useState<PlayingSource | null>(null)
  const [exhausted, setExhausted] = useState(false)
  const [tip, setTip] = useState<string | null>(null)
  const queue = useRef<{ flag: string; id: string }[]>([])
  const autoBusy = useRef(false)
  /** 一次播放里只让用户脚本抢救一回，避免脚本给出坏地址后无限重试 */
  const rescued = useRef(false)

  // 站点对象必须来自 config（带着 /spider/xxx/3 这种 api 路径），自己按 key 拼会 404
  const [site, setSite] = useState<CatSite | null>(null)
  const siteName = cached?.siteName ?? siteKey

  // 追剧清单：播过的剧自动记下；详情页也能手动加入
  const chase = useChase()
  const inChase = chase.some((e) => e.key === cacheKey(siteKey, vodId))

  useEffect(() => {
    let alive = true
    ensureSites()
      .then((list) => {
        if (alive) setSite(list.find((s) => s.key === siteKey) ?? null)
      })
      .catch(() => {
        if (alive) setSite(null)
      })
    return () => {
      alive = false
    }
  }, [siteKey])

  const load = useCallback(async () => {
    if (!siteKey || !vodId || !site) return
    setLoading(true)
    setErr(null)
    try {
      const r = await withTimeout(catDetail(site, vodId), 15000)
      const full: CatVod = { ...(cached?.vod ?? {}), ...(r.list?.[0] ?? {}) }
      if (!full.vod_name) throw new Error('这个站点没返回详情，可能条目已失效')
      setVod(full)
      setLineIndex(pickBestLine(parsePlayLines(full)))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, vodId, site])

  useEffect(() => {
    void load()
  }, [load])

  const lines = useMemo(() => (vod ? parsePlayLines(vod) : []), [vod])
  const line = lines[lineIndex]
  const first = line?.episodes[0]

  /** 同一条线路播不动时，按「第几集」去其它线路找同名集做兜底 */
  const buildQueue = useCallback(
    (flag: string, id: string) => {
      const cur = lines.findIndex((l) => l.flag === flag)
      const epIdx = cur >= 0 ? Math.max(0, lines[cur].episodes.findIndex((e) => e.id === id)) : 0
      const q: { flag: string; id: string }[] = []
      for (const [i, l] of lines.entries()) {
        if (i === cur) continue
        if (isPanLine(l.flag) || l.episodes.length === 0) continue
        const ep = l.episodes[Math.min(epIdx, l.episodes.length - 1)]
        if (ep) q.push({ flag: l.flag, id: ep.id })
        if (q.length >= 5) break
      }
      queue.current = q
    },
    [lines],
  )

  /** 所有线路都失败时的最后一招：把当前地址交给用户脚本，看能不能抛出别的直链 */
  const rescueWithScripts = useCallback(async (): Promise<boolean> => {
    const cur = playing?.url
    if (!cur || rescued.current) return false
    rescued.current = true
    setTip('线路都播不动，正在用用户脚本抢救这个地址…')
    try {
      const r = await probeWithScripts(cur)
      if (r.links.length === 0) return false
      setPlaying({ url: r.links[0] })
      setTip(`脚本「${r.matched[0]}」换出了新地址，重试中…`)
      return true
    } catch {
      return false
    }
  }, [playing])

  const autoNext = useCallback(async () => {
    if (!site || autoBusy.current) return
    autoBusy.current = true
    try {
      if (queue.current.length === 0) {
        if (await rescueWithScripts()) return
        setTip('这条源播不动，换一个站点试试')
        setExhausted(true)
        return
      }
      setTip('这条线路播不动，正在自动换下一条…')
      while (queue.current.length > 0) {
        const next = queue.current.shift()
        if (!next) break
        try {
          const r = await catPlay(site, next.flag, next.id)
          if (r.url && r.url.startsWith('http')) {
            setPlaying({ url: r.url, header: r.header })
            setTip(null)
            return
          }
        } catch {
          /* 换下一条 */
        }
      }
      if (await rescueWithScripts()) return
      setTip('所有线路都试过了，换个站点再找找')
    } finally {
      autoBusy.current = false
    }
  }, [site, rescueWithScripts])

  const play = useCallback(
    async (flag: string, id: string) => {
      if (!site) {
        setErr('CAT 引擎还没就绪，稍等再点一次')
        return
      }
      setErr(null)
      setTip(null)
      setNeedPanLogin(false)
      setBusy(true)
      rescued.current = false
      buildQueue(flag, id)
      if (vod) {
        const curLine = lines.find((l) => l.flag === flag)
        trackChase({
          siteKey,
          siteName: site?.name || siteName,
          vod,
          episode: curLine?.episodes.find((e) => e.id === id)?.name,
          episodeCount: curLine?.episodes.length,
        })
      }
      try {
        const r = await catPlay(site, flag, id)
        if (!r.url) throw new Error(r.msg || '这条线路没有返回可用地址')
        if (r.url.startsWith('http')) setPlaying({ url: r.url, header: r.header })
        else throw new Error(`该线路返回的是可解析片段，暂时不支持：${r.url.slice(0, 60)}`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setErr(msg)
        if (isPanAuthError(msg)) {
          setNeedPanLogin(true)
          markPanSite(siteKey)
        }
      } finally {
        setBusy(false)
      }
    },
    [site, siteKey, siteName, vod, lines, buildQueue],
  )

  const goSearch = () => {
    if (vod?.vod_name) navigate(`/cat/search?name=${encodeURIComponent(vod.vod_name)}`)
  }

  return (
    <div className="h-full overflow-y-auto pb-16">
      {/* 上部分：海报 */}
      <section className="relative h-[318px] overflow-hidden">
        {vod?.vod_pic && (
          <img
            src={vod.vod_pic}
            alt=""
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-[6px]"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-[#07070c]/95 via-[#07070c]/65 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#07070c]/92 via-transparent to-[#07070c]/25" />

        <button
          onClick={() => navigate(-1)}
          className="glass-btn absolute left-10 top-6 z-10 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] text-white/85"
        >
          <ArrowLeft size={13} /> 返回
        </button>

        <div className="relative flex h-full items-center px-10 pt-3">
          <div className="glass-panel flex w-full items-center gap-7 rounded-2xl px-6 py-4">
            <div className="w-[172px] shrink-0">
              <PosterArt name={vod?.vod_name ?? '加载中'} pic={vod?.vod_pic} width={172} />
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <h1 className="truncate text-[26px] font-semibold leading-tight tracking-tight">
                {vod?.vod_name ?? '正在读取详情…'}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
                <span className="glass-chip rounded-full px-2 py-0.5 text-[10.5px] text-gold">{siteName}</span>
                {vod?.vod_year && <span>{vod.vod_year}</span>}
                {vod?.vod_area && <span>{vod.vod_area}</span>}
                {vod?.vod_remarks && <span>{vod.vod_remarks}</span>}
                {lines.length > 0 && <span>{lines.length} 条线路</span>}
              </div>
              {vod?.vod_actor && (
                <p className="mt-2 line-clamp-1 text-[11.5px] text-muted">主演：{vod.vod_actor}</p>
              )}
              {vod?.vod_content && (
                <p className="mt-3 line-clamp-3 max-w-[620px] text-[12px] leading-relaxed text-fg/65">
                  {vod.vod_content}
                </p>
              )}
            </div>
            <button
              disabled={!vod}
              onClick={() => {
                if (!vod) return
                if (inChase) navigate('/chase')
                else trackChase({ siteKey, siteName: site?.name || siteName, vod })
              }}
              title={inChase ? '去追剧清单查看' : '加入追剧清单'}
              className="glass-btn flex shrink-0 items-center gap-1.5 self-start rounded-lg px-3 py-2 text-[11.5px] text-muted transition hover:text-gold disabled:opacity-50"
            >
              <Star size={14} fill={inChase ? 'currentColor' : 'none'} />
              {inChase ? '已在追剧' : '加入追剧'}
            </button>
          </div>
        </div>
      </section>

      {/* 中间：播放按键 */}
      <section className="relative -mt-4 flex flex-col items-center px-10">
        {first ? (
          <>
            <button
              disabled={busy}
              onClick={() => void play(line.flag, first.id)}
              className="glass-primary group flex w-[300px] items-center justify-center gap-2.5 rounded-2xl py-3.5 text-[15px] font-semibold"
            >
              {busy ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Play size={18} fill="currentColor" className="transition group-hover:scale-110" />
              )}
              {busy ? '正在取直链…' : '立即播放'}
            </button>
            <p className="mt-2 text-[11px] text-muted/85">
              {line.flag} · {first.name}
              {isPanLine(line.flag) && ' · 这条线路需要登录网盘'}
            </p>
          </>
        ) : (
          <div className="glass-warn w-[420px] rounded-2xl px-4 py-3 text-center">
            <p className="text-[11.5px] leading-relaxed text-amber-200/90">
              {loading ? '正在解析这部片的播放线路…' : `「${siteName}」这个条目没有解析出可播线路`}
            </p>
            <div className="mt-2.5 flex items-center justify-center gap-2">
              <button
                onClick={goSearch}
                className="glass-primary inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12px] font-semibold"
              >
                <Search size={12} /> 去其它站点搜这部片
              </button>
              <button
                onClick={() => navigate('/userscript')}
                className="glass-btn inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11.5px] text-muted hover:text-gold"
              >
                用脚本解析网页
              </button>
            </div>
          </div>
        )}
      </section>

      {err && (
        <div className="glass-alert mx-10 mt-4 flex items-start gap-2 rounded-lg px-3 py-2 text-[11.5px] leading-relaxed text-red-200">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <span>{err}</span>
            {needPanLogin && (
              <button
                onClick={() => void catOpenConfig()}
                className="glass-primary mt-2 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold"
              >
                <KeyRound size={11} /> 去配置中心登录网盘
              </button>
            )}
          </div>
        </div>
      )}

      {loading && !vod && (
        <div className="mt-16 flex justify-center">
          <Loader2 className="animate-spin text-gold" size={20} />
        </div>
      )}

      {/* 线路 + 选集 */}
      {lines.length > 0 && (
        <section className="mt-7 px-10">
          {lines.length > 1 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {lines.map((l, i) => (
                <button
                  key={l.flag + i}
                  onClick={() => setLineIndex(i)}
                  className={`glass-chip rounded-md px-2.5 py-1 text-[11px] ${
                    i === lineIndex ? 'is-active text-gold' : 'text-muted'
                  }`}
                  title={l.flag}
                >
                  {l.flag} · {l.episodes.length} 集
                  {isPanLine(l.flag) && ' 🔒'}
                </button>
              ))}
            </div>
          )}

          {line && line.episodes.length > 0 && (
            <>
              <h2 className="mb-2.5 text-[13px] font-semibold">选集 · {line.episodes.length} 集</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
                {line.episodes.map((ep, i) => (
                  <button
                    key={ep.id + i}
                    disabled={busy}
                    onClick={() => void play(line.flag, ep.id)}
                    className="glass-chip truncate rounded-lg px-2 py-1.5 text-[11px] text-muted hover:text-gold disabled:opacity-50"
                    title={ep.name}
                  >
                    {ep.name.length > 10 ? ep.name.slice(0, 10) : ep.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      <section className="mt-7 flex gap-2 px-10">
        <button
          onClick={() => void load()}
          className="glass-btn flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] text-muted"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 刷新详情
        </button>
        <button
          onClick={goSearch}
          className="glass-btn flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] text-muted hover:text-gold"
        >
          <Search size={12} /> 换个站点找这部片
        </button>
      </section>

      {playing && (
        <PlayerOverlay
          url={playing.url}
          header={playing.header}
          tip={tip}
          onFail={() => void autoNext()}
          onSwitch={exhausted ? goSearch : undefined}
          onClose={() => {
            setPlaying(null)
            setTip(null)
            setExhausted(false)
            queue.current = []
          }}
        />
      )}
    </div>
  )
}

/** 纯海报图，不带文字，适合详情页大图位 */
function PosterArt({ name, pic, width }: { name: string; pic?: string; width: number }) {
  const [broken, setBroken] = useState(false)
  const hue = (name.charCodeAt(0) * 37 + (name.charCodeAt(1) || 11) * 13) % 360
  return (
    <div
      className="glass-poster overflow-hidden rounded-xl"
      style={{ width, height: Math.round(width * 1.5) }}
    >
      {pic && !broken ? (
        <img
          src={pic}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center px-2 text-center text-[14px] leading-tight text-white/50"
          style={{
            background: `linear-gradient(155deg, hsl(${hue} 55% 24%) 0%, hsl(${(hue + 32) % 360} 44% 11%) 60%, #0b0b0f 100%)`,
          }}
        >
          {name.slice(0, 6)}
        </div>
      )}
    </div>
  )
}
