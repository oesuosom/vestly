import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function CodeLines({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M2.75 4.75H13.2M17.75 4.75H21.25M2.75 12H6.25M10.75 12H21.25M2.75 19.25H10.25M14.75 19.25H21.25" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
