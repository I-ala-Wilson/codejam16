import type { ReactNode } from 'react'

export function Button({
  children,
  onClick,
  variant = 'primary',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary'
}) {
  return (
    <button type="button" className={`echo-button echo-button--${variant}`} onClick={onClick}>
      {children}
    </button>
  )
}
