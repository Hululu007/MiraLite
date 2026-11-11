import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowLeft } from 'lucide-react'
import Hls from 'hls.js'
import { viaProxy } from '../lib/cat'

/** 全屏播放层：原生 HLS 优先，hls.js 兜底，失败回调交给上层换线 */
export default function PlayerOverlay({
  url,
  header,
  tip,
  onFail,
  onSwitch,
  onClose,
}: {
  url: string
  /** CAT /play 返回的鉴权 header，透传给本地代理 */
  header?: Record<string, string> | null
  tip?: string | null
  onFail?: () => void
  onSwitch?: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [perr, setPerr] = useState<string | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setPerr(null)
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
      if (onNativeErr) el.removeEventListener('error', onNativeErr)
      destroyHls()
    }
  }, [url, header])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center gap-2 px-4 py-2.5 text-[12px] text-white/70">
        <button onClick={onClose} className="flex items-center gap-1 hover:text-white">
          <ArrowLeft size={14} /> 返回
        </button>
        <span className="ml-auto truncate text-[10.5px] text-white/40">{url.slice(0, 90)}</span>
      </div>
      <div className="relative min-h-0 flex-1">
        <video ref={ref} controls playsInline className="h-full w-full bg-black" />
        {tip && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <div className="rounded-lg border border-white/15 bg-black/75 px-3 py-1.5 text-[11.5px] text-white/75">
              {tip}
            </div>
          </div>
        )}
        {perr && (
          <div className="pointer-events-none absolute inset-x-0 bottom-16 flex flex-col items-center gap-2">
            <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-red-500/30 bg-black/80 px-3 py-2 text-[11.5px] text-red-300">
              <AlertCircle size={13} /> {perr}
            </div>
            {onSwitch && (
              <button
                onClick={onSwitch}
                className="pointer-events-auto rounded-lg bg-gold px-4 py-1.5 text-[12px] font-medium text-black transition hover:brightness-110"
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
