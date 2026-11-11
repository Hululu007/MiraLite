import { useCallback, useEffect, useRef, useState } from 'react'
import PlayerOverlay from '../components/PlayerOverlay'
import { trackChase } from '../lib/chase'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Loader2,
  Lock,
  Play,
  Plug,
  RefreshCw,
  X,
} from 'lucide-react'
import {
  catCategory,
  catConfig,
  catActiveUrl,
  catDetail,
  catHome,
  catOpenConfig,
  catPanStatus,
  catPlay,
  catSearch,
  catStart,
  catStatus,
  inTauri,
  isPanAuthError,
  markPanSite,
  isPanLine,
  panSiteKeys,
  parsePlayLines,
  pickBestLine,
  type CatClass,
  type CatSite,
  type CatVod,
  type PanProvider,
  type PlayingSource,
} from '../lib/cat'
import { activeSubscription, addSubscription } from '../lib/catSession'


export default function CatPage() {
  const [ready, setReady] = useState<boolean | null>(null)
  const [url, setUrl] = useState(() => activeSubscription()?.url ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [sites, setSites] = useState<CatSite[]>([])
  const [keyword, setKeyword] = useState('')
  const [site, setSite] = useState<CatSite | null>(null)

  const [classes, setClasses] = useState<CatClass[]>([])
  const [activeClass, setActiveClass] = useState<string>('')
  const [list, setList] = useState<CatVod[]>([])
  const [page, setPage] = useState(1)
  const [pagecount, setPagecount] = useState(1)
  const [total, setTotal] = useState(0)
  const [loadingList, setLoadingList] = useState(false)

  const [detail, setDetail] = useState<CatVod | null>(null)
  const [lineIndex, setLineIndex] = useState(0)
  const [playing, setPlaying] = useState<PlayingSource | null>(null)
  const [playTip, setPlayTip] = useState<string | null>(null)
  const playQueue = useRef<{ flag: string; id: string }[]>([])
  const autoBusy = useRef(false)

  const [pan, setPan] = useState<Record<string, PanProvider>>({})
  const [needPanLogin, setNeedPanLogin] = useState(false)
  const [panKeys, setPanKeys] = useState<Set<string>>(() => panSiteKeys())
  const [onlyFree, setOnlyFree] = useState(false)

  const refreshPan = useCallback(async () => {
    setPan(await catPanStatus())
  }, [])

  const openConfig = useCallback(async () => {
    try {
      await catOpenConfig()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // 用户在浏览器里登录完网盘、切回应用时，自动重查一次登录态
  useEffect(() => {
    if (!ready) return
    void refreshPan()
    const onFocus = () => void refreshPan()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [ready, refreshPan])

  const connectWith = useCallback(async (target: string) => {
    setBusy(true)
    setErr(null)
    try {
      const boot = await catStart(target)
      const cfg = await catConfig()
      if (cfg.length === 0) throw new Error('引擎起来了，但配置里没有任何可用站点')
      setSites(cfg)
      setReady(true)
      setErr(null)
      // 顺手存进订阅列表，设置页里也能看到、切换
      try {
        addSubscription(target)
      } catch {
        /* 已存在就忽略 */
      }
      void boot
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setReady(false)
    } finally {
      setBusy(false)
    }
  }, [])

  const connect = useCallback(() => connectWith(url.trim()), [connectWith, url])

  useEffect(() => {
    if (!inTauri()) {
      setReady(false)
      return
    }
    void (async () => {
      try {
        const port = await catStatus()
        const running = await catActiveUrl()
        if (port && running) {
          setUrl(running)
          setSites(await catConfig())
          setReady(true)
          return
        }
        const saved = activeSubscription()
        if (saved) {
          setUrl(saved.url)
          await connectWith(saved.url)
        } else {
          setReady(false)
        }
      } catch {
        setReady(false)
      }
    })()
  }, [connectWith])

  const openSite = useCallback(async (s: CatSite) => {
    setSite(s)
    setDetail(null)
    setList([])
    setClasses([])
    setActiveClass('')
    setKeyword('')
    setLoadingList(true)
    try {
      const home = await catHome(s)
      const cls = home.class ?? []
      setClasses(cls)
      const first = cls[0]?.type_id ?? ''
      setActiveClass(first)
      if (home.list && home.list.length > 0) {
        setList(home.list)
        setPagecount(home.pagecount || 1)
        setTotal(home.total || home.list.length)
      } else if (first) {
        const r = await catCategory(s, first, 1)
        setList(r.list ?? [])
        setPage(r.page || 1)
        setPagecount(r.pagecount || 1)
        setTotal(r.total || 0)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingList(false)
    }
  }, [])

  const loadCategory = useCallback(
    async (s: CatSite, id: string, p: number) => {
      setLoadingList(true)
      setErr(null)
      try {
        const r = await catCategory(s, id, p)
        setList(r.list ?? [])
        setPage(r.page || p)
        setPagecount(r.pagecount || 1)
        setTotal(r.total || 0)
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
        setList([])
      } finally {
        setLoadingList(false)
      }
    },
    [],
  )

  const openDetail = useCallback(async (s: CatSite, v: CatVod) => {
    setDetail(v)
    setLineIndex(0)
    try {
      const r = await catDetail(s, v.vod_id)
      const full: CatVod = { ...v, ...(r.list?.[0] ?? {}) }
      setDetail(full)
      setLineIndex(pickBestLine(parsePlayLines(full)))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const findElsewhere = useCallback(
    async (name: string) => {
      const cands = sites
        .filter((s) => s.searchable !== 0 && !panKeys.has(s.key) && s.key !== site?.key)
        .slice(0, 16)
      type Hit = { s: CatSite; vod: CatVod; idx: number }
      const box: { primary?: Hit; fallback?: Hit } = {}
      let stop = false
      const queue = [...cands]

      const run = async () => {
        while (queue.length > 0 && !box.primary && !stop) {
          const s = queue.shift()
          if (!s) continue
          try {
            const r = await withTimeout(catSearch(s, name, 1), 6000)
            const hits = r.list ?? []
            if (hits.length === 0) continue
            const hit = hits.find((v) => (v.vod_name ?? '').includes(name)) ?? hits[0]
            const d = await withTimeout(catDetail(s, hit.vod_id), 8000)
            const full: CatVod = { ...hit, ...(d.list?.[0] ?? {}) }
            const lines = parsePlayLines(full)
            if (lines.length === 0) continue
            const best = pickBestLine(lines)
            const item: Hit = { s, vod: full, idx: best }
            if (!isPanLine(lines[best]?.flag ?? '')) {
              box.primary = item
              stop = true
              return
            }
            if (!box.fallback) box.fallback = item
          } catch {
            // 这个站点不行，继续
          }
        }
      }
      await Promise.all([run(), run(), run(), run()])

      const pick = box.primary ?? box.fallback
      if (!pick) return null
      await openSite(pick.s)
      setDetail(pick.vod)
      setLineIndex(pick.idx)
      return pick.s.name
    },
    [sites, panKeys, site, openSite],
  )

  // 这条线路播不动时，按「第几集」去其他线路找同名集，做自动兜底
  const buildQueue = useCallback(
    (flag: string, id: string) => {
      const lines = detail ? parsePlayLines(detail) : []
      const cur = lines.findIndex((l) => l.flag === flag)
      const epIdx = cur >= 0 ? Math.max(0, lines[cur].episodes.findIndex((e) => e.id === id)) : 0
      const rest = lines
        .map((l, i) => ({ l, i }))
        .filter(({ i, l }) => i !== cur && l.episodes.length > 0)
        .sort((a, b) => Number(isPanLine(a.l.flag)) - Number(isPanLine(b.l.flag)))
      const q: { flag: string; id: string }[] = []
      for (const { l } of rest) {
        const ep = l.episodes[Math.min(epIdx, l.episodes.length - 1)]
        if (ep && !isPanLine(l.flag)) q.push({ flag: l.flag, id: ep.id })
        if (q.length >= 5) break
      }
      playQueue.current = q
    },
    [detail],
  )

  // 播放失败自动切换到下一条线路
  const autoNext = useCallback(async () => {
    if (autoBusy.current) return
    autoBusy.current = true
    try {
      if (playQueue.current.length === 0) {
        setPlayTip('所有线路都试过了，回列表换个站点或换一部吧')
        return
      }
      setPlayTip('这条线路播不动，正在自动换下一条…')
      const cur = site
      if (!cur) return
      while (playQueue.current.length > 0) {
        const next = playQueue.current.shift()
        if (!next) break
        try {
          const r = await catPlay(cur, next.flag, next.id)
          if (r.url && r.url.startsWith('http')) {
            setPlaying({ url: r.url, header: r.header })
            setPlayTip(null)
            return
          }
        } catch {
          // 换下一条
        }
      }
      setPlayTip('所有线路都试过了，回列表换个站点或换一部吧')
    } finally {
      autoBusy.current = false
    }
  }, [site])

  const doPlay = useCallback(
    async (s: CatSite, flag: string, id: string) => {
      setErr(null)
      setPlayTip(null)
      buildQueue(flag, id)
      setNeedPanLogin(false)
      setBusy(true)
      if (detail) {
        const curLine = parsePlayLines(detail).find((l) => l.flag === flag)
        trackChase({
          siteKey: s.key,
          siteName: s.name,
          vod: detail,
          episode: curLine?.episodes.find((e) => e.id === id)?.name,
          episodeCount: curLine?.episodes.length,
        })
      }
      try {
        const r = await catPlay(s, flag, id)
        if (!r.url) throw new Error(r.msg || '这个线路没有返回可用地址')
        if (r.url.startsWith('http')) setPlaying({ url: r.url, header: r.header })
        else throw new Error(`该线路返回的是可解析片段，MiraLite 暂不支持：${r.url.slice(0, 60)}`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setErr(msg)
        if (isPanAuthError(msg)) {
          setNeedPanLogin(true)
          markPanSite(s.key)
          setPanKeys(panSiteKeys())
          void refreshPan()
        }
      } finally {
        setBusy(false)
      }
    },
    [refreshPan, buildQueue, detail],
  )

  const freeCount = sites.filter((s) => !panKeys.has(s.key)).length
  const filtered = sites.filter((s) => {
    if (onlyFree && panKeys.has(s.key)) return false
    const k = keyword.trim().toLowerCase()
    return !k || s.name.toLowerCase().includes(k)
  })

  if (ready === null) {
    return <Centered><Loader2 className="animate-spin text-gold" size={22} /></Centered>
  }

  if (!ready) {
    return (
      <Centered>
        <div className="glass-panel w-[520px] rounded-2xl p-6">
          <h1 className="text-[20px] font-semibold tracking-tight">CAT 接口</h1>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
            这类源不是播放列表，而是一整套 spider 运行时。填入订阅地址后，MiraLite 会下载并缓存它的
            index.js，用本机 Node 拉起本地服务，再从里面取站点与片单。
          </p>
          <p className="mt-2 text-[11.5px] text-gold/80">
            现在可以在「设置 → 片源 → 影视订阅」里保存多个订阅源并随时切换。这里连接只影响当前会话。
          </p>
          <label className="mt-5 block">
            <span className="mb-1.5 block text-[11.5px] text-muted">临时订阅地址</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://.../index.js.md5"
              className="glass-input h-9 w-full rounded-lg px-3 text-[12.5px] text-fg"
            />
          </label>
          <button
            onClick={connect}
            disabled={busy}
            className="glass-primary mt-4 flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12.5px] font-semibold"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
            {busy ? '正在启动引擎' : '连接'}
          </button>
          {!inTauri() && (
            <p className="mt-3 text-[11.5px] text-muted">浏览器预览里用不了，需要桌面版。</p>
          )}
          {err && <ErrBox text={err} />}
        </div>
      </Centered>
    )
  }

  return (
    <div className="flex h-full">
      {/* 站点栏 */}
      <aside className="glass-rail relative z-10 flex w-[208px] shrink-0 flex-col">
        <div className="px-3 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-medium">站点</span>
            <span className="text-[10.5px] text-muted">{sites.length}</span>
          </div>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="过滤"
            className="glass-input mb-2 h-7 w-full rounded-md px-2 text-[11.5px]"
          />
          <div className="mb-2 flex gap-1">
            <button
              onClick={() => setOnlyFree(false)}
              className={`glass-chip flex-1 rounded-md px-1 py-[3px] text-[10px] ${
                !onlyFree ? 'is-active text-gold' : 'text-muted'
              }`}
            >
              全部 {sites.length}
            </button>
            <button
              onClick={() => setOnlyFree(true)}
              className={`glass-chip flex-1 rounded-md px-1 py-[3px] text-[10px] ${
                onlyFree ? 'is-active text-gold' : 'text-muted'
              }`}
              title="这些站点直接出 m3u8/mp4 直链，不用登录任何网盘"
            >
              免登录 {freeCount}
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {filtered.map((s) => (
            <button
              key={s.key}
              onClick={() => openSite(s)}
              className={`glass-nav mb-1 flex w-full items-center gap-1 rounded-md border px-2 py-1.5 text-left text-[11.5px] ${
                site?.key === s.key ? 'is-active text-gold' : ''
              }`}
              title={s.name}
            >
              <span className="truncate">{s.name}</span>
              {panKeys.has(s.key) && (
                <Lock size={9} className="ml-auto shrink-0 text-amber-300/60" aria-label="需登录网盘" />
              )}
            </button>
          ))}
        </div>
        <PanBar pan={pan} onOpen={openConfig} />
      </aside>

      {/* 内容区 */}
      <section className="min-w-0 flex-1 overflow-y-auto px-7 pb-16 pt-5">
        {!site ? (
          <div className="mt-16 text-center text-[12.5px] text-muted">左侧选一个站点</div>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              <h2 className="text-[16px] font-semibold">{site.name}</h2>
              {total > 0 && <span className="text-[11px] text-muted">{total} 条</span>}
              <button
                onClick={() => openSite(site)}
                className="glass-btn ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted"
              >
                <RefreshCw size={11} /> 刷新
              </button>
            </div>

            {classes.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {classes.map((c) => (
                  <button
                    key={c.type_id}
                    onClick={() => {
                      setActiveClass(c.type_id)
                      void loadCategory(site, c.type_id, 1)
                    }}
                    className={`glass-chip rounded-full px-2.5 py-1 text-[11px] ${
                      activeClass === c.type_id ? 'is-active text-gold' : 'text-muted'
                    }`}
                  >
                    {c.type_name}
                  </button>
                ))}
              </div>
            )}

            {err && (
              <ErrBox text={err}>
                {needPanLogin && (
                  <button
                    onClick={() => void openConfig()}
                    className="glass-primary mt-2 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold"
                  >
                    <KeyRound size={11} /> 去配置中心登录网盘
                  </button>
                )}
              </ErrBox>
            )}

            {loadingList ? (
              <div className="mt-16 flex justify-center">
                <Loader2 className="animate-spin text-gold" size={20} />
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3">
                {list.map((v) => (
                  <button
                    key={v.vod_id}
                    onClick={() => openDetail(site, v)}
                    className="group text-left"
                  >
                    <div className="glass-poster relative aspect-[2/3] overflow-hidden rounded-lg">
                      {v.vod_pic ? (
                        <img
                          src={v.vod_pic}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover transition group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[10px] text-muted/50">
                          无封面
                        </div>
                      )}
                      <div className="glass-sheen" />
                      {v.vod_remarks && (
                        <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1 py-0.5 text-[9.5px] text-white/85">
                          {v.vod_remarks}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-fg/90">{v.vod_name}</div>
                  </button>
                ))}
              </div>
            )}

            {!loadingList && list.length === 0 && !err && (
              <div className="mt-16 text-center text-[12px] text-muted">这个分类没有内容</div>
            )}

            {pagecount > 1 && (
              <div className="mt-6 flex items-center justify-center gap-2 text-[11.5px] text-muted">
                <button
                  disabled={page <= 1}
                  onClick={() => void loadCategory(site, activeClass, page - 1)}
                  className="glass-btn rounded-md p-1 disabled:opacity-40"
                >
                  <ChevronLeft size={13} />
                </button>
                <span>
                  {page} / {pagecount}
                </span>
                <button
                  disabled={page >= pagecount}
                  onClick={() => void loadCategory(site, activeClass, page + 1)}
                  className="glass-btn rounded-md p-1 disabled:opacity-40"
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {detail && site && (
        <DetailDrawer
          site={site}
          vod={detail}
          busy={busy}
          lineIndex={lineIndex}
          onLine={setLineIndex}
          onPlay={(flag, id) => void doPlay(site, flag, id)}
          onClose={() => setDetail(null)}
          onOpenConfig={() => void openConfig()}
          isPanSite={panKeys.has(site.key)}
          onFindElsewhere={findElsewhere}
        />
      )}

      {playing && (
        <PlayerOverlay
          url={playing.url}
          header={playing.header}
          tip={playTip}
          onFail={() => void autoNext()}
          onClose={() => {
            setPlaying(null)
            setPlayTip(null)
            playQueue.current = []
          }}
        />
      )}
    </div>
  )
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then((v) => {
      clearTimeout(t)
      resolve(v)
    }).catch((e) => {
      clearTimeout(t)
      reject(e)
    })
  })
}

function DetailDrawer({
  site,
  vod,
  busy,
  lineIndex,
  onLine,
  onPlay,
  onClose,
  onOpenConfig,
  isPanSite,
  onFindElsewhere,
}: {
  isPanSite: boolean
  site: CatSite
  vod: CatVod
  busy: boolean
  lineIndex: number
  onLine: (i: number) => void
  onPlay: (flag: string, id: string) => void
  onClose: () => void
  onOpenConfig: () => void
  onFindElsewhere: (name: string) => Promise<string | null>
}) {
  const lines = parsePlayLines(vod)
  const line = lines[lineIndex]
  const first = line?.episodes[0]
  const [finding, setFinding] = useState(false)
  const [findMsg, setFindMsg] = useState<string | null>(null)

  const handleFind = async () => {
    setFinding(true)
    setFindMsg(null)
    const hitSite = await onFindElsewhere(vod.vod_name)
    setFinding(false)
    setFindMsg(hitSite ? `已在「${hitSite}」找到可播片源` : '其它站点也没找到可播片源，换个片名再搜搜')
  }
  return (
    <div className="glass-panel w-[340px] shrink-0 overflow-y-auto rounded-none p-4 pb-16">
      <div className="mb-3 flex items-start gap-2">
        <h3 className="flex-1 text-[14px] font-semibold leading-snug">{vod.vod_name}</h3>
        <button onClick={onClose} className="text-muted hover:text-fg">
          <X size={15} />
        </button>
      </div>
      {vod.vod_pic && (
        <img
          src={vod.vod_pic}
          alt=""
          referrerPolicy="no-referrer"
          className="glass-poster mb-3 max-h-[168px] w-full rounded-lg object-cover"
        />
      )}
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        {vod.vod_year && <span>{vod.vod_year}</span>}
        {vod.vod_area && <span>{vod.vod_area}</span>}
        {vod.vod_remarks && <span>{vod.vod_remarks}</span>}
      </div>

      {line && first ? (
        <button
          disabled={busy}
          onClick={() => onPlay(line.flag, first.id)}
          className="glass-primary mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-[13px] font-semibold"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
          {busy ? '正在取直链…' : `立即播放 · ${first.name}`}
        </button>
      ) : (
        <div className="glass-warn mb-3 rounded-lg px-2.5 py-2">
          <p className="text-[11.5px] leading-relaxed text-amber-200/90">
            「{site.name}」这个条目没解析出播放线路。
          </p>
          <button
            disabled={finding}
            onClick={() => void handleFind()}
            className="glass-primary mt-2 flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-[12px] font-semibold"
          >
            {finding ? <Loader2 size={13} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
            {finding ? '正在其它站点找片…' : '换个站点找这部片'}
          </button>
          {findMsg && <p className="mt-1.5 text-[11px] text-muted">{findMsg}</p>}
        </div>
      )}

      {vod.vod_content && (
        <p className="mb-3 line-clamp-6 text-[11.5px] leading-relaxed text-fg/75">{vod.vod_content}</p>
      )}

      {lines.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {lines.map((l, i) => (
            <button
              key={l.flag + i}
              onClick={() => onLine(i)}
              className={`glass-chip rounded-md px-2 py-0.5 text-[10.5px] ${
                i === lineIndex ? 'is-active text-gold' : 'text-muted'
              }`}
            >
              {l.flag}
            </button>
          ))}
        </div>
      )}

      {line && line.episodes.length > 0 && (
        <div className="mb-1.5 text-[10.5px] font-medium text-muted/70">选集 · {line.episodes.length} 集</div>
      )}
      {line && (
        <div className="grid grid-cols-4 gap-1.5">
          {line.episodes.map((ep, i) => (
            <button
              key={ep.id + i}
              disabled={busy}
              onClick={() => onPlay(line.flag, ep.id)}
              className="glass-chip truncate rounded-md px-1 py-1 text-[10.5px] text-muted hover:text-gold disabled:opacity-50"
              title={ep.name}
            >
              {ep.name.length > 8 ? ep.name.slice(0, 8) : ep.name}
            </button>
          ))}
        </div>
      )}
      {isPanSite && (
        <div className="glass-inset mt-4 rounded-lg p-2">
          <p className="text-[10.5px] leading-relaxed text-muted/70">
            这个站（{site.name}）的字幕源挂在使用者的网盘上，spider 要用你登录的网盘账号换直链，没登录就播不了。
          </p>
          <button
            onClick={onOpenConfig}
            className="mt-1.5 flex items-center gap-1 text-[10.5px] font-medium text-gold hover:underline"
          >
            <KeyRound size={10} /> 打开配置中心登录网盘
          </button>
        </div>
      )}
    </div>
  )
}

function PanBar({ pan, onOpen }: { pan: Record<string, PanProvider>; onOpen: () => void }) {
  const list = Object.entries(pan)
  const logged = list.filter(([, p]) => p.login || p.configured)
  const hint =
    list.length === 0
      ? '网盘状态未知（不影响免登录站点）'
      : logged.length > 0
        ? `${logged.length}/${list.length} 个网盘已登录`
        : `免登录站点可直接播放，仅 4K 网盘站需登录（${list.length} 个网盘均未登录）`
  return (
    <div className="shrink-0 border-t border-white/10 p-2">
      <button
        onClick={onOpen}
        className="glass-btn flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-muted hover:text-gold"
      >
        <KeyRound size={11} /> 配置中心
      </button>
      <p
        className={`mt-1.5 px-1 text-[10px] leading-relaxed ${
          logged.length > 0 ? 'text-muted/70' : 'text-amber-300/80'
        }`}
      >
        {hint}
      </p>
    </div>
  )
}

function ErrBox({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="glass-alert mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[11.5px] leading-relaxed text-red-200">
      <AlertCircle size={13} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <span>{text}</span>
        {children}
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center">{children}</div>
}
