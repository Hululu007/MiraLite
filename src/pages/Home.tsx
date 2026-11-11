import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Loader2, Play, RefreshCw, Search } from 'lucide-react'
import CatPoster from '../components/CatPoster'
import { buildHot, readHotCache, type HotSection } from '../lib/catSession'

export default function HomePage() {
  const navigate = useNavigate()
  const [sections, setSections] = useState<HotSection[] | null>(() => readHotCache())
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const next = await buildHot()
      if (next.length === 0) throw new Error('没拉到任何热门内容，CAT 源可能还没连上')
      setSections(next)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const searchFor = (name: string) => navigate(`/cat/search?name=${encodeURIComponent(name)}`)

  const hero = sections?.[0]?.items[0]

  return (
    <div className="pb-16">
      {!sections && !loading && err && (
        <section className="mx-10 mb-6 mt-6 rounded-2xl border border-line/70 bg-surface/60 p-6">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <AlertCircle size={15} className="text-amber-300" />
            首页热门还没接上 CAT 源
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            {err}
            <br />
            去 CAT 页连一次订阅地址，回来这里就会自动铺满各站点的热门海报。
          </p>
          <button
            onClick={() => navigate('/cat')}
            className="mt-4 flex items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-[12.5px] font-semibold text-black transition hover:brightness-110"
          >
            去连接 CAT 源
          </button>
        </section>
      )}

      {hero && (
        <section className="relative mb-7 h-[320px] overflow-hidden">
          {hero.vod.vod_pic && (
            <img
              src={hero.vod.vod_pic}
              alt=""
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full scale-105 object-cover opacity-25 blur-[3px]"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-base via-base/75 to-base/20" />
          <div className="absolute inset-0 bg-gradient-to-t from-base via-transparent to-base/40" />

          <div className="relative flex h-full items-center gap-6 px-10">
            <div className="hidden w-[130px] shrink-0 overflow-hidden rounded-xl ring-1 ring-white/12 sm:block">
              <CatPoster
                name={hero.vod.vod_name}
                pic={hero.vod.vod_pic}
                width={130}
                onClick={() => searchFor(hero.vod.vod_name)}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center gap-2 text-[11px] text-muted">
                <span className="rounded bg-gold/15 px-1.5 py-0.5 font-medium text-gold">今日热门</span>
                <span className="text-muted/60">
                  {(sections?.length ?? 0)} 个站点 ·{' '}
                  {sections?.reduce((n, s) => n + s.items.length, 0) ?? 0} 部在架
                </span>
                <span>{hero.siteName}</span>
                {hero.vod.vod_year && (
                  <>
                    <span>·</span>
                    <span>{hero.vod.vod_year}</span>
                  </>
                )}
                {hero.vod.vod_remarks && (
                  <>
                    <span>·</span>
                    <span className="truncate">{hero.vod.vod_remarks}</span>
                  </>
                )}
              </div>
              <h1 className="text-[30px] font-semibold leading-tight tracking-tight">{hero.vod.vod_name}</h1>
              <p className="mt-2 max-w-[560px] line-clamp-3 text-[12.5px] leading-relaxed text-fg/60">
                {hero.vod.vod_content || '点下面的按钮，去所有片源里搜这部片的可播线路。'}
              </p>
              <div className="mt-5 flex items-center gap-2.5">
                <button
                  onClick={() => searchFor(hero.vod.vod_name)}
                  className="flex items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-[12.5px] font-semibold text-black transition hover:brightness-110"
                >
                  <Play size={13} fill="currentColor" /> 找播放源
                </button>
                <button
                  onClick={() => void load()}
                  className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-[12.5px] text-fg/85 transition hover:bg-white/10"
                >
                  <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> 换一批
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {loading && !sections && (
        <div className="mt-24 flex flex-col items-center gap-3 text-[12px] text-muted">
          <Loader2 size={20} className="animate-spin text-gold" />
          正在从各个站点拉热门海报…
        </div>
      )}

      <div className="space-y-8">
        {sections
          ?.filter((sec) => sec.items.length > 0)
          .map((sec) => (
            <section key={sec.title} className="animate-fade-up">
              <div className="mb-3 flex items-end justify-between px-10">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-tight text-fg">{sec.title}</h2>
                  <p className="mt-0.5 text-[11.5px] text-muted">{sec.subtitle}</p>
                </div>
                <span className="flex items-center gap-1 text-[11px] text-muted/70">
                  <Search size={11} /> 点海报自动搜全站片源
                </span>
              </div>
              <div className="no-scrollbar flex gap-3 overflow-x-auto px-10 pb-2">
                {sec.items.map((it) => (
                  <CatPoster
                    key={it.siteKey + it.vod.vod_id}
                    name={it.vod.vod_name}
                    pic={it.vod.vod_pic}
                    remarks={it.vod.vod_remarks}
                    onClick={() => searchFor(it.vod.vod_name)}
                  />
                ))}
              </div>
            </section>
          ))}
      </div>
    </div>
  )
}
