import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function PZUPL({ size = 24, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" shapeRendering="geometricPrecision" {...props}>
      <g clipPath="url(#clip0_1249_6667)">
      <path d="M24 0H0V24H24V0Z" fill="#F4F5F6"/>
      <path d="M10.3667 8.81134L10.5437 9.71798H12.0657L12.0601 9.73379L10.2163 15.2422H13.5015L13.286 14.277H11.6173L11.6226 14.2617L13.4025 8.81134H10.3667Z" fill="url(#paint0_radial_1249_6667)"/>
      <path d="M9.26153 10.4424H7.69745L7.80864 11.1809V13.5674H8.68601V12.818H8.69765C8.69765 12.818 9.20974 12.8187 9.26153 12.8187C9.90267 12.8187 10.4413 12.2638 10.4413 11.623C10.4413 10.9813 9.90267 10.4424 9.26153 10.4424ZM9.18342 12.1255C9.17778 12.1255 8.69765 12.1265 8.69765 12.1265H8.68601V11.1825H8.69765C8.69765 11.1825 9.16713 11.1816 9.18342 11.1816C9.42938 11.1816 9.64634 11.3978 9.64634 11.6436C9.64627 11.891 9.42938 12.1255 9.18342 12.1255Z" fill="url(#paint1_radial_1249_6667)"/>
      <path d="M15.3829 12.2973C15.3829 12.589 15.1445 12.8087 14.8727 12.8087C14.6008 12.8087 14.3626 12.589 14.3626 12.2973C14.3626 12.2724 14.3635 10.5388 14.3637 10.3686L13.4779 10.5122V12.2555C13.4779 13.0392 14.1094 13.6532 14.8727 13.6532C15.6361 13.6532 16.2677 13.0393 16.2677 12.2555V10.3686L15.3809 10.5123C15.3811 10.6551 15.3829 12.2736 15.3829 12.2973Z" fill="url(#paint2_radial_1249_6667)"/>
      <path d="M12.0007 4C7.5891 4.00092 4 7.5903 4 12.0011C4 16.4116 7.5891 20 12.0007 20C16.411 20 19.9994 16.4116 20 12.0011C19.9994 7.5903 16.4109 4.00085 12.0007 4ZM12.0009 17.6255C8.90391 17.6207 6.38006 15.0971 6.37462 12.0005C6.38006 8.90398 8.90398 6.3802 12.0007 6.3747H12.0009C15.0961 6.3802 17.6195 8.90398 17.6262 12.0005C17.6194 15.0971 15.0961 17.6207 12.0009 17.6255Z" fill="url(#paint3_radial_1249_6667)"/>
      </g>
      <defs>
      <radialGradient id="paint0_radial_1249_6667" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(7.28154 6.88303) scale(14.8906 14.8907)">
      <stop stopColor="#84D0F0"/>
      <stop offset="0.15" stopColor="#00A8E4"/>
      <stop offset="0.333" stopColor="#0078BE"/>
      <stop offset="0.5" stopColor="#00509E"/>
      <stop offset="1" stopColor="#001C54"/>
      </radialGradient>
      <radialGradient id="paint1_radial_1249_6667" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(7.34778 6.88265) scale(14.7722 14.7722)">
      <stop stopColor="#84D0F0"/>
      <stop offset="0.15" stopColor="#00A8E4"/>
      <stop offset="0.333" stopColor="#0078BE"/>
      <stop offset="0.5" stopColor="#00509E"/>
      <stop offset="1" stopColor="#001C54"/>
      </radialGradient>
      <radialGradient id="paint2_radial_1249_6667" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(7.34788 6.85142) scale(14.797 14.797)">
      <stop stopColor="#84D0F0"/>
      <stop offset="0.15" stopColor="#00A8E4"/>
      <stop offset="0.333" stopColor="#0078BE"/>
      <stop offset="0.5" stopColor="#00509E"/>
      <stop offset="1" stopColor="#001C54"/>
      </radialGradient>
      <radialGradient id="paint3_radial_1249_6667" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(7.34765 6.8831) scale(14.7718 14.7718)">
      <stop stopColor="#84D0F0"/>
      <stop offset="0.15" stopColor="#00A8E4"/>
      <stop offset="0.333" stopColor="#0078BE"/>
      <stop offset="0.5" stopColor="#00509E"/>
      <stop offset="1" stopColor="#001C54"/>
      </radialGradient>
      <clipPath id="clip0_1249_6667">
      <rect width="24" height="24" fill="white"/>
      </clipPath>
      </defs>
    </svg>
  )
}
