import { useEffect, useState } from 'react'
import RoomTest from './RoomTest.tsx'
import Home from './Home.tsx'
import { useGuardian } from './lock/guardian.ts'
import { keepSonarOn } from './sonar.ts'
import Lock from './Lock.tsx'
import Gestures from './Gestures.tsx'
import Dataset from './Dataset.tsx'
import LiveTest from './LiveTest.tsx'
import Care from './Care.tsx'
import HabitPage from './habit/HabitPage.tsx'
import HabitWatch from './habit/HabitWatch.tsx'
import CalibBanner from './CalibBanner.tsx'

const PAGES = { home: 'ECHØ', lock: 'Lock', care: 'Care', 'habit-app': 'Habit', room: 'Room test', calib: 'Calibration', dataset: 'Dataset recording', habit: 'Habit recording', gestures: 'Gesture test', live: 'Live test (cued)' } as const
type Page = keyof typeof PAGES
// Pitch mode: only the product is in the nav. The recording and test tabs still work by URL and appear with ?dev.
const PRODUCT: Page[] = ['home', 'lock', 'care', 'habit-app']
const DEV = new URLSearchParams(location.search).has('dev')

export default function App() {
  useGuardian()
  // The sonar starts the moment any page opens. If the browser blocks audio until the first interaction, the first
  // click or key anywhere starts it silently; there is no button to press.
  useEffect(() => keepSonarOn(), [])
  const [page, setPage] = useState<Page>(location.pathname === '/lock' ? 'lock' : ((location.hash.slice(1) as Page) in PAGES ? (location.hash.slice(1) as Page) : 'home'))
  const go = (p: Page) => { setPage(p); location.hash = p }
  return (
    <div>
      <nav className="top">
        {(Object.keys(PAGES) as Page[]).filter((p) => DEV || PRODUCT.includes(p) || p === page).map((p) => (
          <button key={p} onClick={() => go(p)} className={page === p ? 'on' : ''}>{PAGES[p]}</button>
        ))}
      </nav>
      {page === 'home' ? <Home go={(p) => go(p as Page)} /> : page === 'room' ? <RoomTest /> : page === 'gestures' ? <Gestures /> : page === 'live' ? <LiveTest /> : page === 'dataset' ? <Dataset key="main" only="main" /> : page === 'habit' ? <Dataset key="habit" only="habit" /> : page === 'calib' ? <Dataset key="calib" only="calib" /> : page === 'care' ? <Care /> : page === 'habit-app' ? <HabitPage /> : <Lock />}
      <HabitWatch />
      <CalibBanner button={page !== 'home'} />
    </div>
  )
}
