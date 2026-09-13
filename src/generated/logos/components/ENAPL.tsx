import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function ENAPL({ size = 24, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" shapeRendering="geometricPrecision" {...props}>
      <g clipPath="url(#clip0_1249_6663)">
      <path d="M24 0H0V24H24V0Z" fill="#F4F4F5"/>
      <path d="M4.3005 14.5V9.06H8.1805V10.004H5.4365V11.228H7.9805V12.164H5.4365V13.556H8.1805V14.5H4.3005ZM9.02706 14.5V9.06H11.0031L13.1231 14.34H13.0031L12.9791 9.06H14.0591V14.5H12.0831L9.96306 9.22H10.0831L10.1071 14.5H9.02706ZM17.4029 9.22L15.7389 14.5H14.5789L16.3789 9.06H18.3309L20.1549 14.5H18.9389L17.2749 9.22H17.4029ZM15.8269 13.084V12.18H18.8669V13.084H17.3549H15.8269Z" fill="#52525B"/>
      </g>
      <defs>
      <clipPath id="clip0_1249_6663">
      <rect width="24" height="24" fill="white"/>
      </clipPath>
      </defs>
    </svg>
  )
}
