type LoadingSpinnerProps = {
  size?: 'sm' | 'page'
}

export function LoadingSpinner({ size = 'sm' }: LoadingSpinnerProps) {
  const sizeClass = size === 'sm' ? 'w-4 h-4' : 'w-8 h-8'

  const spinner = (
    <div
      className={`${sizeClass} animate-spin rounded-full border-2 border-border border-t-accent`}
    />
  )

  if (size === 'page') {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        {spinner}
      </div>
    )
  }

  return spinner
}
