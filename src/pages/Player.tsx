import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Hls from 'hls.js'
import { ArrowLeft, Maximize, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from 'lucide-react'
import { useCatalog } from '../lib/catalog'
import { actions } from '../lib/store'

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '00:00'
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = Math.floor(t % 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export default function PlayerPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const catalog = useCatalog()
  const item = id ? catalog.byId[id] : undefined

  const videoRef = useRef<HTMLVideoElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [hudVisible, setHudVisible] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !item?.streamUrl) return
    const src = item.streamUrl
    let hls: Hls | null = null
    setError(null)

    if (src.includes('.m3u8')) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src
      } else if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: true })
        hls.loadSource(src)
        hls.attachMedia(video)
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) setError(`播放流错误：${data.details}`)
        })
      } else {
        setError('当前环境不支持 HLS 播放')
      }
    } else {
      video.src = src
    }

    video.play().catch(() => setPlaying(false))

    return () => {
      hls?.destroy()
      video.removeAttribute('src')
      video.load()
    }
  }, [item?.streamUrl])

  useEffect(() => {
    if (!item) return
    const timer = window.setInterval(() => {
      const v = videoRef.current
      if (!v || v.paused || !v.duration) return
      actions.setProgress(item.id, {
        position: v.currentTime,
        duration: v.duration,
        updatedAt: Date.now(),
      })
    }, 5000)
    return () => window.clearInterval(timer)
  }, [item])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const v = videoRef.current
      if (!v) return
      if (e.code === 'Space') {
        e.preventDefault()
        v.paused ? v.play() : v.pause()
      } else if (e.key === 'ArrowLeft') {
        v.currentTime = Math.max(0, v.currentTime - 10)
      } else if (e.key === 'ArrowRight') {
        v.currentTime = Math.min(v.duration || 0, v.currentTime + 10)
      } else if (e.key === 'Escape') {
        navigate(-1)
      } else if (e.key.toLowerCase() === 'm') {
        v.muted = !v.muted
        setMuted(v.muted)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  useEffect(() => {
    if (!hudVisible) return
    const t = window.setTimeout(() => setHudVisible(false), 3200)
    return () => window.clearTimeout(t)
  }, [hudVisible])

  if (!item) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-muted">
        找不到该条目
        <button onClick={() => navigate(-1)} className="ml-3 text-gold underline">
          返回
        </button>
      </div>
    )
  }

  const pct = duration > 0 ? (current / duration) * 100 : 0

  return (
    <div
      ref={wrapRef}
      onMouseMove={() => setHudVisible(true)}
      className="relative flex h-full w-full items-center justify-center bg-black"
    >
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        playsInline
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onError={() => setError('无法加载该视频流，检查源是否可直连')}
        onClick={() => {
          const v = videoRef.current
          if (!v) return
          v.paused ? v.play() : v.pause()
        }}
      />

      {error && (
        <div className="glass-warn absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl px-4 py-3 text-[12.5px] text-amber-200">
          {error}
        </div>
      )}

      <div
        className={`absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/85 to-transparent p-5 transition-opacity duration-300 ${
          hudVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <button
          onClick={() => navigate(-1)}
          className="glass-btn flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] text-white/85"
        >
          <ArrowLeft size={14} /> 返回
        </button>
        <div className="text-right">
          <div className="text-[13.5px] font-medium text-white/90">{item.title}</div>
          <div className="mt-0.5 text-[11px] text-white/50">
            {item.year ? `${item.year} · ` : ''}
            {item.genres.join(' / ')}
          </div>
        </div>
      </div>

      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-6 pb-5 pt-10 transition-opacity duration-300 ${
          hudVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="mb-2 flex items-center gap-2.5">
          <span className="w-11 text-right text-[10.5px] tabular-nums text-white/60">{fmt(current)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={current}
            onChange={(e) => {
              const v = videoRef.current
              if (!v) return
              v.currentTime = Number(e.target.value)
              setCurrent(Number(e.target.value))
            }}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/20 accent-[#e8b44c]"
            style={{
              background: `linear-gradient(to right, #e8b44c ${pct}%, rgba(255,255,255,0.2) ${pct}%)`,
            }}
          />
          <span className="w-11 text-[10.5px] tabular-nums text-white/60">{fmt(duration)}</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const v = videoRef.current
                if (!v) return
                v.paused ? v.play() : v.pause()
              }}
              className="glass-btn flex h-9 w-9 items-center justify-center rounded-full text-white"
            >
              {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
            </button>
            <button
              onClick={() => {
                const v = videoRef.current
                if (v) v.currentTime = Math.max(0, v.currentTime - 10)
              }}
              className="text-white/70 transition hover:text-white"
            >
              <RotateCcw size={16} />
            </button>
            <button
              onClick={() => {
                const v = videoRef.current
                if (v) v.currentTime = Math.min(v.duration || 0, v.currentTime + 10)
              }}
              className="text-white/70 transition hover:text-white"
            >
              <RotateCw size={16} />
            </button>
            <button
              onClick={() => {
                const v = videoRef.current
                if (!v) return
                v.muted = !v.muted
                setMuted(v.muted)
              }}
              className="text-white/70 transition hover:text-white"
            >
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
          </div>

          <button
            onClick={() => {
              const el = wrapRef.current
              if (!el) return
              document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen()
            }}
            className="text-white/70 transition hover:text-white"
          >
            <Maximize size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
