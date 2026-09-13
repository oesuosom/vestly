import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function EditSmall({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M20.5 13V17.4091C20.5 19.1162 19.1162 20.5 17.4091 20.5H6.59091C4.88385 20.5 3.5 19.1162 3.5 17.4091V6.59091C3.5 4.88385 4.88385 3.5 6.59091 3.5H11M11.75 12.2502V9.25022L17.25 3.75022C18.0784 2.9218 19.4216 2.9218 20.25 3.75022C21.0784 4.57865 21.0784 5.92179 20.25 6.75022L14.75 12.2502H11.75Z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
