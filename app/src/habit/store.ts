// Habit mode state, kept in localStorage so it survives reloads: on/off, snooze, the nudge log (7 days),
// when watching started today, and the last hour the bottom bar was shown.
const ON = 'echo.habit.on', LOG = 'echo.habit.log', SNOOZE = 'echo.habit.snoozeUntil'
const STARTED = 'echo.habit.startedAt', BAR = 'echo.habit.barHour'
const DAY_MS = 864e5

const ping = () => window.dispatchEvent(new Event('echo-habit'))
const midnight = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode: state lives for this page only */ } }

export const habitOn = () => read(ON) === '1'
export const setHabitOn = (v: boolean) => {
  write(ON, v ? '1' : '0')
  if (v && Number(read(STARTED) ?? 0) < midnight()) write(STARTED, String(Date.now()))
  ping()
}
export const snoozedUntil = () => Number(read(SNOOZE) ?? 0)
export const snooze = (ms: number) => { write(SNOOZE, String(Date.now() + ms)); ping() }
export const cancelSnooze = () => { write(SNOOZE, '0'); ping() }

export const habitLog = (): number[] => { try { return JSON.parse(read(LOG) ?? '[]') } catch { return [] } }
export const logHabit = (t: number) => {
  write(LOG, JSON.stringify([...habitLog().filter((x) => x >= midnight() - 6 * DAY_MS), t]))
  ping()
}
export const today = () => habitLog().filter((x) => x >= midnight())

/** Nudges per hour today, 24 values. */
export const hourCounts = () => {
  const h = Array<number>(24).fill(0)
  for (const t of today()) h[new Date(t).getHours()]++
  return h
}

/** The last 7 days, oldest first, today last. */
export const lastWeek = () => {
  const log = habitLog()
  return Array.from({ length: 7 }, (_, i) => {
    const start = midnight() - (6 - i) * DAY_MS
    return { day: new Date(start), count: log.filter((t) => t >= start && t < start + DAY_MS).length }
  })
}

/** Longest stretch today with no nudge, in ms, counted from when watching started today (or midnight). */
export const longestCalm = () => {
  const start = Math.max(midnight(), Number(read(STARTED) ?? 0))
  if (start < midnight() || !read(STARTED)) return 0
  const stops = [start, ...today().filter((t) => t >= start), Date.now()]
  let best = 0
  for (let i = 1; i < stops.length; i++) best = Math.max(best, stops[i] - stops[i - 1])
  return best
}

/** True the first time it is called in each clock hour: the bottom bar shows once an hour. */
export const firstNudgeThisHour = () => {
  const d = new Date(), key = `${d.toDateString()} ${d.getHours()}`
  if (read(BAR) === key) return false
  write(BAR, key)
  return true
}
