import { useEffect, useState } from 'react'
import { Activity, CheckCircle2, KeyRound, Loader2, AlertCircle } from 'lucide-react'
import {
  tmdbGetConfig,
  tmdbSetConfig,
  tmdbTest,
  TMDB_DEFAULT_BASE,
  type TmdbConfigView,
  type TmdbTestResult,
} from '../lib/tmdb'

/** 设置页「TMDB 影视数据源」区块 */
export default function TmdbSection() {
  const [cfg, setCfg] = useState<TmdbConfigView | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(TMDB_DEFAULT_BASE)
  const [language, setLanguage] = useState('zh-CN')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TmdbTestResult | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const refresh = async () => {
    try {
      const c = await tmdbGetConfig()
      setCfg(c)
      setBaseUrl(c.base_url || TMDB_DEFAULT_BASE)
      setLanguage(c.language || 'zh-CN')
    } catch {
      setCfg(null)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function save() {
    setSaving(true)
    setMsg(null)
    setResult(null)
    try {
      const c = await tmdbSetConfig(apiKey, baseUrl, language)
      setCfg(c)
      setApiKey('')
      setMsg({
        kind: 'ok',
        text: c.configured ? `已保存 TMDB Key（${c.api_key_hint}）` : '已清空 TMDB Key，首页将使用离线数据',
      })
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    setTesting(true)
    setResult(null)
    setMsg(null)
    try {
      const r = await tmdbTest()
      setResult(r)
    } catch (e) {
      setMsg({ kind: 'err', text: `测试失败：${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="px-5 py-4">
      <div className="flex items-start gap-2">
        <KeyRound size={14} className="mt-0.5 shrink-0 text-gold" />
        <div className="min-w-0">
          <div className="text-[12.5px] text-fg/90">影视数据源（TMDB）</div>
          <div className="mt-0.5 text-[11px] leading-snug text-muted">
            首页榜单来自 TMDB。官方 api.themoviedb.org 在国内不可达，已默认使用可用的官方备用域名 api.tmdb.org。
            Key 只保存在本机配置文件，不上传、不写进程序。
          </div>
        </div>
        <span
          className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10.5px] ${
            cfg?.configured ? 'bg-emerald-400/12 text-emerald-300' : 'bg-white/8 text-muted'
          }`}
        >
          {cfg?.configured ? `已配置 ${cfg.api_key_hint}` : '未配置（离线数据）'}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.4fr]">
        <label className="block">
          <span className="mb-1 block text-[10.5px] text-muted">API 地址</span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            spellCheck={false}
            className="glass-input w-full rounded-lg px-2.5 py-1.5 text-[11.5px] outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10.5px] text-muted">语言</span>
          <input
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            spellCheck={false}
            className="glass-input w-full rounded-lg px-2.5 py-1.5 text-[11.5px] outline-none"
          />
        </label>
      </div>

      <label className="mt-2 block">
        <span className="mb-1 block text-[10.5px] text-muted">
          API Key（v3 32 位 key 或 v4 eyJ 开头的 Bearer Token；留空并保存即清除）
        </span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={cfg?.configured ? '已保存，输入新 Key 覆盖' : '粘贴你的 TMDB API Key'}
          spellCheck={false}
          className="glass-input w-full rounded-lg px-2.5 py-1.5 text-[11.5px] outline-none"
        />
      </label>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => void save()}
          disabled={saving}
          className="glass-primary flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[11.5px] font-semibold disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
          保存
        </button>
        <button
          onClick={() => void test()}
          disabled={testing || !cfg?.configured}
          title={cfg?.configured ? '测试当前 Key 是否能拉到影视数据' : '请先保存 Key'}
          className="glass-btn flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] text-muted hover:text-gold disabled:opacity-50"
        >
          {testing ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />}
          测试连接
        </button>
      </div>

      {msg && (
        <div
          className={`mt-2 flex items-center gap-1.5 text-[10.5px] ${
            msg.kind === 'ok' ? 'text-emerald-300' : 'text-amber-300'
          }`}
        >
          {msg.kind === 'ok' ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
          {msg.text}
        </div>
      )}

      {result && (
        <div
          className={`mt-2 rounded-md px-2 py-1.5 text-[10.5px] leading-snug ${
            result.ok ? 'bg-emerald-400/8 text-emerald-200/90' : 'bg-amber-400/8 text-amber-200/90'
          }`}
        >
          <div className="flex items-center gap-1 font-medium">
            {result.ok ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
            {result.message}
          </div>
          {result.samples.length > 0 && (
            <div className="mt-1 truncate text-muted/70">样例：{result.samples.join('、')}</div>
          )}
        </div>
      )}
    </div>
  )
}
