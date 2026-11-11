import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Activity,
  Check,
  CheckCircle2,
  KeyRound,
  Loader2,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { actions, useLibrary } from '../lib/store'
import { diagnoseNonPlaylist, parsePlaylist, xtreamBase } from '../lib/m3u'
import {
  catActiveUrl,
  catConfig,
  catOpenConfig,
  catProbe,
  catStatus,
  catStop,
  inTauri,
  type CatProbe,
} from '../lib/cat'
import {
  addSubscription,
  connectSubscription,
  readSubscriptions,
  removeSubscription,
  renameSubscription,
  selectSubscription,
  type CatSubscription,
} from '../lib/catSession'
import type { SourceKind } from '../lib/types'

type Tab = SourceKind

const tabs: Array<[Tab, string, string]> = [
  ['m3u', 'M3U 播放列表', '导入任意 M3U / M3U8 订阅地址'],
  ['xtream', 'Xtream Codes', '服务地址 + 用户名密码拉取频道与 EPG'],
  ['local', '本地媒体目录', '扫描本地电影与剧集文件夹'],
]

/** 设置页里的「片源」区块：影视订阅（CAT）+ 播放列表 / 本地目录 + 已连接源 */
export default function SourcesSection() {
  const { sources } = useLibrary()

  // ---- 影视订阅（CAT）----
  const [catSubs, setCatSubs] = useState<CatSubscription[]>(() => readSubscriptions())
  const [newUrl, setNewUrl] = useState('')
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [catBusy, setCatBusy] = useState(false)
  const [catReady, setCatReady] = useState<boolean | null>(null)
  const [catCount, setCatCount] = useState(0)
  const [runningUrl, setRunningUrl] = useState<string | null>(null)
  const [catMsg, setCatMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [probingId, setProbingId] = useState<string | null>(null)
  const [probeResult, setProbeResult] = useState<{ id: string; data: CatProbe } | null>(null)

  const activeSub = catSubs.find((s) => s.enabled) ?? catSubs[0] ?? null

  const refreshCatStatus = async () => {
    if (!inTauri()) {
      setCatReady(false)
      return
    }
    try {
      const port = await catStatus()
      const url = await catActiveUrl()
      setRunningUrl(url)
      if (port && url) {
        setCatCount((await catConfig()).length)
        setCatReady(true)
      } else {
        setCatCount(0)
        setCatReady(false)
      }
    } catch {
      setCatReady(false)
    }
  }

  useEffect(() => {
    // 引擎由 main.tsx 入口统一预热；这里只读取状态。
    // 预热是异步的，稍等一下再读，避免读到「还没连上」的瞬时状态。
    const timer = window.setTimeout(() => void refreshCatStatus(), 1200)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 重新连接当前启用的源 */
  async function connectCat() {
    if (!activeSub) return
    await applySwitch(activeSub.id)
  }

  /**
   * 点击「选择」：先立即落盘选中状态（UI 马上变色），再异步连引擎。
   * 连接失败时选择依然保留，并给出明确提示——避免「点了没反应」。
   */
  async function applySwitch(id: string) {
    // 1) 立即选中，界面即时反馈
    const next = selectSubscription(id)
    setCatSubs(next)
    setProbeResult(null)
    const sub = next.find((s) => s.id === id)
    // 2) 异步让引擎跑起来
    setCatBusy(true)
    setCatMsg(null)
    try {
      const count = await connectSubscription(sub!.url)
      setCatCount(count)
      setCatReady(true)
      setRunningUrl((await catActiveUrl()) ?? sub!.url)
      setCatMsg({ kind: 'ok', text: `已选择「${sub!.name}」· ${count} 个站点` })
    } catch (e) {
      // 选择已生效，只是这次没连上；提示用户可重试或点「测试」
      setCatReady(false)
      setRunningUrl(null)
      setCatMsg({
        kind: 'err',
        text: `已选择「${sub!.name}」，但连接失败：${e instanceof Error ? e.message : String(e)}。可点「测试」看具体原因。`,
      })
    } finally {
      setCatBusy(false)
    }
  }

  /** 用独立临时引擎测试某个订阅是否可用，不影响当前正在用的源 */
  async function testCat(s: CatSubscription) {
    setProbingId(s.id)
    setProbeResult(null)
    setCatMsg(null)
    try {
      const data = await catProbe(s.url)
      setProbeResult({ id: s.id, data })
    } catch (e) {
      setCatMsg({ kind: 'err', text: `测试失败：${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setProbingId(null)
    }
  }

  async function addCat() {
    const target = newUrl.trim()
    if (!target) {
      setCatMsg({ kind: 'err', text: '先填订阅地址' })
      return
    }
    setCatBusy(true)
    setCatMsg(null)
    try {
      const next = addSubscription(target, newName)
      setCatSubs(next)
      setNewUrl('')
      setNewName('')
      const added = next[next.length - 1]
      // 只有一条时直接选中连接；否则让用户点列表里的「选择」
      if (next.length === 1) {
        await applySwitch(added.id)
      } else {
        setCatMsg({ kind: 'ok', text: `已保存「${added.name}」，点列表里的「选择」即可切换过去` })
      }
    } catch (e) {
      setCatMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setCatBusy(false)
    }
  }

  async function removeCat(id: string) {
    setCatBusy(true)
    setCatMsg(null)
    try {
      const wasActive = activeSub?.id === id
      const next = removeSubscription(id)
      setCatSubs(next)
      if (next.length === 0) {
        await catStop()
        setCatReady(false)
        setCatCount(0)
        setRunningUrl(null)
        setCatMsg({ kind: 'ok', text: '已移除全部订阅源' })
      } else if (wasActive) {
        // 删的是当前源，自动用剩下的第一条接上
        await applySwitch(next[0].id)
      } else {
        setCatMsg({ kind: 'ok', text: '已移除订阅源' })
      }
    } catch (e) {
      setCatMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setCatBusy(false)
    }
  }

  function saveEdit(id: string) {
    try {
      setCatSubs(renameSubscription(id, editName))
      setEditingId(null)
      setCatMsg({ kind: 'ok', text: '名称已更新' })
    } catch (e) {
      setCatMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    }
  }

  async function openPanConfig() {
    try {
      await catOpenConfig()
    } catch (e) {
      setCatMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    }
  }

  // ---- 播放列表 / 本地目录 ----
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
      const target =
        tab === 'xtream'
          ? `${xtreamBase(url)}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus`
          : url.trim()
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
    <>
      {/* 影视订阅（CAT） */}
      <div className="px-5 py-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[12.5px] text-fg/90">影视订阅</div>
            <div className="mt-0.5 text-[11px] leading-snug text-muted">
              可保存多个订阅地址，启用其中一个；首页热门与搜索都基于它
            </div>
          </div>
          <span
            className={`shrink-0 text-[10.5px] ${
              catReady === null
                ? 'text-muted'
                : catReady
                  ? 'text-emerald-400/90'
                  : 'text-amber-400/90'
            }`}
          >
            {catReady === null
              ? '正在检测…'
              : catReady
                ? `当前 · ${catCount} 个站点`
                : catSubs.length === 0
                  ? '未添加源'
                  : '未连接'}
          </span>
        </div>

        {/* 已保存的订阅源 */}
        {catSubs.length > 0 ? (
          <div className="space-y-2">
            {catSubs.map((s) => {
              const isActive = activeSub?.id === s.id
              const isRunning = catReady && runningUrl === s.url
              const probing = probingId === s.id
              const tested = probeResult?.id === s.id ? probeResult.data : null
              return (
                <div
                  key={s.id}
                  className={`glass-inset rounded-lg px-3 py-2.5 ${
                    isActive ? 'ring-1 ring-gold/40' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void applySwitch(s.id)}
                      disabled={catBusy}
                      title={isActive ? '当前已选择，点此重新连接' : `选择「${s.name}」作为当前订阅`}
                      className={`flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition ${
                        isActive
                          ? 'bg-gold/15 text-gold ring-1 ring-gold/35'
                          : 'border border-white/20 text-muted hover:border-gold/50 hover:text-gold'
                      } disabled:opacity-50`}
                    >
                      {isActive ? <Check size={12} strokeWidth={3} /> : <span className="h-2.5 w-2.5 rounded-full border border-current" />}
                      {isActive ? '使用中' : '选择'}
                    </button>
                    {editingId === s.id ? (
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <input
                          autoFocus
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(s.id)
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          className="glass-input h-7 min-w-0 flex-1 rounded-md px-2 text-[11.5px]"
                        />
                        <button
                          onClick={() => saveEdit(s.id)}
                          className="glass-btn rounded-md p-1 text-emerald-300"
                          title="保存"
                        >
                          <Check size={12} />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="glass-btn rounded-md p-1 text-muted"
                          title="取消"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span
                          className={`min-w-0 truncate text-[12px] font-medium ${
                            isActive ? 'text-gold' : 'text-fg/90'
                          }`}
                        >
                          {s.name}
                        </span>
                        {isActive && isRunning && (
                          <span className="shrink-0 rounded bg-emerald-400/12 px-1.5 py-0.5 text-[9px] text-emerald-300">
                            运行中
                          </span>
                        )}
                        <button
                          onClick={() => void testCat(s)}
                          disabled={probing || catBusy}
                          className={`ml-auto flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] transition disabled:opacity-50 ${
                            tested ? (tested.ok ? 'text-emerald-300' : 'text-amber-300') : 'text-muted hover:text-gold'
                          }`}
                          title="测试这个订阅是否可用（独立引擎，不影响正在看的源）"
                        >
                          {probing ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />}
                          测试
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(s.id)
                            setEditName(s.name)
                          }}
                          className="glass-btn rounded-md p-1 text-muted transition hover:text-fg"
                          title="改名"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          onClick={() => void removeCat(s.id)}
                          disabled={catBusy}
                          className="glass-btn rounded-md p-1 text-muted transition hover:text-red-300"
                          title="删除"
                        >
                          <Trash2 size={11} />
                        </button>
                      </>
                    )}
                  </div>
                  <div className="mt-1 truncate pl-1 text-[10.5px] text-muted/75" title={s.url}>
                    {s.url}
                  </div>
                  {tested && (
                    <div
                      className={`mt-2 rounded-md px-2 py-1.5 text-[10.5px] leading-snug ${
                        tested.ok ? 'bg-emerald-400/8 text-emerald-200/90' : 'bg-amber-400/8 text-amber-200/90'
                      }`}
                    >
                      <div className="flex items-center gap-1 font-medium">
                        {tested.ok ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                        {tested.message}
                      </div>
                      {tested.samples.length > 0 && (
                        <div className="mt-1 truncate text-muted/70">命中：{tested.samples.join('、')}</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-white/16 px-4 py-5 text-center text-[11px] text-muted">
            还没有影视订阅源。下面填一个 CAT 订阅地址即可开始。
          </div>
        )}

        {/* 添加新订阅 */}
        <div className="mt-3 flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="名称（可选）"
            className="glass-input h-9 w-[92px] shrink-0 rounded-lg px-2.5 text-[12px]"
          />
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addCat()
            }}
            placeholder="https://.../index.js.md5"
            className="glass-input h-9 min-w-0 flex-1 rounded-lg px-3 text-[12px]"
          />
          <button
            onClick={() => void addCat()}
            disabled={catBusy}
            className="glass-primary flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-[12px] font-semibold"
          >
            {catBusy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            添加
          </button>
        </div>

        <div className="mt-3 flex items-center gap-3">
          {catSubs.length > 0 && (
            <button
              onClick={() => void connectCat()}
              disabled={catBusy}
              className="flex items-center gap-1 text-[11px] text-muted transition hover:text-gold"
            >
              <RefreshCw size={11} /> 重新连接当前源
            </button>
          )}
          <button
            onClick={() => void openPanConfig()}
            className="ml-auto flex items-center gap-1 text-[11px] text-muted transition hover:text-gold"
          >
            <KeyRound size={11} /> 网盘配置中心
          </button>
        </div>
        {!inTauri() && (
          <p className="mt-2 text-[10.5px] text-muted/70">
            浏览器预览里只能管理列表，连接引擎需要桌面版。
          </p>
        )}
        {catMsg && (
          <p
            className={`mt-2 flex items-start gap-1.5 text-[11px] leading-snug ${
              catMsg.kind === 'ok' ? 'text-emerald-400/90' : 'text-amber-400/90'
            }`}
          >
            {catMsg.kind === 'ok' ? (
              <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
            ) : (
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
            )}
            {catMsg.text}
          </p>
        )}
      </div>

      {/* 播放列表 / 本地目录 */}
      <div className="px-5 py-4">
        <div className="mb-3">
          <div className="text-[12.5px] text-fg/90">播放列表与本地目录</div>
          <div className="mt-0.5 text-[11px] leading-snug text-muted">
            M3U / Xtream 订阅或扫描本地媒体文件夹
          </div>
        </div>
        <div className="mb-3 grid grid-cols-3 gap-2">
          {tabs.map(([key, label, desc]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`glass-chip rounded-lg p-2.5 text-left ${tab === key ? 'is-active' : ''}`}
            >
              <div className={`text-[11.5px] font-medium ${tab === key ? 'text-gold' : 'text-fg'}`}>
                {label}
              </div>
              <div className="mt-0.5 text-[10px] leading-snug text-muted">{desc}</div>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[11.5px] text-muted">源名称</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如 家庭 IPTV"
              className="glass-input h-9 w-full rounded-lg px-3 text-[12.5px] text-fg"
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
              className="glass-input h-9 w-full rounded-lg px-3 text-[12.5px] text-fg"
            />
          </label>
          {tab === 'xtream' && (
            <>
              <label className="block">
                <span className="mb-1.5 block text-[11.5px] text-muted">用户名</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="glass-input h-9 w-full rounded-lg px-3 text-[12.5px] text-fg"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11.5px] text-muted">密码</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="glass-input h-9 w-full rounded-lg px-3 text-[12.5px] text-fg"
                />
              </label>
            </>
          )}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => void handleAdd()}
            disabled={busy}
            className="glass-primary flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12.5px] font-semibold"
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

      {/* 已连接源 */}
      <div className="px-5 py-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[12.5px] text-fg/90">已连接 {sources.length} 个播放列表</div>
          <span className="text-[10.5px] text-muted/70">仅保存在本机</span>
        </div>
        {sources.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/16 bg-white/[0.025] px-4 py-7 text-center text-[11.5px] text-muted">
            还没有连接播放列表。接上 M3U 或 Xtream 后，频道会自动出现在首页。
          </div>
        ) : (
          <div className="space-y-2">
            {sources.map((s) => (
              <div
                key={s.id}
                className="glass-inset flex items-center justify-between rounded-lg px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-medium">{s.name}</span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-muted">
                      {s.kind}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted">
                    {s.url} · {s.itemCount} 个条目
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => void handleRefresh(s.id)}
                    className="glass-btn rounded-lg p-1.5 text-muted"
                    title="刷新"
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button
                    onClick={() => actions.removeSource(s.id)}
                    className="glass-btn rounded-lg p-1.5 text-muted hover:text-red-300"
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
    </>
  )
}
