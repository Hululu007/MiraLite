import { actions, useLibrary } from '../lib/store'
import LocalLibrary from '../components/LocalLibrary'
import SourcesSection from '../components/SourcesSection'
import SiteSwitches from '../components/SiteSwitches'
import TmdbSection from '../components/TmdbSection'
import { clearAllLineFails, failedLineCount } from '../lib/lines'
import { clearPlayback, usePlayback } from '../lib/playback'

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition ${
        on ? 'bg-gold shadow-[0_0_18px_-4px_rgba(232,180,76,0.75)]' : 'bg-white/14'
      }`}
    >
      <span
        className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all ${
          on ? 'left-[19px]' : 'left-[3px]'
        }`}
      />
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-panel mb-6 overflow-hidden rounded-2xl">
      <div className="border-b border-white/10 px-5 py-3 text-[12.5px] font-medium text-fg/85">{title}</div>
      <div className="divide-y divide-white/8">{children}</div>
    </div>
  )
}

function Row({ title, desc, right }: { title: string; desc: string; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5">
      <div className="min-w-0 pr-6">
        <div className="text-[12.5px] text-fg/90">{title}</div>
        <div className="mt-0.5 text-[11px] leading-snug text-muted">{desc}</div>
      </div>
      {right}
    </div>
  )
}

export default function SettingsPage() {
  const { prefs, progress, watchlist } = useLibrary()
  const playback = usePlayback()

  return (
    <div className="px-10 pb-16 pt-7">
      <h1 className="mb-1 text-[22px] font-semibold tracking-tight">设置</h1>
      <p className="mb-6 text-[12px] text-muted">播放、推荐、片源与本地数据处理方式</p>

      <Section title="播放">
        <Row
          title="自动连播"
          desc="一集结束后自动进入下一集"
          right={<Toggle on={prefs.autoplayNext} onChange={(v) => actions.setPrefs({ autoplayNext: v })} />}
        />
        <Row
          title="优先画质"
          desc="直播流与点播的默认清晰度"
          right={
            <div className="glass-inset flex gap-1 rounded-lg p-0.5">
              {(['auto', '1080p', '720p'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => actions.setPrefs({ preferQuality: k })}
                  className={`glass-chip rounded-md px-2 py-1 text-[11px] ${
                    prefs.preferQuality === k ? 'is-active text-gold' : 'text-muted'
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
          }
        />
      </Section>

      <Section title="推荐">
        <Row
          title="TastePrint 推荐"
          desc="根据观看记录生成 For You 与相似作品，只从你已连接的源里选"
          right={<Toggle on={prefs.tastePrint} onChange={(v) => actions.setPrefs({ tastePrint: v })} />}
        />
      </Section>

      <Section title="影视数据源（TMDB）">
        <TmdbSection />
      </Section>

      <Section title="片源">
        <SourcesSection />
      </Section>

      <Section title="本地媒体库">
        <LocalLibrary />
      </Section>

      <Section title="站点">
        <SiteSwitches />
      </Section>

      <Section title="数据">
        <Row title="片单" desc={`${watchlist.length} 部已收藏`} right={<span className="text-[12px] text-muted">—</span>} />
        <Row
          title="继续观看"
          desc={`${playback.length} 部片子记着看到哪，仅保存在本机`}
          right={
            <button
              onClick={() => clearPlayback()}
              className="glass-btn rounded-lg px-2.5 py-1 text-[11.5px] text-muted transition hover:text-red-300"
            >
              清空
            </button>
          }
        />
        <Row
          title="线路偏好"
          desc={`${failedLineCount()} 条线路带着失败记录，会被自动排到后面`}
          right={
            <button
              onClick={() => clearAllLineFails()}
              className="glass-btn rounded-lg px-2.5 py-1 text-[11.5px] text-muted transition hover:text-red-300"
            >
              重置
            </button>
          }
        />
        <Row
          title="演示媒体库进度"
          desc={`${Object.keys(progress).length} 条，仅保存在本机`}
          right={
            <button
              onClick={() => {
                Object.keys(progress).forEach((id) => actions.clearProgress(id))
              }}
              className="glass-btn rounded-lg px-2.5 py-1 text-[11.5px] text-muted transition hover:text-red-300"
            >
              清空
            </button>
          }
        />
      </Section>

      <p className="text-[11px] leading-relaxed text-muted/70">
        MiraLite 不提供任何内容源，仅作为客户端读取你自行连接的来源。所有观看记录与设置都保存在本机。
      </p>
    </div>
  )
}
