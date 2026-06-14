type Props = {
  className?: string
}

export function BrandMark({ className }: Props) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.5 13 H46.5 Q48.5 13 48.5 15 V23.5 Q48.5 25.5 46.5 25.5 H36.5 V48 H40.5 L41.6 54.7 Q41.85 55.8 40.6 55.8 H23.4 Q22.15 55.8 22.4 54.7 L23.5 48 H27.5 V25.5 H17.5 Q15.5 25.5 15.5 23.5 V15 Q15.5 13 17.5 13 Z" />
    </svg>
  )
}
