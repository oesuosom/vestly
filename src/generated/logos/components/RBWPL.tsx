import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function RBWPL({ size = 24, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" shapeRendering="geometricPrecision" {...props}>
      <g clipPath="url(#clip0_1249_6669)">
      <path d="M24 0H0V24H24V0Z" fill="#124998"/>
      <path d="M17.1322 14.438L15.9089 12.6289C16.9645 11.5255 17.3311 10.758 17.3311 9.56848C17.3313 7.19104 15.6008 5.5 12.9896 5.5H9.07296C7.57146 5.5 6.5 6.5972 6.5 8.16396V16.2021C6.5 17.492 7.50828 18.5 9.0116 18.5C10.5144 18.5 11.5008 17.4652 11.5008 16.1688V14.9442L13.0023 17.2484C13.5065 18.0143 14.2571 18.5 15.1629 18.5C16.6657 18.5 17.6917 17.441 17.6917 15.9426C17.6917 15.5334 17.5003 14.9715 17.1322 14.438Z" fill="#FFBF00"/>
      </g>
      <defs>
      <clipPath id="clip0_1249_6669">
      <rect width="24" height="24" fill="white"/>
      </clipPath>
      </defs>
    </svg>
  )
}
