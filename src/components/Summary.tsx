import { useState } from 'react'

/** Un résumé replié sur trois lignes, avec « Lire la suite » s'il est long. */
export function Summary({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 220
  return (
    <>
      <p className={`show__summary${long && !open ? ' show__summary--clamped' : ''}`} style={{ whiteSpace: 'pre-line' }}>
        {text}
      </p>
      {long && (
        <button type="button" className="link-btn show__summary-more" onClick={() => setOpen((v) => !v)}>
          {open ? 'Réduire' : 'Lire la suite'}
        </button>
      )}
    </>
  )
}
