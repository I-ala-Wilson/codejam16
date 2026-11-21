import { useState } from 'react'
import RoomTest from './RoomTest.tsx'
import Record from './Record.tsx'

const PAGES = { room: 'Room test', record: 'Record gestures' } as const
type Page = keyof typeof PAGES

export default function App() {
  const [page, setPage] = useState<Page>(location.hash === '#record' ? 'record' : 'room')
  const go = (p: Page) => { setPage(p); location.hash = p }
  return (
    <div>
      <nav style={{ display: 'flex', gap: 8, padding: '12px 16px 0' }}>
        {(Object.keys(PAGES) as Page[]).map((p) => (
          <button key={p} onClick={() => go(p)} style={{ fontWeight: page === p ? 800 : 400 }}>{PAGES[p]}</button>
        ))}
      </nav>
      {page === 'room' ? <RoomTest /> : <Record />}
    </div>
  )
}
