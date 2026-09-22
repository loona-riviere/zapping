import { useEffect, useState } from 'react'
import { tmdbConfigured, watchProviders, type Availability, type Provider } from '../lib/tmdb'

// Un abonnement Netflix (ou Prime Video, etc.) donne accès au catalogue quel
// que soit le palier ou le canal d'accès : pas la peine d'afficher « Netflix »
// et « Netflix Standard with Ads », ou « Apple TV » et « Apple TV Amazon
// Channel », côte à côte pour la même plateforme — un seul badge, en
// préférant la version directe (sans pub, sans passer par Amazon Channel).
function dedupeProviders(providers: Provider[]): Provider[] {
  const byPlatform = new Map<string, Provider>()
  for (const p of providers) {
    // Le nom du palier (Standard/Basic/…) ou « Plus » se glisse AVANT
    // « with Ads »/« Amazon Channel », donc il faut le retirer lui aussi pour
    // retomber sur la même clé que la plateforme toute seule.
    const key = p.name
      .replace(/\s+(standard|basic|premium)?\s*(with ads|w\/ ads).*/i, '')
      .replace(/\s+(plus)?\s*amazon channel.*/i, '')
      .trim()
      .toLowerCase()
    const existing = byPlatform.get(key)
    const isBundled = (name: string) => /ads|amazon channel/i.test(name)
    if (!existing || (isBundled(existing.name) && !isBundled(p.name))) {
      byPlatform.set(key, p)
    }
  }
  return [...byPlatform.values()]
}

// Identifiants TMDB des plateformes pour lesquelles on connaît un lien de
// recherche fiable dans l'appli native (universal link, ouvre l'appli si
// elle est installée). Pas de fiche précise — TMDB ne donne pas d'ID par
// titre chez ces plateformes — mais une recherche pré-remplie sur le bon
// titre, dans la bonne appli, au lieu de la page JustWatch générique.
const APP_SEARCH: Record<number, (title: string) => string> = {
  8: (title) => `https://www.netflix.com/search?q=${encodeURIComponent(title)}`, // Netflix
  350: (title) => `https://tv.apple.com/search?term=${encodeURIComponent(title)}`, // Apple TV+
  337: (title) => `https://www.disneyplus.com/search?q=${encodeURIComponent(title)}`, // Disney+
}

/**
 * Plateformes où la série est incluse dans l'abonnement, en France.
 * Rien ne s'affiche tant qu'on ne sait pas, et rien non plus si l'offre est
 * vide : une absence de badge ne veut pas dire « indisponible », seulement
 * « pas en abonnement chez les plateformes que JustWatch suit ».
 */
export function WhereToWatch({ imdbId, title }: { imdbId: string | null | undefined; title: string }) {
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

  return (
    <section className="where">
      <h2 className="where__title">Où la regarder</h2>
      <div className="where__list">
        {dedupeProviders(data.providers).map((p) => {
          const href = APP_SEARCH[p.id]?.(title) ?? data.link
          const badge = (
            <span className="where__badge">
              {p.logo ? <img src={p.logo} alt="" loading="lazy" width={24} height={24} /> : null}
              {p.name}
            </span>
          )
          return href ? (
            <a key={p.id} className="where__link" href={href} target="_blank" rel="noreferrer">
              {badge}
            </a>
          ) : (
            <span key={p.id}>{badge}</span>
          )
        })}
      </div>
      <p className="where__note muted">
        En abonnement en France. Source : JustWatch, via TMDB.
      </p>
    </section>
  )
}
