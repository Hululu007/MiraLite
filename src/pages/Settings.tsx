import { actions, useLibrary } from '../lib/store'

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition ${
        on ? 'bg-gold' : 'bg-surface-3'
      }`}
    >
      <span
        className={`absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all ${
          on ? 'left-[19px]' : 'left-[3px]'
        }`}
      />
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 rounded-2xl border border-line/60 bg-surface/50">
      <div className="border-b border-line/50 px-5 py-3 text-[12.5px] font-medium text-fg/80">{title}</div>
      <div className="divide-y divide-line/40">{children}</div>
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
  const { prefs, progress, sources, watchlist } = useLibrary()

  return (
    <div className="px-10 pb-16 pt-7">
      <h1 className="mb-1 text-[22px] font-semibold tracking-tight">设置</h1>
      <p className="mb-6 text-[12px] text-muted">播放、推荐与本地数据处理方式</p>

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
            <div className="flex gap-1 rounded-lg border border-line/70 bg-surface-2/60 p-0.5">
              {(['auto', '1080p', '720p'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => actions.setPrefs({ preferQuality: k })}
                  className={`rounded-md px-2 py-1 text-[11px] transition ${
                    prefs.preferQuality === k ? 'bg-gold/90 text-black' : 'text-muted hover:text-fg'
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

      <Section title="数据">
        <Row title="已连接源" desc={`${sources.length} 个源`} right={<span className="text-[12px] text-muted">—</span>} />
        <Row title="片单" desc={`${watchlist.length} 部已收藏`} right={<span className="text-[12px] text-muted">—</span>} />
        <Row
          title="观看记录"
          desc={`${Object.keys(progress).length} 条播放进度，仅保存在本机`}
          right={
            <button
              onClick={() => {
                Object.keys(progress).forEach((id) => actions.clearProgress(id))
              }}
              className="rounded-lg border border-line/70 px-2.5 py-1 text-[11.5px] text-muted transition hover:border-red-500/40 hover:text-red-400"
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
