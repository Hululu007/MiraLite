import { useEffect, useMemo, useState } from 'react'
import { Loader2, RotateCcw, Search } from 'lucide-react'
import { ensureRawSites, resetSiteCache } from '../lib/catSession'
import type { CatSite } from '../lib/cat'
import { clearDisabledSites, toggleSiteDisabled, useDisabledSites } from '../lib/sitePrefs'

/**
 * 设置页「站点开关」：订阅里几十个站点，把用不上的关掉，
 * 首页热门与跨站搜索就不再浪费时间在它们身上。
 */
export default function SiteSwitches() {
  const disabled = useDisabledSites()
  const [sites, setSites] = useState<CatSite[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [kw, setKw] = useState('')

  useEffect(() => {
    let alive = true
    setErr(null)
    ensureRawSites()
      .then((list) => {
        if (alive) setSites([...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')))
      })
      .catch((e) => {
        if (alive) setErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [])

  const shown = useMemo(() => {
    const list = sites ?? []
    const k = kw.trim().toLowerCase()
    if (!k) return list
    return list.filter(
      (s) => s.name.toLowerCase().includes(k) || s.key.toLowerCase().includes(k),
    )
  }, [sites, kw])

  const total = sites?.length ?? 0
  const offCount = sites ? sites.filter((s) => disabled.has(s.key)).length : disabled.size

  const toggle = (key: string) => {
    toggleSiteDisabled(key)
    resetSiteCache()
  }

  return (
    <div className="px-5 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12.5px] text-fg/90">站点开关</div>
          <div className="mt-0.5 text-[11px] leading-snug text-muted">
            {total > 0 ? `共 ${total} 个站点，已关掉 ${offCount} 个` : '关掉的站点不参与首页热门与跨站搜索'}
          </div>
        </div>
        <button
          onClick={() => {
            clearDisabledSites()
            resetSiteCache()
          }}
          className="glass-btn flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[11.5px] text-muted hover:text-gold"
        >
          <RotateCcw size={11} /> 全部打开
        </button>
      </div>

      <div className="glass-inset mt-2.5 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5">
        <Search size={12} className="text-muted" />
        <input
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder="搜索站点名或 key"
          className="w-full bg-transparent text-[11.5px] text-fg/85 outline-none placeholder:text-muted/60"
        />
      </div>

      {!sites && !err && (
        <div className="mt-4 flex items-center gap-2 text-[11.5px] text-muted">
          <Loader2 size={13} className="animate-spin text-gold" /> 正在读取订阅里的站点…
        </div>
      )}
      {err && (
        <p className="mt-3 text-[11.5px] leading-relaxed text-amber-200/90">
          站点列表没读到：{err}。片源连上后再回来看这里。
        </p>
      )}

      {sites && (
        <div className="no-scrollbar mt-2.5 max-h-[320px] overflow-y-auto rounded-lg border border-white/8">
          {shown.length === 0 && (
            <p className="px-3 py-4 text-center text-[11.5px] text-muted">没有匹配的站点</p>
          )}
          {shown.map((s) => {
            const on = !disabled.has(s.key)
            return (
              <button
                key={s.key}
                onClick={() => toggle(s.key)}
                className="flex w-full items-center justify-between border-b border-white/6 px-3 py-2 text-left last:border-b-0 hover:bg-white/4"
              >
                <div className="min-w-0">
                  <div className={`truncate text-[11.5px] ${on ? 'text-fg/85' : 'text-muted/70'}`}>
                    {s.name}
                  </div>
                  <div className="truncate text-[10px] text-muted/60">{s.key}</div>
                </div>
                <span
                  className={`relative ml-3 h-[18px] w-[32px] shrink-0 rounded-full transition ${
                    on ? 'bg-gold' : 'bg-white/14'
                  }`}
                >
                  <span
                    className={`absolute top-[2px] h-3.5 w-3.5 rounded-full bg-white shadow transition-all ${
                      on ? 'left-[15px]' : 'left-[2px]'
                    }`}
                  />
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
