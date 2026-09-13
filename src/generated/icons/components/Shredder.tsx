import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function Shredder({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M2.75 12.75H21.25M4.75 9.25V5.75C4.75 4.09315 6.09315 2.75 7.75 2.75H16.25C17.9069 2.75 19.25 4.09315 19.25 5.75V9.25M5.75 16.25V19.1944M9.91667 16.25V21.25M14.0833 16.25V19.1944M18.25 16.25V21.25" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
