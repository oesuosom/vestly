import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function ArrowsLeftRightBold({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M7.24977 20.75L4.31043 17.8107C3.72465 17.2249 3.72465 16.2751 4.31043 15.6893L7.24977 12.75M16.75 11.25L19.6893 8.31066C20.2751 7.72487 20.2751 6.77513 19.6893 6.18934L16.75 3.25M5 16.75H20.25M3.75 7.25H19.25" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
