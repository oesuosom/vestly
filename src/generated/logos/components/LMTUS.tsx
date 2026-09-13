import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function LMTUS({ size = 24, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" shapeRendering="geometricPrecision" {...props}>
      <g clipPath="url(#clip0_185_1026)">
      <path d="M24 0H0V24H24V0Z" fill="#003E69"/>
      <path d="M31.4049 8.3737H17.8685C19.654 1.68858 21.2734 -4 21.2734 -4C21.2734 -4 15.1696 2.51903 9.77163 8.3737L-44 8.49827L8.35986 9.82699C4.33218 14.1038 2.21453 16.5536 2.13149 16.6367C2.29758 16.4706 9.56402 9.86851 9.56402 9.86851L15.917 10.0346L14.9619 15.0588L-14.8512 31.917L-14.9758 32C-14.9758 32 8.73357 19.5433 14.7128 16.5121C14.7128 16.5121 12.5952 27.4741 12.5952 27.5156L12.6367 27.391C12.8443 26.6851 14.09 22.3668 15.7924 15.9723C23.5986 12.0277 31.4049 8.3737 31.4049 8.3737ZM17.3287 2.76817L16.2491 8.3737H11.1834L17.3287 2.76817ZM17.3702 10.0346L23.5571 10.2007L16.2076 14.3529C16.6228 12.8581 16.955 11.5294 17.3702 10.0346Z" fill="white"/>
      </g>
      <defs>
      <clipPath id="clip0_185_1026">
      <rect width="24" height="24" fill="white"/>
      </clipPath>
      </defs>
    </svg>
  )
}
