import type { MediaItem } from '../lib/types'

interface PosterProps {
  item: MediaItem
  width?: number
  onOpen?: (item: MediaItem) => void
  progress?: number
  badge?: string
}

function initials(title: string) {
  const clean = title.replace(/\s+/g, '')
  return clean.slice(0, 2)
}

export default function Poster({ item, width = 168, onOpen, progress, badge }: PosterProps) {
  const h = Math.round(width * 1.5)
  const hue = item.hue

  return (
    <button
      onClick={() => onOpen?.(item)}
      className="group relative shrink-0 overflow-hidden rounded-2xl text-left transition-transform duration-300 ease-out hover:z-10 hover:scale-[1.045] focus:outline-none"
      style={{ width, height: h }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(155deg, hsl(${hue} 62% 24%) 0%, hsl(${(hue + 28) % 360} 48% 12%) 55%, #0b0b0f 100%)`,
        }}
      />
      <div
        className="absolute inset-0 opacity-60 mix-blend-overlay"
        style={{
          background: `radial-gradient(circle at 28% 18%, hsl(${hue} 90% 55% / 0.55), transparent 62%)`,
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="text-[56px] font-semibold tracking-tight opacity-25"
          style={{ color: `hsl(${hue} 80% 78%)` }}
        >
          {initials(item.title)}
        </span>
      </div>

      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

      {badge && (
        <span className="absolute left-2 top-2 rounded-md bg-gold/90 px-1.5 py-0.5 text-[10px] font-semibold text-black">
          {badge}
        </span>
      )}

      <div className="absolute inset-x-0 bottom-0 p-2.5">
        <div className="truncate text-[12.5px] font-medium leading-tight text-fg">{item.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-muted">
          {item.year && <span>{item.year}</span>}
          {item.rating && (
            <span className="text-gold/90">★ {item.rating.toFixed(1)}</span>
          )}
        </div>
      </div>

      {typeof progress === 'number' && progress > 0.01 && (
        <div className="absolute inset-x-2 bottom-1 h-[3px] overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full rounded-full bg-gold"
            style={{ width: `${Math.min(progress, 0.99) * 100}%` }}
          />
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-white/8 transition group-hover:ring-gold/40" />
    </button>
  )
}
