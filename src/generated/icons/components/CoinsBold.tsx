import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function CoinsBold({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M22 14C22 17.866 18.866 21 15 21C11.134 21 8 17.866 8 14C8 10.134 11.134 6.99998 15 6.99998C18.866 6.99998 22 10.134 22 14Z" fill="currentColor"/>
      <path d="M14.3807 5.52222C9.9754 5.83942 6.5 9.51385 6.5 14C6.5 14.9402 6.65266 15.8448 6.93455 16.6903C4.07675 15.809 2 13.147 2 10C2 6.13401 5.13401 3 9 3C11.1629 3 13.0967 3.98095 14.3807 5.52222Z" fill="currentColor"/>
    </svg>
  )
}
