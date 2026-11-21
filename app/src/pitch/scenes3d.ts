import * as THREE from 'three'
import { DH, DW, type Scene } from '../hwb/DitherCanvas.tsx'

// 3D versions of the "Why not a camera" tiles: small lit three.js scenes rendered at low resolution, then ordered-
// dithered by DitherCanvas exactly like the flower and the explainer. Labels stay crisp in the overlay.

const INK = '#f2f2f0'
const WHITE = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 })
const GREY = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.6 })
const DARK = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.7 })
const SCREEN = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x6a6a6a, roughness: 0.3 })

type Build = { scene: THREE.Scene; camera: THREE.PerspectiveCamera; update: (t: number) => void; anchors?: Record<string, THREE.Object3D> }
type At = (name: string, dy?: number) => [number, number]

// ONE WebGL context for every tile: each draw renders and is copied out immediately, so the tiles take turns.
// Separate contexts (plus dev hot reloads) pushed Chrome past its context limit and it killed the 3D explainer.
let renderer: THREE.WebGLRenderer | null = null
function shared(): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
    renderer.setSize(640, 320, false)
    renderer.setClearColor(0x000000, 1)
  }
  return renderer
}
if (import.meta.hot) import.meta.hot.dispose(() => { renderer?.dispose(); renderer?.forceContextLoss(); renderer = null })

function make3D(
  build: () => Build,
  overlay: (g: CanvasRenderingContext2D, at: At) => void,
  paint?: (g: CanvasRenderingContext2D, at: At, t: number) => void,
): Scene {
  let r: { b: Build } | null = null
  const v = new THREE.Vector3()
  // anchors are projected into DitherCanvas's 640 x 320 design space, so 2D marks follow the 3D objects
  const at: At = (name, dy = 0) => {
    r!.b.anchors![name].getWorldPosition(v).project(r!.b.camera)
    return [(v.x + 1) / 2 * DW, (1 - v.y) / 2 * DH + dy]
  }
  return {
    draw(g, t) {
      if (!r) r = { b: build() }
      const renderer = shared()
      r.b.update(t)
      renderer.render(r.b.scene, r.b.camera)
      g.drawImage(renderer.domElement, 0, 0, DW, DH)
      paint?.(g, at, t)
    },
    overlay(g) {
      if (!r) return
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

const cam = () => { const c = new THREE.PerspectiveCamera(30, DW / DH, 0.1, 100); c.position.set(0, 1.1, 7.6); c.lookAt(0, -0.1, 0); return c }

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
  const L = 1.9, spread = 0.75
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5
    const top = new THREE.Vector3(0, -0.4, 0), foot = new THREE.Vector3(Math.cos(a) * spread, -0.4 - L, Math.sin(a) * spread)
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, top.distanceTo(foot), 8), GREY)
    leg.position.copy(top).add(foot).multiplyScalar(0.5)
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize())
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
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), SCREEN); screen.position.set(0, 0.65, 0.03); hinge.add(screen)
  hinge.rotation.x = -(open - Math.PI / 2)
  return g
}

export const costTile3D = make3D(() => {
  const scene = stage(), camera = cam()
  const rig = new THREE.Group(); rig.position.set(-1.9, 0.6, 0)
  const vc = videoCamera(); vc.scale.setScalar(0.9); rig.add(vc); rig.add(tripod()); scene.add(rig)
  const lap = laptop(); lap.position.set(1.9, -1.2, 0); lap.scale.setScalar(1.05); scene.add(lap)
  const lid = new THREE.Object3D(); lid.position.set(0, 1.35, -0.85); lap.add(lid) // top centre of the screen
  return {
    scene, camera, anchors: { rig: vc, lap, lid },
    update(t) {
      rig.rotation.y = -0.6 + Math.sin(t * 0.35) * 0.25
      lap.rotation.y = -0.5 + Math.sin(t * 0.35 + 1) * 0.2
    },
  }
}, (g, at) => {
  // prices stay crisp on top of the dither so they read at a glance
  const [cx, cy] = at('rig'), [lx, ly] = at('lid')
  price(g, '$$$', cx, cy - 78); price(g, '$0', lx, ly - 28)
})

