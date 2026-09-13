import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function Flashcards({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M10.625 7.17741L10.7505 5.98353C10.9237 4.33575 12.3999 3.14036 14.0476 3.31355L18.0257 3.73166C19.6735 3.90485 20.8689 5.38103 20.6957 7.02881L19.964 13.9905C19.7908 15.6383 18.3146 16.8337 16.6669 16.6605L14.0021 16.3804M3.26668 11.0288C3.09349 9.38103 4.28888 7.90485 5.93666 7.73166L9.91475 7.31355C11.5626 7.14036 13.0387 8.33575 13.2119 9.98353L13.9436 16.9452C14.1168 18.593 12.9214 20.0692 11.2736 20.2424L7.29553 20.6605C5.64775 20.8337 4.17157 19.6383 3.99838 17.9905L3.26668 11.0288Z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
