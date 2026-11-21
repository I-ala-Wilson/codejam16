import DitherCanvas from '../hwb/DitherCanvas.tsx'
import { costTile, darkTile, privacyTile } from './scenes.ts'
import './pitch.css'

// Home pitch chapter: why gesture sensing should not rely on a camera. Three dithered tiles, one fact each.
const TILES = [
  { name: 'Cost', scene: costTile, alt: 'A camera or lidar rig on a tripod marked $$$ beside an ordinary laptop marked $0.', line: 'Camera and lidar rigs cost money to buy and install. A speaker and a microphone are already in every laptop, at no extra cost.' },
  { name: 'Privacy', scene: privacyTile, alt: 'A restroom door and a crossed-out camera; a laptop sends sound instead.', line: 'Privacy regulators keep cameras out of hospital bathrooms, and patient rooms require consent. Sound carries no image.' },
  { name: 'Darkness', scene: darkTile, alt: 'A moon, a blind camera with a cross, and sound waves that still reach a hand.', line: 'Every camera fails in the dark. Sound works the same with the lights off.' },
]

export default function CameraLimits({ go: _go }: { go: (page: string) => void }) {
  return (
    <section className="pz" aria-labelledby="pz-camera">
      <h2 id="pz-camera" className="pz__title">Why not a camera</h2>
      <div className="pz__cards">
        {TILES.map((t, i) => (
          <figure key={t.name} className="pz__card pz__tile">
            <div className="pz__cardhead"><span className="pz__idx">0{i + 1}</span>{t.name}</div>
            <div className="pz__frame"><DitherCanvas scene={t.scene} label={t.alt} /></div>
            <figcaption className="pz__line">{t.line}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}