export const privacyTile3D = make3D(() => {
  // the universal no-cameras sign: one large camera, turning, inside a prohibition circle
  const scene = stage(), camera = cam()
  const vc = videoCamera(); vc.scale.setScalar(1.25); vc.position.set(-0.3, 0.05, 0); scene.add(vc)
  return {
    scene, camera, anchors: { vc },
    update(t) { vc.rotation.y = -0.5 + Math.sin(t * 0.35) * 0.45 },
  }
}, () => {}, (g) => {
  noSign(g, DW / 2, 160, 118)
})

export const darkTile3D = make3D(() => {
  // a dark room: the laptop is lit only by its own screen and a faint key light; the sound is the brightest thing
  const scene = stage(0.6), camera = cam()
  const lap = laptop(); lap.scale.setScalar(1.15); lap.position.set(0.55, -1.05, 0); scene.add(lap)
  const glow = new THREE.PointLight(0xffffff, 6, 4); glow.position.set(0.55, -0.2, 0.9); scene.add(glow)
  const screen = new THREE.Object3D(); screen.position.set(0, 0.75, -0.55); lap.add(screen)
  return {
    scene, camera, anchors: { lap, screen },
    update(t) { lap.rotation.y = -0.75 + Math.sin(t * 0.4) * 0.18 },
  }
}, () => {}, (g, at, t) => {
  softMoon(g, 120, 78, 34)
  // sound leaving the screen: thin arcs fanning toward the viewer, fading as they travel, like the flower's waves
  const [sx, sy] = at('screen')
  g.lineCap = 'round'
  for (let i = 0; i < 4; i++) {
    const p = (t * 0.45 + i / 4) % 1
    const rad = 30 + p * 150
    const a = 1 - p
    g.strokeStyle = `rgba(255,255,255,${(a * a * 0.9).toFixed(3)})`
    g.lineWidth = 2.2
    g.beginPath(); g.arc(sx, sy, rad, Math.PI * 1.08, Math.PI * 1.92); g.stroke()
  }
})

function price(g: CanvasRenderingContext2D, s: string, x: number, y: number) {
  g.font = '40px VT323, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = INK; g.fillText(s, x, y)
}
function label(g: CanvasRenderingContext2D, s: string, x: number, y: number) {
  g.font = '26px VT323, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = INK; g.fillText(s, x, y)
}
function chip(g: CanvasRenderingContext2D, s: string, x: number, y: number) {
  g.font = '26px VT323, monospace'
  const w = g.measureText(s).width + 14
  g.fillStyle = INK; g.fillRect(x - w / 2, y - 14, w, 28)
  g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y + 0.5)
}
function softMoon(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const halo = g.createRadialGradient(x, y, r * 0.6, x, y, r * 2.4)
  halo.addColorStop(0, 'rgba(255,255,255,0.22)'); halo.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = halo; g.beginPath(); g.arc(x, y, r * 2.4, 0, Math.PI * 2); g.fill()
  const body = g.createRadialGradient(x - r * 0.35, y - r * 0.3, r * 0.1, x, y, r)
  body.addColorStop(0, '#ffffff'); body.addColorStop(1, '#9a9a9a')
  g.fillStyle = body; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
  const shade = g.createRadialGradient(x + r * 0.5, y - r * 0.2, r * 0.6, x + r * 0.5, y - r * 0.2, r * 1.05)
  shade.addColorStop(0, '#000000'); shade.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = shade; g.beginPath(); g.arc(x + r * 0.5, y - r * 0.2, r * 1.05, 0, Math.PI * 2); g.fill()
}
function noSign(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 12
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke()
  const a = Math.PI / 4
  g.beginPath(); g.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.stroke()
}

// ---------- Care: a hospital bed in 3/4 view, a waving hand, the bedside laptop and the caregiver's phone ----------
const CARE_PERIOD = 3.2 // s per call: arcs travel for the first half, the phone shows HELP for the second
const careLit = (t: number) => (t % CARE_PERIOD) > CARE_PERIOD * 0.5
let careT = 0 // the scene clock, shared with the overlay (which gets no time argument)
const PHONE_GLOW = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x000000, roughness: 0.3 })

