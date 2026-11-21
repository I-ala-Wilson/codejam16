import { useState } from 'react'
import RoomTest from './RoomTest.tsx'
import Home from './Home.tsx'
import { useGuardian } from './lock/guardian.ts'
import Record from './Record.tsx'
import Lock from './Lock.tsx'
import Gestures from './Gestures.tsx'
import Dataset from './Dataset.tsx'
import LiveTest from './LiveTest.tsx'
import Care from './Care.tsx'
import BreathRecord from './BreathRecord.tsx'
import Caregiver from './Caregiver.tsx'
import HabitPage from './habit/HabitPage.tsx'
import HabitWatch from './habit/HabitWatch.tsx'

const PAGES = { home: 'ECHØ', lock: 'Lock', care: 'Care', caregiver: 'Caregiver', 'habit-app': 'Habit', room: 'Room test', dataset: 'Dataset recording', habit: 'Habit recording', gestures: 'Gesture test', live: 'Live test (cued)', breath: 'Breathing takes', record: 'Pilot record (old)' } as const
type Page = keyof typeof PAGES

export default function App() {
  useGuardian()
  const [page, setPage] = useState<Page>(location.pathname === '/lock' ? 'lock' : ((location.hash.slice(1) as Page) in PAGES ? (location.hash.slice(1) as Page) : 'home'))
  const go = (p: Page) => { setPage(p); location.hash = p }
  return (
    <div>
      <nav className="top">
        {(Object.keys(PAGES) as Page[]).map((p) => (
          <button key={p} onClick={() => go(p)} className={page === p ? 'on' : ''}>{PAGES[p]}</button>
        ))}
      </nav>
      {page === 'home' ? <Home go={(p) => go(p as Page)} /> : page === 'room' ? <RoomTest /> : page === 'gestures' ? <Gestures /> : page === 'live' ? <LiveTest /> : page === 'dataset' ? <Dataset key="main" only="main" /> : page === 'habit' ? <Dataset key="habit" only="habit" /> : page === 'record' ? <Record /> : page === 'breath' ? <BreathRecord /> : page === 'care' ? <Care /> : page === 'caregiver' ? <Caregiver /> : page === 'habit-app' ? <HabitPage /> : <Lock />}
      <HabitWatch />
    </div>
  )
}
