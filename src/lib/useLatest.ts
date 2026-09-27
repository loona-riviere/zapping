import { useRef } from 'react'

/**
 * Référence toujours à jour sur une valeur d'état. Les actions des contextes
 * la lisent au lieu de capturer l'état du dernier rendu : elles restent
 * stables (pas de redessin en cascade) et ne travaillent jamais sur une
 * version périmée quand deux actions se suivent de près.
 */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}
