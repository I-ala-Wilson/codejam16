import type { ReactNode } from 'react'

export function Slot({ filled, children }: { filled: boolean; children?: ReactNode }) {
  return <span className={`echo-slot${filled ? ' echo-slot--filled' : ''}`}>{children}</span>
}
