# Echo visual style (owned by the lead; every UI change follows this)

## The one idea
**Ian's reference flower as a 1-bit ordered dither.** The Home hero (`app/src/art/DitherFlower.tsx`) takes the exact shape and density of Ian's reference flower (`app/public/art/flower-ref.png`), smooths it into a grayscale field and **8x8 Bayer ordered-dithers it to off-white on charcoal #1e1f21**, blitted pixel-crisp (one dither pixel = 3 CSS px), full screen. Motion is **only a gentle sway** (the head bends sideways from a fixed stem base, ~6 s cycle); it **never scales, pulses or shimmers**. Hand motion only brightens the petals on that side. **No digit art** (tried twice, rejected by Ian). Other pages keep the black dither style below; `DitherBloom.tsx` is the older procedural bloom.

## Palette
| Token | Value | Use |
|---|---|---|
| `--bg` | `#000000` | page background (pure black, like the dither references) |
| `--bg-deep` | `#0b0b0c` | panels |
| `--ink` | `#f2f2f0` | all text and glyphs (off-white) |
| `--ink-strong` | `#ffffff` | headings, active state, the brightest digits |
| `--rule` | `#f2f2f0` at 1px **dotted** | frames and dividers |
| `--alert` | `#ffffff` on a solid inverted block | alarms (inversion, never red) |

No grey text. Hierarchy comes from **size, density and inversion**, never from dimming text.

## Type
- Display and digit art: **a serif** (Georgia / "Times New Roman" stack, italic for the art). The bloom is set in serif digits, as in the reference.
- UI labels and numbers: **monospace** (`"JetBrains Mono", "SF Mono", Menlo, monospace`), small, letter-spaced 0.04em, often uppercase.
- Body: system sans, 15px, light.
- Lots of empty charcoal space. Content sits centred in a narrow column (max 760px) or around the art.

## The procedural dither bloom (secondary art, app/src/art/DitherBloom.tsx)
- Grayscale field per frame on a 1/3-resolution canvas, then Bayer threshold to 1-bit, upscaled with smoothing off.
- Idle: slow breathing, rim ripples travel, rings drift outward. Hand motion (`energyToward/away`) swells the petals on that side; a fast move (|shiftHz| > 40) pulses the whole flower and brightens the rings.
- 24 fps visible, 10 fps hidden.

## Same dither everywhere
For the waterfall, small icons and backgrounds: draw grayscale, then 8x8 **Bayer ordered dither** to 1-bit off-white-on-charcoal, blit with `image-rendering: pixelated`. The waterfall becomes a white dither field where hand echoes show as bright speckled streaks.

## Components (`ui/`, EJ's lane)
- `Window`: no heavy box. A 1px dotted frame, a mono uppercase title top-left, generous padding, on `--bg-deep`.
- `Button`: mono uppercase text in a 1px dotted outline; hover and active = **inverted** (off-white fill, charcoal text). No shadows, no radius beyond 2px.
- `Banner`: alert = a fully inverted block with large serif text; warn = dotted outline plus serif; ok = plain serif.
- `Rule`: a 1px dotted horizontal line, like the guide lines in the flower reference.
- `Slot` (password slots): a dotted square; filled = an inverted square with a large serif digit or glyph.

## Motion
Slow and quiet: fades in density over 300-600ms, no bounces, no slides. Sound cues stay as they are.

## Do / don't
- Do: charcoal, off-white, serif digits, dotted lines, inversion for emphasis, lots of space.
- Don't: colour (beyond off-white), drop shadows, rounded cards, gradients, emoji, grey text, more than one hero visual per screen.
