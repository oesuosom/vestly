import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function ReceiptBill({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M9 8.00006H15M9 12.0001H12M19.5 4.75706V21.7501L15.75 20.2501L12 21.7501L8.25 20.2501L4.5 21.7501V4.75706C4.5 3.64906 5.306 2.70006 6.407 2.57206C10.1232 2.14069 13.8768 2.14069 17.593 2.57206C18.693 2.70006 19.5 3.64906 19.5 4.75706Z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
