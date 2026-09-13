import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function MDVPL({ size = 24, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" shapeRendering="geometricPrecision" {...props}>
      <g clipPath="url(#clip0_1249_6659)">
      <path d="M24 0H0V24H24V0Z" fill="#050505"/>
      <path d="M8.63102 6L11.9936 15.141L15.369 6.01311H18V17.9869H16.1904V9.06885L12.8791 17.9869H11.1337L7.82246 9.06885V18H6V6H8.63102Z" fill="white"/>
      </g>
      <defs>
      <clipPath id="clip0_1249_6659">
      <rect width="24" height="24" fill="white"/>
      </clipPath>
      </defs>
    </svg>
  )
}
