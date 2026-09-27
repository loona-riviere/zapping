import { useState } from 'react'
import { ImportKindle } from './ImportKindle'
import { ImportList } from './ImportList'
import { ImportNetflix } from './ImportNetflix'

type Tab = 'netflix' | 'list' | 'kindle'

export function Import() {
  const [tab, setTab] = useState<Tab>('netflix')

  return (
    <div className="import">
      <h2 className="section-title">Import</h2>
      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'netflix'}
          className="tabs__tab"
          onClick={() => setTab('netflix')}
        >
          Historique Netflix
        </button>
        <button
          role="tab"
          aria-selected={tab === 'list'}
          className="tabs__tab"
          onClick={() => setTab('list')}
        >
          Liste à coller
        </button>
        <button
          role="tab"
          aria-selected={tab === 'kindle'}
          className="tabs__tab"
          onClick={() => setTab('kindle')}
        >
          Kindle
        </button>
      </div>
      {tab === 'netflix' && <ImportNetflix />}
      {tab === 'list' && <ImportList />}
      {tab === 'kindle' && <ImportKindle />}
    </div>
  )
}
