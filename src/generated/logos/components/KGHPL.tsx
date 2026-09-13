import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function KGHPL({ size = 24, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" shapeRendering="geometricPrecision" {...props}>
      <g clipPath="url(#clip0_185_1028)">
      <rect width="24" height="24" fill="#F4F5F6"/>
      <path d="M7.00012 9.66025L7.00024 12.8737L13.3397 9.21344L17 11.3284V8.1133L13.3399 6.00003L7.00012 9.66025Z" fill="#6E6E6E"/>
      <path d="M10.6602 18.2025L7.00012 16.0892L7 12.8741L10.6604 14.9892L16.9999 11.3288L17 14.5422L10.6602 18.2025Z" fill="#A77556"/>
      </g>
      <defs>
      <clipPath id="clip0_185_1028">
      <rect width="24" height="24" fill="white"/>
      </clipPath>
      </defs>
    </svg>
  )
}
