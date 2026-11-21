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
    renderer.setSize(480, 240, false)
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
  // the universal no-cameras sign: one large camera, turning, inside a prohibition circle
  const scene = stage(), camera = cam()
  const vc = videoCamera(); vc.scale.setScalar(1.25); vc.position.set(-0.3, 0.05, 0); scene.add(vc)
  return {
    scene, camera, anchors: { vc },
    update(t) { vc.rotation.y = -0.5 + Math.sin(t * 0.6) * 0.6 },
  }
}, (g) => {
  noSign(g, DW / 2, 150, 118)
  label(g, 'NOT ALLOWED IN BATHROOMS', DW / 2, 300)
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
}, (g, at) => {
  const [lx] = at('lap')
  label(g, 'LIGHTS OFF, STILL LISTENING', lx, 312)
}, (g, at, t) => {
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
  g.strokeStyle = INK; g.lineWidth = 9
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke()
  const a = Math.PI / 4
  g.beginPath(); g.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.stroke()
}
