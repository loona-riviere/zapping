import { useEffect, useState } from 'react'
import { tmdbConfigured, watchProviders, type Availability } from '../lib/tmdb'

/**
 * Plateformes où la série est incluse dans l'abonnement, en France.
 * Rien ne s'affiche tant qu'on ne sait pas, et rien non plus si l'offre est
 * vide : une absence de badge ne veut pas dire « indisponible », seulement
 * « pas en abonnement chez les plateformes que JustWatch suit ».
 */
export function WhereToWatch({ imdbId }: { imdbId: string | null | undefined }) {
  const [data, setData] = useState<Availability | null>(null)

  useEffect(() => {
    let alive = true
    setData(null)
    if (!tmdbConfigured || !imdbId) return
    watchProviders(imdbId)
      .then((d) => alive && setData(d))
      .catch(() => {
        /* la disponibilité est un bonus : son échec ne doit rien casser */
      })
    return () => {
      alive = false
    }
  }, [imdbId])

  if (!data?.providers.length) return null

  const badges = data.providers.map((p) => (
    <span key={p.id} className="where__badge">
      {p.logo ? <img src={p.logo} alt="" loading="lazy" width={24} height={24} /> : null}
      {p.name}
    </span>
  ))

  return (
    <section className="where">
      <h2 className="where__title">Où la regarder</h2>
      <div className="where__list">
        {data.link ? (
          <a className="where__link" href={data.link} target="_blank" rel="noreferrer">
            {badges}
          </a>
        ) : (
          badges
        )}
      </div>
      <p className="where__note muted">
        En abonnement en France. Source : JustWatch, via TMDB.
      </p>
    </section>
  )
}