export const careScene3D = make3D(() => {
  const scene = stage(), camera = new THREE.PerspectiveCamera(30, DW / DH, 0.1, 100)
  camera.position.set(2.5, 2.7, 6.3); camera.lookAt(0.55, -0.35, 0)
  // bed: frame, mattress, pillow, blanket over the patient, head on the pillow
  const bed = new THREE.Group(); bed.position.set(-1.3, -1.2, 0); scene.add(bed)
  const frame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.25, 1.6), GREY); frame.position.y = 0.2; bed.add(frame)
  for (const [x, z] of [[-1.7, -0.7], [1.7, -0.7], [-1.7, 0.7], [1.7, 0.7]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), GREY); leg.position.set(x, -0.15, z); bed.add(leg)
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 1.6), GREY); head.position.set(-1.8, 0.75, 0); bed.add(head)
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.3, 1.5), WHITE); mattress.position.y = 0.47; bed.add(mattress)
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 1.0), WHITE); pillow.position.set(-1.35, 0.72, 0); bed.add(pillow)
  const person = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16), GREY); person.position.set(-1.25, 0.98, 0); bed.add(person)
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.28, 1.45), GREY); blanket.position.set(0.35, 0.75, 0); bed.add(blanket)
  // forearm raised out of the blanket, hand at the top, pivoting at the elbow for a gentle wave
  const elbow = new THREE.Group(); elbow.position.set(-0.3, 0.88, 0.45); bed.add(elbow)
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.1, 12), WHITE); arm.position.y = 0.55; elbow.add(arm)
  const hand = new THREE.Group(); hand.position.y = 1.18; elbow.add(hand)
  hand.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.1), WHITE))
  for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.28, 0.08), WHITE); f.position.set(-0.12 + i * 0.08, 0.31, 0); hand.add(f) }
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.08), WHITE); thumb.position.set(0.21, 0.02, 0); thumb.rotation.z = -0.6; hand.add(thumb)
  // bedside table with the laptop
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 0.9), DARK); table.position.set(1.35, -1.0, 0.2); scene.add(table)
  const lap = laptop(); lap.scale.setScalar(0.42); lap.position.set(1.35, -0.48, 0.2); lap.rotation.y = -0.9; scene.add(lap)
  const lapScreen = new THREE.Object3D(); lapScreen.position.set(0, 0.7, -0.6); lap.add(lapScreen)
  // caregiver phone, standing on the right, screen lights when the call arrives
  const phone = new THREE.Group(); phone.position.set(3.25, -0.2, 0.6); phone.rotation.y = -0.45; scene.add(phone)
  phone.add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.2, 0.08), DARK))
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 1.02), PHONE_GLOW); glass.position.z = 0.045; phone.add(glass)
  return {
    scene, camera, anchors: { hand, lapScreen, glass, phone },
    update(t) {
      careT = t
      elbow.rotation.z = Math.sin(t * 4.2) * 0.32
      PHONE_GLOW.emissive.setScalar(careLit(t) ? 0.95 : 0.05)
    },
  }
}, (g, at) => {
  const [px, py] = at('glass'), [qx, qy] = at('phone', 46)
  if (careLit(careT)) chip(g, 'HELP', px, py)
  label(g, 'CAREGIVER', qx, qy + 16)
}, (g, at, t) => {
  // thin flower-style arcs leaving the hand toward the laptop, fading as they travel; none while the phone shows HELP
  const [hx, hy] = at('hand'), [lx, ly] = at('lapScreen')
  const dir = Math.atan2(ly - hy, lx - hx), d = Math.hypot(lx - hx, ly - hy)
  const p0 = (t % CARE_PERIOD) / (CARE_PERIOD * 0.5)
  g.lineCap = 'round'
  for (let i = 0; i < 3; i++) {
    const p = p0 - i * 0.18
    if (p < 0 || p > 1) continue
    const a = 1 - p
    g.strokeStyle = `rgba(255,255,255,${(0.35 + a * 0.6).toFixed(3)})`
    g.lineWidth = 2.2
    g.beginPath(); g.arc(hx, hy, 14 + p * (d - 14), dir - 0.42, dir + 0.42); g.stroke()
  }
})
