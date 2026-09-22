import { useApp } from '../lib/appState'
import { href } from '../lib/route'
import { supabase } from '../lib/supabase'
import { Notifications } from './Notifications'
import { Poster } from './Poster'
import { RatingPicker } from './RatingPicker'
import { SetPassword } from './SetPassword'

export function Settings() {
  const { tracked, movies, rateShow, rateMovie, dismissed, undismissRec } = useApp()

  // Rien à noter pour une série jamais commencée ou abandonnée en route.
  const unratedShows = tracked.filter((t) => !t.rating && t.status !== 'later' && t.status !== 'dropped')
  const unratedMovies = movies.filter((m) => m.status === 'watched' && !m.rating)

  return (
    <div className="settings">
      <section>
        <h2 className="section-title">Compte</h2>
        <p className="muted">Connectée avec un compte Google, et/ou un mot de passe.</p>
        <SetPassword />
        <button className="btn btn--ghost settings__signout" onClick={() => supabase.auth.signOut()}>
          Déconnexion
        </button>
      </section>

      <Notifications />

      <section>
        <h2 className="section-title">Import</h2>
        <p className="muted">
          Un historique Netflix à importer ? <a href={href.import}>C'est par ici</a>.
        </p>
      </section>

      {(unratedShows.length > 0 || unratedMovies.length > 0) && (
        <section>
          <h2 className="section-title">Noter mes séries et films</h2>
          <ul className="rows">
            {unratedShows.map((t) => (
              <li key={`show-${t.show_id}`} className="row">
                <a href={href.show(t.show_id)} className="row__link">
                  <Poster src={t.image_url} alt={t.name} />
                  <div className="row__body">
                    <h3>{t.name}</h3>
                  </div>
                </a>
                <RatingPicker rating={t.rating} onChange={(r) => rateShow(t.show_id, r)} />
              </li>
            ))}
            {unratedMovies.map((m) => (
              <li key={`movie-${m.movie_id}`} className="row">
                <a href={href.movie(m.movie_id)} className="row__link">
                  <Poster src={m.poster_url} alt={m.title} />
                  <div className="row__body">
                    <h3>{m.title}</h3>
                  </div>
                </a>
                <RatingPicker rating={m.rating} onChange={(r) => rateMovie(m.movie_id, r)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="section-title">Séries et films masqués</h2>
        {dismissed.length === 0 ? (
          <p className="muted">Aucune suggestion écartée pour l'instant.</p>
        ) : (
          <ul className="rows">
            {dismissed.map((d) => (
              <li key={`${d.kind}-${d.tmdb_id}`} className="row">
                <div className="row__link">
                  <Poster src={d.poster_url} alt={d.name} />
                  <div className="row__body">
                    <h3>{d.name}</h3>
                  </div>
                </div>
                <button className="link-btn" onClick={() => undismissRec(d.kind, d.tmdb_id)}>
                  Réafficher
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
