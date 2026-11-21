import { useState } from 'react'
import RoomTest from './RoomTest.tsx'
import Record from './Record.tsx'
import Lock from './Lock.tsx'
import Gestures from './Gestures.tsx'

const PAGES = { room: 'Room test', gestures: 'Gesture test', record: 'Record gestures', lock: 'Lock' } as const
type Page = keyof typeof PAGES

export default function App() {
  const [page, setPage] = useState<Page>(location.pathname === '/lock' ? 'lock' : ((location.hash.slice(1) as Page) in PAGES ? (location.hash.slice(1) as Page) : 'room'))
  const go = (p: Page) => { setPage(p); location.hash = p }
  return (
    <div>
      <nav style={{ display: 'flex', gap: 8, padding: '12px 16px 0' }}>
        {(Object.keys(PAGES) as Page[]).map((p) => (
          <button key={p} onClick={() => go(p)} style={{ fontWeight: page === p ? 800 : 400 }}>{PAGES[p]}</button>
        ))}
      </nav>
      {page === 'room' ? <RoomTest /> : page === 'gestures' ? <Gestures /> : page === 'record' ? <Record /> : <Lock />}
    </div>
  )
}
