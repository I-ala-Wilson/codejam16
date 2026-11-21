# Echo visual style (owned by the lead; every UI change follows this)

## The one idea
**Sound drawn out of numbers.** The hero art is a living "sonar bloom": a flower whose petals are the echo of your hand, built entirely from streams of digits, white on charcoal. It is directly modelled on Ian's reference: a dandelion/chrysanthemum head made of dense, overlapping serif digits (`…5972816340…`) on a dark grey background, with a single thin stem of small digits running down.

## Palette
| Token | Value | Use |
|---|---|---|
| `--bg` | `#1e1f21` | page background (charcoal, not pure black) |
| `--bg-deep` | `#141516` | panels, the canvas behind the bloom |
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

## The digit bloom (primary art)
1. Draw a hidden grayscale **mask** (0..1) of the shape on an offscreen canvas: petals = radial lobes around a centre, each lobe's length driven by the echo (see Data below), plus a vertical stem line.
2. Fill the mask with **rows of digits** that flow along the petals: walk short polylines that follow each petal's angle, and at each step print the next digit of a repeating string (`5972816340`, rotated per row).
3. Each glyph's **size and opacity come from the mask brightness** at that spot: bright core = large (14-22px), tight, overlapping digits; edges = small (5-8px), sparse digits that scatter and fade into the background. Never draw a glyph where the mask is under ~0.08.
4. The stem is a single column of 6-9px digits, straight down from the bloom to the bottom of the canvas.
5. Render with canvas 2D `fillText` (cache font settings, batch by size). Budget about 4-8k glyphs at 30 fps on a MacBook Air; drop to 15 fps when the tab is hidden.

### Data (what makes it alive)
- Idle: petals breathe slowly (a 6-second sine on petal length), digits drift along their rows.
- Hand motion (`SpectrumFrame.energyToward/away`, `shiftHz`): petals on the "toward" side swell and brighten, "away" petals contract; a fast move sends a ripple of brighter digits outward from the centre.
- A detected gesture (`GestureEvent`) flashes its name in mono under the bloom for 1.2 s.

## Secondary: 1-bit dither
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
