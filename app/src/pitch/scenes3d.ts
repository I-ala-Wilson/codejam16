import * as THREE from 'three'
import { DH, DW, type Scene } from '../hwb/DitherCanvas.tsx'

// 3D versions of the "Why not a camera" tiles: small lit three.js scenes rendered at low resolution, then ordered-
// dithered by DitherCanvas exactly like the flower and the explainer. Labels stay crisp in the overlay.

const INK = '#f2f2f0'
const WHITE = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 })
const GREY = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.6 })
const DARK = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.7 })

type Build = { scene: THREE.Scene; camera: THREE.PerspectiveCamera; update: (t: number) => void; anchors?: Record<string, THREE.Object3D> }
type At = (name: string, dy?: number) => [number, number]

function make3D(build: () => Build, overlay: (g: CanvasRenderingContext2D, at: At) => void): Scene {
  let r: { renderer: THREE.WebGLRenderer; b: Build } | null = null
  return {
    draw(g, t) {
      if (!r) {
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
        renderer.setSize(480, 240, false)
        renderer.setClearColor(0x000000, 1)
        r = { renderer, b: build() }
      }
      r.b.update(t)
      r.renderer.render(r.b.scene, r.b.camera)
      g.drawImage(r.renderer.domElement, 0, 0, DW, DH)
    },
    overlay(g) {
      if (!r) return
      const b = r.b, v = new THREE.Vector3()
      // labels follow the 3D objects: project the anchor into the 640 x 320 design space
      const at: At = (name, dy = 0) => {
        b.anchors![name].getWorldPosition(v).project(b.camera)
        return [(v.x + 1) / 2 * DW, (1 - v.y) / 2 * DH + dy]
      }
      overlay(g, at)
    },
  }
}

function stage(light = 1): Build['scene'] {
  const s = new THREE.Scene()
  s.add(new THREE.AmbientLight(0xffffff, 0.12 * light))
  const key = new THREE.DirectionalLight(0xffffff, 2.4 * light); key.position.set(3, 5, 4); s.add(key)
  const rim = new THREE.DirectionalLight(0xffffff, 0.9 * light); rim.position.set(-4, 2, -3); s.add(rim)
  return s
}

const cam = () => { const c = new THREE.PerspectiveCamera(30, DW / DH, 0.1, 100); c.position.set(0, 1.1, 6.6); c.lookAt(0, 0, 0); return c }

function videoCamera(): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.7), WHITE); g.add(body)
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.5, 28), GREY); lens.rotation.z = Math.PI / 2; lens.position.x = 0.85; g.add(lens)
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.25, 28), DARK); glass.rotation.y = Math.PI / 2; glass.position.x = 1.11; g.add(glass)
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.25, 0.35), GREY); top.position.set(-0.25, 0.52, 0); g.add(top)
  return g
}

function tripod(): THREE.Group {
  const g = new THREE.Group()
  for (let i = 0; i < 3; i++) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.9, 8), GREY)
    const a = (i / 3) * Math.PI * 2
    leg.position.set(Math.cos(a) * 0.35, -0.95, Math.sin(a) * 0.35)
    leg.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35)
    g.add(leg)
  }
  return g
}

function laptop(open = 1.85): THREE.Group {
  const g = new THREE.Group()
  const base = new THREE.Mesh(new THREE.BoxGeometry(2, 0.08, 1.35), WHITE); g.add(base)
  const keys = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.01, 0.75), GREY); keys.position.set(0, 0.045, -0.15); g.add(keys)
  const hinge = new THREE.Group(); hinge.position.set(0, 0.04, -0.67); g.add(hinge)
  const lid = new THREE.Mesh(new THREE.BoxGeometry(2, 1.3, 0.05), WHITE); lid.position.y = 0.65; hinge.add(lid)
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), DARK); screen.position.set(0, 0.65, 0.03); hinge.add(screen)
  hinge.rotation.x = -(open - Math.PI / 2)
  return g
}

/** Expanding sound shells: thin rings that grow outward from a point and fade, like the explainer's waves. */
function shells(n: number, dir: THREE.Vector3): { group: THREE.Group; update: (t: number) => void } {
  const group = new THREE.Group()
  const rings: THREE.Mesh[] = []
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 6, 72), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }))
    m.lookAt(dir)
    group.add(m); rings.push(m)
  }
  return {
    group,
    update(t) {
      rings.forEach((m, i) => {
        const p = (t * 0.55 + i / n) % 1
        m.scale.setScalar(0.2 + p * 1.4)
        ;(m.material as THREE.MeshBasicMaterial).opacity = 1 - p
      })
    },
  }
}

