import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function ELTPL({ size = 24, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" shapeRendering="geometricPrecision" {...props}>
      <g clipPath="url(#clip0_185_1031)">
      <rect width="24" height="24" fill="#E10A17"/>
      <path d="M11.4003 16.5227L10.4967 14.9602L1.52588e-05 21.02V24.0001L10.3359 18.0331L11.2373 19.5979L16.4913 16.5657L15.2004 14.3307L11.4003 16.5227Z" fill="white"/>
      <path d="M11.2373 9.2672L16.4913 6.23505L15.2004 4L11.4003 6.19429L10.4967 4.62953L0 10.6893V13.6694L10.3359 7.70246L11.2373 9.2672Z" fill="white"/>
      <path d="M11.4003 11.3551L10.4967 9.79031L1.52588e-05 15.8501V18.8301L10.3359 12.8632L11.2373 14.428L16.4913 11.3958L15.2004 9.16077L11.4003 11.3551Z" fill="white"/>
      </g>
      <defs>
      <clipPath id="clip0_185_1031">
      <rect width="24" height="24" fill="white"/>
      </clipPath>
      </defs>
    </svg>
  )
}
