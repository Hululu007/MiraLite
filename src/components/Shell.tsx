import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Clapperboard, Film, Home, Layers, Search, Settings2, Tv } from 'lucide-react'
import { useState } from 'react'

const navItems = [
  { to: '/', label: '首页', icon: Home },
  { to: '/movies', label: '电影', icon: Film },
  { to: '/tv', label: '剧集', icon: Tv },
  { to: '/sources', label: '片源', icon: Clapperboard },
  { to: '/cat', label: 'CAT', icon: Layers },
]

export default function Shell() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  function submitSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    navigate(`/search?q=${encodeURIComponent(q)}`)
  }

  return (
    <div className="grain flex h-full w-full bg-base text-fg">
      <aside className="flex w-[74px] shrink-0 flex-col items-center gap-1 border-r border-line/60 bg-surface/60 py-4 backdrop-blur-xl">
        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-gold/15 text-[13px] font-bold text-gold">
          ML
        </div>
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              [
                'group flex w-[58px] flex-col items-center gap-1 rounded-xl py-2.5 text-[10.5px] transition',
                isActive
                  ? 'bg-surface-2 text-gold'
                  : 'text-muted hover:bg-surface-2/60 hover:text-fg',
              ].join(' ')
            }
          >
            <Icon size={17} strokeWidth={1.8} />
            <span>{label}</span>
          </NavLink>
        ))}
        <div className="mt-auto flex flex-col items-center gap-1">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              [
                'flex w-[58px] flex-col items-center gap-1 rounded-xl py-2.5 text-[10.5px] transition',
                isActive ? 'bg-surface-2 text-gold' : 'text-muted hover:bg-surface-2/60 hover:text-fg',
              ].join(' ')
            }
          >
            <Settings2 size={17} strokeWidth={1.8} />
            <span>设置</span>
          </NavLink>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line/40 px-10">
          <div className="text-[12px] font-medium tracking-wide text-muted">
            MiraLite
            <span className="mx-2 text-line">/</span>
            <span className="text-fg/70">IPTV &amp; Library</span>
          </div>
          <form onSubmit={submitSearch} className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索片名 / 频道"
              className="h-8 w-[220px] rounded-lg border border-line/70 bg-surface-2/70 pl-8 pr-3 text-[12px] text-fg placeholder:text-muted/70 focus:border-gold/50 focus:outline-none"
            />
          </form>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
