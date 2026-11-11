import type { ReactNode } from 'react'

interface RowProps {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
}

export default function Row({ title, subtitle, action, children }: RowProps) {
  return (
    <section className="animate-fade-up">
      <div className="mb-3 flex items-end justify-between px-10">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-fg">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[11.5px] text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="no-scrollbar flex gap-3 overflow-x-auto px-10 pb-2">{children}</div>
    </section>
  )
}
