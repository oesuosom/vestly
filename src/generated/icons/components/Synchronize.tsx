import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function Synchronize({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M3.5 12C3.5 7.30558 7.30558 3.5 12 3.5C14.6702 3.5 17.0528 4.73124 18.6111 6.65696M19.0833 3.5V7.27778H15.3056M20.5 12C20.5 16.6944 16.6944 20.5 12 20.5C9.3298 20.5 6.94718 19.2688 5.38889 17.343M4.91667 20.5L4.91667 16.7222H8.69444" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
