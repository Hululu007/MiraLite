import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Clapperboard, Home, Search, Settings2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const navItems = [
  { to: '/', label: '首页', icon: Home },
  { to: '/chase', label: '追剧', icon: Clapperboard },
]

export default function Shell() {
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const [barHidden, setBarHidden] = useState(false)
  const lastScroll = useRef(0)

  // 换页时顶栏复位、滚动基准归零
  useEffect(() => {
    setBarHidden(false)
    lastScroll.current = 0
  }, [location.pathname])

  function submitSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    navigate(`/search?q=${encodeURIComponent(q)}`)
  }

  // 内容向下滑 -> 顶栏上移隐藏；向上滑 / 回到顶部 -> 滑回。
  // 阈值过滤微小抖动，避免列表惯性滚动时来回跳。
  function onContentScroll(e: React.UIEvent<HTMLElement>) {
    const top = e.currentTarget.scrollTop
    const delta = top - lastScroll.current
    if (top <= 4) {
      setBarHidden(false)
    } else if (delta > 6) {
      setBarHidden(true)
    } else if (delta < -6) {
      setBarHidden(false)
    }
    lastScroll.current = top
  }

  return (
    <div className="grain relative isolate flex h-full w-full overflow-hidden text-fg">
      {/* 每次打开随机色相的环境光底层 */}
      <div className="liquid-bg" aria-hidden="true" />
      <div className="liquid-veil" aria-hidden="true" />
      <div className="liquid-shade" aria-hidden="true" />

      {/* 左侧：透明拖拽区避让 macOS 红绿灯，下方才是液态胶囊菜单 */}
      <aside className="relative z-10 flex w-[86px] shrink-0 flex-col py-3 pl-3">
        <div data-tauri-drag-region className="h-11 w-full shrink-0" aria-hidden="true" />
        <div className="glass-capsule flex min-h-0 flex-1 flex-col items-center gap-1 rounded-[26px] px-1.5 py-3">
          <div className="glass-logo mb-4 flex h-9 w-9 items-center justify-center rounded-xl text-[13px] font-bold text-gold">
            ML
          </div>
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                [
                  'glass-nav group flex w-[56px] flex-col items-center gap-1 rounded-xl py-2.5 text-[10.5px]',
                  isActive ? 'is-active' : '',
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
                  'glass-nav flex w-[56px] flex-col items-center gap-1 rounded-xl py-2.5 text-[10.5px]',
                  isActive ? 'is-active' : '',
                ].join(' ')
              }
            >
              <Settings2 size={17} strokeWidth={1.8} />
              <span>设置</span>
            </NavLink>
          </div>
        </div>
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col py-3 pr-3">
        {/* 顶部液态胶囊状态栏：高度 + 位移组合动画，下滑时向上滑走且内容区上移填补 */}
        <div
          className={`shrink-0 overflow-hidden transition-all duration-300 ease-out ${
            barHidden
              ? 'max-h-0 -translate-y-4 opacity-0'
              : 'max-h-[60px] translate-y-0 opacity-100'
          }`}
        >
          <header className="glass-capsule flex h-[52px] items-center justify-between rounded-[26px] px-6">
            <div data-tauri-drag-region className="text-[12px] font-medium tracking-wide text-muted">
              MiraLite
              <span className="mx-2 text-white/20">/</span>
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
                className="glass-input h-8 w-[220px] rounded-lg pl-8 pr-3 text-[12px] text-fg"
              />
            </form>
          </header>
        </div>

        <main
          onScroll={onContentScroll}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
        >
          <Outlet />
        </main>
      </div>
    </div>
  )
}
