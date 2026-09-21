type Props = { src: string | null | undefined; alt: string; size?: 'sm' | 'lg' }

export function Poster({ src, alt, size = 'sm' }: Props) {
  return (
    <div className={`poster poster--${size}`}>
      {src ? <img src={src} alt={alt} loading="lazy" /> : <span aria-hidden="true">{alt.slice(0, 1)}</span>}
    </div>
  )
}
