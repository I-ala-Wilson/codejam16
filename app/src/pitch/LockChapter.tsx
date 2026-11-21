import DitherCanvas from '../hwb/DitherCanvas.tsx'
import { lockScene3D, replayLock } from './scenes3d.ts'
import './pitch.css'

// Home pitch chapter: Lock, the Touch Grass and Undo Button challenges. The 3D scene shows the laptop with Chrome's
// net-error page (as extension/veil.js draws it) and the hand-sign unlock; click it to replay.
export default function LockChapter({ go }: { go: (page: string) => void }) {
  return (
    <section id="lock" className="pz pz--chapter" aria-labelledby="pz-lock">
      <div className="pz__tags"><span>Touch Grass</span><span>Undo</span></div>
      <h2 id="pz-lock" className="pz__title">Lock: the site is simply down</h2>
      <div className="pz__split">
        <div>
          <p className="pz__line pz__line--lead">To the child, a blocked site looks like it is simply down, so they put the device away and go outside.</p>
          <p className="pz__line">Parents unlock it with a private sequence of hand gestures. Only two faint dots show progress, so nobody watching learns the code.</p>
          <button className="pz__btn" onClick={() => go('lock')}>Open live demo</button>
        </div>
        <div className="pz__frame pz__replay" onClick={replayLock} title="click to replay">
          <DitherCanvas scene={lockScene3D} label="Over a person's shoulder: the laptop shows This site can't be reached; their hand pushes once and waves once, a dot appears after each sign, and the screen opens to the video site." />
        </div>
      </div>
    </section>
  )
}
