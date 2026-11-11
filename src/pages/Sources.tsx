import { useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Plug, RefreshCw, Trash2 } from 'lucide-react'
import { actions, useLibrary } from '../lib/store'
import { diagnoseNonPlaylist, parsePlaylist, xtreamBase } from '../lib/m3u'
import type { SourceKind } from '../lib/types'

type Tab = SourceKind

const tabs: Array<[Tab, string, string]> = [
  ['m3u', 'M3U 播放列表', '导入任意 M3U / M3U8 订阅地址'],
  ['xtream', 'Xtream Codes', '服务地址 + 用户名密码拉取频道与 EPG'],
  ['local', '本地媒体目录', '扫描本地电影与剧集文件夹'],
]

export default function SourcesPage() {
  const { sources } = useLibrary()
  const [tab, setTab] = useState<Tab>('m3u')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function handleAdd() {
    setNotice(null)
    if (!name.trim()) {
      setNotice({ kind: 'err', text: '先给这个源起个名字' })
      return
    }
    if (tab === 'local') {
      setNotice({
        kind: 'err',
        text: '本地目录扫描需要在 Tauri 桌面壳内运行（Rust 侧读盘），浏览器预览暂不可用',
      })
      return
    }
    if (!url.trim()) {
      setNotice({ kind: 'err', text: '播放列表地址不能为空' })
      return
    }

    setBusy(true)
    const source = actions.addSource({
      kind: tab,
      name: name.trim(),
      url: url.trim(),
      username: tab === 'xtream' ? username.trim() : undefined,
      password: tab === 'xtream' ? password : undefined,
    })

    try {
      const target = tab === 'xtream' ? `${xtreamBase(url)}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus` : url.trim()
      const res = await fetch(target)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      const bad = diagnoseNonPlaylist(text)
      if (bad) throw new Error(bad)
      const items = parsePlaylist(text, source.id)
      if (items.length === 0)
        throw new Error('没有解析到任何频道：内容既不是 M3U（#EXTINF）也不像 TXT 直播源（频道名,地址）')
      actions.setSourceChannels(source.id, items)
      setNotice({ kind: 'ok', text: `已导入 ${items.length} 个条目` })
      setName('')
      setUrl('')
      setUsername('')
      setPassword('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // 导入失败时回滚这次新建的空源，避免列表里留下 0 条目的空壳
      actions.removeSource(source.id)
      setNotice({ kind: 'err', text: `拉取失败：${msg}` })
    } finally {
      setBusy(false)
    }
  }

  async function handleRefresh(id: string) {
    const src = sources.find((s) => s.id === id)
    if (!src) return
    setBusy(true)
    setNotice(null)
    try {
      const target =
        src.kind === 'xtream'
          ? `${xtreamBase(src.url)}/get.php?username=${encodeURIComponent(src.username ?? '')}&password=${encodeURIComponent(src.password ?? '')}&type=m3u_plus`
          : src.url
      const res = await fetch(target)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      const bad = diagnoseNonPlaylist(text)
      if (bad) throw new Error(bad)
      const items = parsePlaylist(text, src.id)
      actions.setSourceChannels(src.id, items)
      setNotice({ kind: 'ok', text: `${src.name}：已刷新 ${items.length} 个条目` })
    } catch (err) {
      setNotice({ kind: 'err', text: `刷新失败：${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-10 pb-16 pt-7">
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight">片源</h1>
        <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-muted">
          只从你连接的源里取内容。MiraLite 自身不提供任何片源，也不会回传你的观看数据。
        </p>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-2.5">
        {tabs.map(([key, label, desc]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-xl border p-3.5 text-left transition ${
              tab === key
                ? 'border-gold/55 bg-gold/8'
                : 'border-line/60 bg-surface/50 hover:border-line'
            }`}
          >
            <div className={`text-[12.5px] font-medium ${tab === key ? 'text-gold' : 'text-fg'}`}>
              {label}
            </div>
            <div className="mt-1 text-[11px] leading-snug text-muted">{desc}</div>
          </button>
        ))}
      </div>

      <div className="mb-8 rounded-2xl border border-line/60 bg-surface/50 p-5">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[11.5px] text-muted">源名称</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如 家庭 IPTV"
              className="h-9 w-full rounded-lg border border-line/70 bg-surface-2/70 px-3 text-[12.5px] text-fg placeholder:text-muted/60 focus:border-gold/50 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11.5px] text-muted">
              {tab === 'local' ? '目录路径' : '地址'}
            </span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={tab === 'local' ? '/Users/you/Movies' : 'https://example.com/playlist.m3u'}
              className="h-9 w-full rounded-lg border border-line/70 bg-surface-2/70 px-3 text-[12.5px] text-fg placeholder:text-muted/60 focus:border-gold/50 focus:outline-none"
            />
          </label>
          {tab === 'xtream' && (
            <>
              <label className="block">
                <span className="mb-1.5 block text-[11.5px] text-muted">用户名</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="h-9 w-full rounded-lg border border-line/70 bg-surface-2/70 px-3 text-[12.5px] focus:border-gold/50 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11.5px] text-muted">密码</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-9 w-full rounded-lg border border-line/70 bg-surface-2/70 px-3 text-[12.5px] focus:border-gold/50 focus:outline-none"
                />
              </label>
            </>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleAdd}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-[12.5px] font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />}
            {busy ? '正在连接' : '连接片源'}
          </button>
          {notice && (
            <span
              className={`flex items-start gap-1.5 text-[11.5px] leading-snug ${
                notice.kind === 'ok' ? 'text-emerald-400/90' : 'text-amber-400/90'
              }`}
            >
              {notice.kind === 'ok' ? (
                <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
              ) : (
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
              )}
              {notice.text}
            </span>
          )}
        </div>
      </div>

      <h2 className="mb-3 text-[13px] font-medium text-fg/80">已连接 {sources.length} 个源</h2>
      {sources.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line/70 px-6 py-10 text-center text-[12px] text-muted">
          还没有连接任何源。接上 M3U 或 Xtream 后，频道会自动出现在首页与剧集页。
        </div>
      ) : (
        <div className="space-y-2">
          {sources.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-xl border border-line/60 bg-surface/50 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium">{s.name}</span>
                  <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] uppercase text-muted">
                    {s.kind}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted">
                  {s.url} · {s.itemCount} 个条目
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleRefresh(s.id)}
                  className="rounded-lg p-1.5 text-muted transition hover:bg-surface-3 hover:text-fg"
                  title="刷新"
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  onClick={() => actions.removeSource(s.id)}
                  className="rounded-lg p-1.5 text-muted transition hover:bg-red-500/15 hover:text-red-400"
                  title="移除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
