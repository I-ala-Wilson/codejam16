// Habit mode state, kept in localStorage so it survives reloads: on/off, snooze, and today's nudges.
const ON = 'echo.habit.on', LOG = 'echo.habit.log', SNOOZE = 'echo.habit.snoozeUntil'
export const habitOn = () => localStorage.getItem(ON) === '1'
export const setHabitOn = (v: boolean) => { localStorage.setItem(ON, v ? '1' : '0'); window.dispatchEvent(new Event('echo-habit')) }
export const snoozedUntil = () => Number(localStorage.getItem(SNOOZE) ?? 0)
export const snooze = (ms: number) => { localStorage.setItem(SNOOZE, String(Date.now() + ms)); window.dispatchEvent(new Event('echo-habit')) }
export const habitLog = (): number[] => { try { return JSON.parse(localStorage.getItem(LOG) ?? '[]') } catch { return [] } }
export const logHabit = (t: number) => {
  const day = new Date(); day.setHours(0, 0, 0, 0)
  localStorage.setItem(LOG, JSON.stringify([...habitLog().filter((x) => x >= day.getTime() - 6 * 864e5), t]))
  window.dispatchEvent(new Event('echo-habit'))
}
export const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return habitLog().filter((x) => x >= d.getTime()) }
