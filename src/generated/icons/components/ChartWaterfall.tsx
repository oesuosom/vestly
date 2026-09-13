import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function ChartWaterfall({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M2.75 19.25H21.25M4 14.25V11.75M12 12.25V9.75M16 9.25V5.75M20 14.25V4.75M8 12.25V6.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
    </svg>
  )
}
