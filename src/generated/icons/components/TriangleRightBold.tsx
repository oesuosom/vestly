import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function TriangleRightBold({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M10.9869 8.14664C10.0742 7.69047 9 8.35379 9 9.37432V14.6257C9 15.6462 10.0742 16.3095 10.9869 15.8534L15.2401 13.2277C16.2521 12.7219 16.252 11.2781 15.2401 10.7723L10.9869 8.14664Z" fill="currentColor"/>
    </svg>
  )
}
