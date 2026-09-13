import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function OPLPL({ size = 24, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" shapeRendering="geometricPrecision" {...props}>
      <g clipPath="url(#clip0_1249_6670)">
      <path d="M0 0H24V24H0V0Z" fill="#FF7900"/>
      <rect x="4" y="16" width="16" height="4" fill="white"/>
      </g>
      <defs>
      <clipPath id="clip0_1249_6670">
      <rect width="24" height="24" fill="white"/>
      </clipPath>
      </defs>
    </svg>
  )
}