export const costTile3D = make3D(() => {
  const scene = stage(), camera = cam()
  const rig = new THREE.Group(); rig.position.set(-1.9, 0.6, 0)
  const vc = videoCamera(); vc.scale.setScalar(0.9); rig.add(vc); rig.add(tripod()); scene.add(rig)
  const lap = laptop(); lap.position.set(1.9, -1.2, 0); lap.scale.setScalar(1.05); scene.add(lap)
  return {
    scene, camera, anchors: { rig: vc, lap },
    update(t) {
      rig.rotation.y = -0.6 + Math.sin(t * 0.6) * 0.35
      lap.rotation.y = -0.5 + Math.sin(t * 0.6 + 1) * 0.3
    },
  }
}, (g, at) => {
  const [cx, cy] = at('rig'), [lx] = at('lap')
  chip(g, '$$$', cx, cy - 72); chip(g, '$0', lx, 38)
  label(g, 'CAMERA / LIDAR', cx, 312); label(g, 'YOUR LAPTOP', lx, 312)
})

export const privacyTile3D = make3D(() => {
  const scene = stage(), camera = cam()
  const door = new THREE.Group(); door.position.set(-1.9, 0, 0); scene.add(door)
  door.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.9, 0.12), WHITE))
  for (const y of [0.6, -0.6]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.95, 0.04), GREY); p.position.set(0, y, 0.08); door.add(p) }
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.05), DARK); plate.position.set(0, 1.15, 0.1); door.add(plate)
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), GREY); knob.position.set(0.55, -0.05, 0.12); door.add(knob)
  const vc = videoCamera(); vc.scale.setScalar(0.65); vc.position.set(1.9, 0.9, 0); scene.add(vc)
  const lap = laptop(); lap.scale.setScalar(0.75); lap.position.set(1.9, -1.15, 0); scene.add(lap)
  return {
    scene, camera, anchors: { door, vc, lap },
    update(t) {
      door.rotation.y = 0.45 + Math.sin(t * 0.5) * 0.25
      vc.rotation.y = -0.4 + Math.sin(t * 0.7) * 0.4
      lap.rotation.y = -0.4 + Math.sin(t * 0.5 + 1) * 0.25
    },
  }
}, (g, at) => {
  const [dx] = at('door'), [vx, vy] = at('vc'), [lx] = at('lap')
  label(g, 'NO LENS', vx, vy - 52)
  cross(g, vx, vy, 44)
  label(g, 'HOSPITAL BATHROOM', dx, 312); label(g, 'SOUND ONLY', lx, 312)
})

export const darkTile3D = make3D(() => {
  const scene = stage(0.55), camera = cam()
  const moon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 32, 24), WHITE); moon.position.set(-2.7, 1.25, -1); scene.add(moon)
  const moonLight = new THREE.DirectionalLight(0xffffff, 3); moonLight.position.set(-2.7, 1.25, -9); moonLight.target = moon; scene.add(moonLight)
  const vc = videoCamera(); vc.scale.setScalar(0.7); vc.position.set(-1.0, -0.2, 0); scene.add(vc)
  const lap = laptop(); lap.scale.setScalar(0.8); lap.position.set(1.7, -1.2, 0); scene.add(lap)
  const hand = new THREE.Group(); hand.position.set(2.3, 0.9, 0.4); scene.add(hand)
  hand.add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.65, 0.16), WHITE))
  for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.36, 4, 8), WHITE); f.position.set(-0.2 + i * 0.135, 0.56, 0); hand.add(f) }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.28, 4, 8), WHITE); thumb.position.set(0.34, 0.05, 0); thumb.rotation.z = -0.9; hand.add(thumb)
  const s = shells(4, new THREE.Vector3(0, 1.1, 6.6)); s.group.position.set(1.7, -0.3, 0); scene.add(s.group)
  return {
    scene, camera, anchors: { vc, hand, lap },
    update(t) {
      s.update(t)
      hand.position.z = 0.4 + Math.sin(t * 2.2) * 0.35
      hand.rotation.y = -0.4
      vc.rotation.y = -0.5 + Math.sin(t * 0.5) * 0.3
      lap.rotation.y = -0.35
    },
  }
}, (g, at) => {
  const [vx, vy] = at('vc'), [hx, hy] = at('hand'), [lx] = at('lap')
  cross(g, vx, vy, 40)
  label(g, 'CAMERA: BLIND', vx, 312); label(g, 'SONAR: HEARS', lx, 312)
  void hx; void hy
})

function label(g: CanvasRenderingContext2D, s: string, x: number, y: number) {
  g.font = '26px VT323, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = INK; g.fillText(s, x, y)
}
function chip(g: CanvasRenderingContext2D, s: string, x: number, y: number) {
  g.font = '26px VT323, monospace'
  const w = g.measureText(s).width + 14
  g.fillStyle = INK; g.fillRect(x - w / 2, y - 14, w, 28)
  g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y + 0.5)
}
function cross(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.strokeStyle = INK; g.lineWidth = 3
  g.beginPath(); g.moveTo(x - r, y - r * 0.7); g.lineTo(x + r, y + r * 0.7); g.moveTo(x + r, y - r * 0.7); g.lineTo(x - r, y + r * 0.7); g.stroke()
}
