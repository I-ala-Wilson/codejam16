import type { ReactNode } from 'react'

export function Window({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="echo-window">
      <header className="echo-window__bar">{title}</header>
      <div className="echo-window__body">{children}</div>
    </section>
  )
}
