import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowLeft, Gauge, ListVideo, Volume2 } from 'lucide-react'
import Hls from 'hls.js'
import { viaProxy } from '../lib/cat'

const RATE_KEY = 'miralite.player.rate.v1'
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

export interface OverlayEpisode {
  id: string
  name: string
}

/** 全屏播放层：原生 HLS 优先，hls.js 兜底，失败回调交给上层换线 */
export default function PlayerOverlay({
  url,
  header,
  tip,
  title,
  episodes,
  activeEpId,
  onPickEpisode,
  resumeAt,
  onProgress,
  onEnded,
  onFail,
  onSwitch,
  onClose,
}: {
  url: string
  /** CAT /play 返回的鉴权 header，透传给本地代理 */
  header?: Record<string, string> | null
  tip?: string | null
  /** 顶部标题（片名 · 集名） */
  title?: string
  /** 当前线路的全部剧集，传了才显示选集按钮 */
  episodes?: OverlayEpisode[]
  activeEpId?: string
  onPickEpisode?: (id: string) => void
  /** 续播起点（秒） */
  resumeAt?: number
  /** 播放中定期上报进度，用于进度记忆 */
  onProgress?: (position: number, duration: number) => void
  /** 一集播完 */
  onEnded?: () => void
  onFail?: () => void
  onSwitch?: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [perr, setPerr] = useState<string | null>(null)
  const [rate, setRate] = useState<number>(() => {
    const v = Number(localStorage.getItem(RATE_KEY))
    return RATES.includes(v) ? v : 1
  })
  const [showEp, setShowEp] = useState(false)
  const [volHint, setVolHint] = useState<number | null>(null)
  const volTimer = useRef<number | undefined>(undefined)
  /** 续播只做一次，换线重载后不重复跳 */
  const seekedRef = useRef(false)
  const lastReport = useRef(0)
  const latest = useRef({ pos: 0, dur: 0 })

  // 倍速：记住上次选择，换集/换线都沿用
  useEffect(() => {
    try {
      localStorage.setItem(RATE_KEY, String(rate))
    } catch {
      /* ignore */
    }
    const el = ref.current
    if (el) el.playbackRate = rate
  }, [rate])

  const report = useCallback(
    (force = false) => {
      if (!onProgress) return
      const { pos, dur } = latest.current
      if (pos <= 0) return
      const now = Date.now()
      if (!force && now - lastReport.current < 5000) return
      lastReport.current = now
      onProgress(pos, dur)
    },
    [onProgress],
  )

  useEffect(() => {
    const el = ref.current
    if (!el) return
    setPerr(null)
    seekedRef.current = false
    latest.current = { pos: 0, dur: 0 }
    const src = viaProxy(url, header)
    let fired = false
    let hls: Hls | null = null
    let onNativeErr: (() => void) | null = null

    const fail = () => {
      if (fired) return
      fired = true
      onFail?.()
    }

    const destroyHls = () => {
      hls?.destroy()
      hls = null
    }

    const startHls = () => {
      if (!Hls.isSupported()) {
        setPerr('这个地址浏览器解不了，可能已过期')
        return
      }
      hls = new Hls({
        // WKWebView 里 worker 解析偶尔出 fragParsingError，直接关掉更稳
        enableWorker: false,
        lowLatencyMode: false,
        maxBufferLength: 30,
        fragLoadingMaxRetry: 4,
        manifestLoadingMaxRetry: 3,
      })
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setPerr('拉流失败：这条线路不通，正在自动换下一条…')
        } else {
          setPerr(`播放出错：${data.details}，正在自动换下一条线路…`)
        }
        fail()
      })
      hls.loadSource(src)
      hls.attachMedia(el)
    }

    const onLoadedMeta = () => {
      el.playbackRate = Number(localStorage.getItem(RATE_KEY)) || 1
      if (!seekedRef.current && resumeAt && resumeAt > 3) {
        seekedRef.current = true
        const dur = el.duration || 0
        // 快看完的不跳，从头放
        if (!dur || resumeAt < dur - 8) el.currentTime = resumeAt
      }
    }

    const onTime = () => {
      latest.current = { pos: el.currentTime, dur: el.duration || 0 }
      report()
    }

    const onPause = () => report(true)
    const onEnd = () => {
      report(true)
      onEnded?.()
    }

    el.addEventListener('loadedmetadata', onLoadedMeta)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnd)

    const isM3u8 = url.includes('.m3u8')
    const nativeHls = el.canPlayType('application/vnd.apple.mpegurl') !== ''

    if (isM3u8 && nativeHls) {
      el.src = src
      onNativeErr = () => {
        el.removeEventListener('error', onNativeErr as EventListener)
        onNativeErr = null
        startHls()
      }
      el.addEventListener('error', onNativeErr)
    } else if (isM3u8) {
      startHls()
    } else {
      el.src = src
      onNativeErr = () => setPerr('这个地址播不了，可能已过期或需要特定客户端')
      el.addEventListener('error', onNativeErr)
    }

    // 兜底：只有完全没拿到任何数据（HAVE_NOTHING）才判定线路不通。
    // 直播流 currentTime 可能恒为 0、慢启动流 12 秒内到不了 HAVE_FUTURE_DATA，
    // 旧逻辑（8 秒 + currentTime===0）会把正常流误判为失败并自动换线。
    const wd = window.setTimeout(() => {
      if (!hls && el.readyState === HTMLMediaElement.HAVE_NOTHING) fail()
    }, 12000)

    void el.play().catch(() => undefined)
    return () => {
      window.clearTimeout(wd)
      // 离开时补一次进度，避免最后 5 秒的观看丢失
      report(true)
      if (onNativeErr) el.removeEventListener('error', onNativeErr)
      el.removeEventListener('loadedmetadata', onLoadedMeta)
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnd)
      destroyHls()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, header])

  // 滚轮调音量：桌面端鼠标滚轮直接控制，比拖原生控件精确
  useEffect(() => {
    const box = wrapRef.current
    if (!box) return
    const onWheel = (e: WheelEvent) => {
      const el = ref.current
      if (!el) return
      e.preventDefault()
      const step = e.deltaY < 0 ? 0.05 : -0.05
      el.volume = Math.min(1, Math.max(0, Number((el.volume + step).toFixed(2))))
      setVolHint(el.volume)
      window.clearTimeout(volTimer.current)
      volTimer.current = window.setTimeout(() => setVolHint(null), 1200)
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      box.removeEventListener('wheel', onWheel)
      window.clearTimeout(volTimer.current)
    }
  }, [])

  // 键盘快捷键：↑↓ 音量，←→ 快退快进 10 秒，空格暂停
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = ref.current
      if (!el) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        el.volume = Math.min(1, Number((el.volume + 0.05).toFixed(2)))
        setVolHint(el.volume)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        el.volume = Math.max(0, Number((el.volume - 0.05).toFixed(2)))
        setVolHint(el.volume)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        el.currentTime = Math.max(0, el.currentTime - 10)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        el.currentTime = Math.min(el.duration || 0, el.currentTime + 10)
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        if (el.paused) void el.play().catch(() => undefined)
        else el.pause()
      } else {
        return
      }
      window.clearTimeout(volTimer.current)
      volTimer.current = window.setTimeout(() => setVolHint(null), 1200)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(volTimer.current)
    }
  }, [])

  const cycleRate = () => {
    const i = RATES.indexOf(rate)
    setRate(RATES[(i + 1) % RATES.length])
  }

  const handleClose = () => {
    report(true)
    onClose()
  }

  const epList = episodes ?? []

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center gap-2 px-4 py-2.5 text-[12px] text-white/70">
        <button
          onClick={handleClose}
          className="glass-btn flex items-center gap-1 rounded-md px-2 py-1 text-white/75 hover:text-white"
        >
          <ArrowLeft size={14} /> 返回
        </button>
        {title && <span className="min-w-0 truncate text-[11.5px] text-white/55">{title}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={cycleRate}
            title="切换播放速度"
            className="glass-btn flex items-center gap-1 rounded-md px-2 py-1 text-white/75 hover:text-white"
          >
            <Gauge size={13} /> {rate}x
          </button>
          {epList.length > 0 && onPickEpisode && (
            <button
              onClick={() => setShowEp((v) => !v)}
              title="选集"
              className={`glass-btn flex items-center gap-1 rounded-md px-2 py-1 hover:text-white ${
                showEp ? 'text-gold' : 'text-white/75'
              }`}
            >
              <ListVideo size={13} /> 选集
            </button>
          )}
          <span className="hidden max-w-[320px] truncate text-[10.5px] text-white/35 sm:inline">
            {url.slice(0, 90)}
          </span>
        </div>
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1">
        <video ref={ref} controls playsInline className="h-full w-full bg-black" />
        {tip && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <div className="glass-tip rounded-lg px-3 py-1.5 text-[11.5px]">
              {tip}
            </div>
          </div>
        )}
        {volHint !== null && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="glass-tip flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] text-white/90">
              <Volume2 size={15} /> {Math.round(volHint * 100)}%
            </div>
          </div>
        )}
        {showEp && epList.length > 0 && (
          <div className="absolute bottom-0 right-0 top-0 flex w-[286px] flex-col border-l border-white/10 bg-black/85 backdrop-blur">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 text-[12px] text-white/70">
              <span>选集 · {epList.length} 集</span>
              <button onClick={() => setShowEp(false)} className="text-white/45 hover:text-white">
                收起
              </button>
            </div>
            <div className="no-scrollbar grid flex-1 grid-cols-3 content-start gap-2 overflow-y-auto p-3">
              {epList.map((ep) => (
                <button
                  key={ep.id}
                  onClick={() => {
                    onPickEpisode?.(ep.id)
                    setShowEp(false)
                  }}
                  className={`glass-chip truncate rounded-md px-1.5 py-1.5 text-[11px] ${
                    ep.id === activeEpId ? 'is-active text-gold' : 'text-white/65 hover:text-gold'
                  }`}
                  title={ep.name}
                >
                  {ep.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {perr && (
          <div className="pointer-events-none absolute inset-x-0 bottom-16 flex flex-col items-center gap-2">
            <div className="glass-alert pointer-events-auto flex items-center gap-2 rounded-lg px-3 py-2 text-[11.5px] text-red-200">
              <AlertCircle size={13} /> {perr}
            </div>
            {onSwitch && (
              <button
                onClick={onSwitch}
                className="glass-primary pointer-events-auto rounded-lg px-4 py-1.5 text-[12px] font-medium"
              >
                换个站点找这部片
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
