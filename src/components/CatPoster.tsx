import { useState } from 'react'

/** CAT 站点的海报卡：图片挂了就退回渐变占位，保证墙不塌 */
export default function CatPoster({
  name,
  pic,
  remarks,
  badge,
  width = 128,
  onClick,
}: {
  name: string
  pic?: string
  remarks?: string
  badge?: string
  width?: number
  onClick?: () => void
}) {
  const [broken, setBroken] = useState(false)
  const ok = pic && !broken
  const hue = (name.charCodeAt(0) * 37 + (name.charCodeAt(1) || 11) * 13) % 360

  return (
    <button
      onClick={onClick}
      className="group shrink-0 text-left transition-transform duration-300 ease-out hover:z-10 hover:scale-[1.04] focus:outline-none"
      style={{ width }}
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-line/60 bg-surface-2/60">
        {ok ? (
          <img
            src={pic}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <div
            className="flex h-full items-center justify-center px-1 text-center text-[11px] leading-tight text-white/45"
            style={{
              background: `linear-gradient(155deg, hsl(${hue} 55% 24%) 0%, hsl(${(hue + 32) % 360} 44% 11%) 60%, #0b0b0f 100%)`,
            }}
          >
            {name.slice(0, 4)}
          </div>
        )}
        {remarks && (
          <span className="absolute bottom-1 left-1 max-w-[92%] truncate rounded bg-black/70 px-1 py-0.5 text-[9.5px] text-white/85">
            {remarks}
          </span>
        )}
        {badge && (
          <span className="absolute left-1 top-1 rounded bg-gold/90 px-1 py-0.5 text-[9.5px] font-semibold text-black">
            {badge}
          </span>
        )}
        <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-white/8 transition group-hover:ring-gold/45" />
      </div>
      <div className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-fg/90">{name}</div>
    </button>
  )
}
