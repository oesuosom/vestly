import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function Cross({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M17.5 6.5L6.5 17.5M6.5 6.5L17.5 17.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
