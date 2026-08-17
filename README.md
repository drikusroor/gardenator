# Gardenator

A client-side 3D garden designer built for getting the measurements right.

Draw the beds, walls and paving you are actually planning, at real sizes in
metres and centimetres, walk through the result at your own eye height, watch
the sun move across it through the day, and export a dimensioned plan with a
materials take-off.

Everything runs in the browser. There is no server, no account and no upload —
projects live in your own browser's IndexedDB, and you can export or import a
project as a single JSON file.

## Running it

```bash
npm install
npm run dev      # development server
npm run build    # type check + production build into dist/
npm run preview  # serve the production build
```

Requires Node 20+ and a browser with WebGL 2.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds and publishes `dist/` on every push to
`main`. It needs one setting on the repository, which the workflow cannot do
for itself:

**Settings → Pages → Build and deployment → Source → GitHub Actions.**

The workflow passes `BASE_PATH=/<repo>/` to Vite, so the project site works at
`https://<user>.github.io/<repo>/` without any further configuration. It also
drops a `.nojekyll` file so nothing gets swallowed by Jekyll. You can trigger a
deploy by hand from the Actions tab (`workflow_dispatch`).

## Getting around

### Camera

| Mode | How it works |
| --- | --- |
| **Baan** (orbit) | Left-drag swings the camera round a point on the ground, right-drag slides that point, scroll zooms. |
| **Vliegen** (fly) | `W A S D` to move, `Q`/`E` down and up. Click into the view to look around, `Esc` (or another click) lets go. The scroll wheel changes speed. |
| **Lopen** (walk) | `W A S D` at standing height. Click into the view to look around, `Esc` (or another click) lets go. Eye height is whatever you set under **Omgeving → Ooghoogte** — set it to your own height and the view is what you would really see. |

Fly and walk both look around with the browser's pointer lock, not a
held-down mouse button — click captures the pointer, any mouse or trackpad
movement turns the camera, and `Esc` (the browser's own pointer-lock
shortcut) releases it. That is the same mechanism most browser-based
walkthroughs and games use, and it is far friendlier to a trackpad than
holding a button while dragging.

Preset views (top, isometric, from the house) sit next to the mode buttons, and
`F` frames the current selection.

### Keyboard

| Key | Action |
| --- | --- |
| `G` / `R` / `T` | Move / rotate / scale gizmo |
| `M` | Measure tool |
| `1` / `2` / `3` | Orbit / fly / walk camera |
| `F` | Zoom to selection |
| `Enter` | Finish the shape you are drawing |
| `Esc` | Cancel the current tool and clear the selection |
| `Delete` | Delete the selection |
| `Ctrl/⌘ Z`, `Ctrl/⌘ ⇧ Z` | Undo, redo |
| `Ctrl/⌘ D` | Duplicate |
| `Ctrl/⌘ S` | Save |

Select an object and you get the Blender-style red/green/blue axis gizmo plus a
glowing outline. Shapes (surfaces, walls, fences, paths, light runs) also get
per-vertex handles: drag a yellow ball to move a corner, click a green
diamond on an edge to add one (handy for shaping a curve). Shift-click a
yellow ball, or hover it and press `Delete`/`Backspace`, to remove that
corner again. Every edge shows its length while you drag, and while you draw.

## What you can build

- **Vlakken** — lawn, tiles, gravel, bark, decking, bare soil, concrete, water.
  A surface can be raised to make a bed, and given a retaining wall of
  stapelblokken around any subset of its edges.
- **Bestrating** — real per-tile layout in blokverband, halfsteens, visgraat
  (herringbone), mandweefsel (basketweave) or stacked, at any tile size, joint
  width, colour and pattern angle. The app counts the tiles for you.
- **Muren** — laid block by block from a spec you control (length × height ×
  depth, joint, bond offset, texture), with an optional coping stone. The
  inspector reports how many blocks the wall takes and how many of them have to
  be cut.
- **Schuttingen** — horizontal slats, vertical pickets, solid panels, trellis or
  wire, with configurable post spacing and thickness.
- **Paden** — straight or smooth curves through control points, laid as a
  continuous band or as stepping stones.
- **Beplanting** — trees (including a pear tree), shrubs, perennials and
  bedding, each with its own height and spread in metres, singly or in clumps,
  in the ground or in a pot.
- **Bouwwerken** — a shed in brick or wood with a real door and window opening
  and a mono-pitch, gable or flat roof; a stretch of house wall so you can see
  where the garden begins; a pergola; planters.
- **Meubels** — dining and coffee tables, chairs, benches, loungers, a parasol,
  barbecue, fire pit.
- **Verlichting** — ground spots, post lamps, wall lights, lanterns, and
  festoon runs that hang in a sag between anchor points with individually
  coloured bulbs.
- **Referentiepersoon** — a figure at exactly the height you set. The
  soda-can-in-the-photo trick, for judging whether that terrace is really big
  enough.

## Sun, shadows and night

The sun is placed from real solar geometry: day of year, solar time and
latitude give its elevation and azimuth, which are then rotated into the scene
by the site's north offset. Set the north direction and your latitude under
**Omgeving** and the shadow falling across the terrace at 17:00 in June is
where it will actually fall.

Light colour and intensity follow the sun's elevation, so you get the warm
low-angle light near sunrise and sunset and neutral light at midday. Press
**Speel dag af** to watch the shadows sweep across the garden. After sunset the
garden lights come on by themselves, and you can look at the whole thing at
night with the festoon lights lit.

## Measurements and output

- Type any length in whatever form is natural: `240`, `2,4 m`, `2m40`, `1500mm`.
  Arrow keys nudge, shift-arrow nudges by ten.
- Snapping is configurable from 1 cm up to 1 m, or off.
- The measure tool (`M`) drops a permanent dimension between two points — it
  stays in the scene like everything else, so it also works as a ruler line
  for scaffolding out a layout before you build it. Select it afterwards and
  it gets the same vertex handles as any other shape: drag its ends to
  reposition it, or click the green diamond on a span to bend it into a
  multi-point reference line, with each span and the running total labelled.
- **Plattegrond** produces a dimensioned scale drawing as SVG or PNG: outlines
  of everything, the actual paving setting-out, edge dimensions, north arrow,
  scale bar, legend and a materials take-off (m² per ground type, tiles per
  specification, blocks per wall, running metres of fence).
- **Foto** saves the current 3D view as a 2400×1500 PNG. Switch to the
  isometric preset first for a drawing-style overview with the dimension
  labels on it.
- The square/prism buttons next to the camera modes switch between the
  normal WebGL view and **ray tracing (bèta)** — a GPU path tracer with real
  soft shadows and bounced light, built for this app rather than vendored
  from a library (see `src/render/raytrace/`). It converges over a second or
  two once the camera stops moving, and resets on every orbit/pan/zoom, so
  it is meant for looking and for **Foto** (which renders it at a higher,
  fixed sample count) rather than for editing. Full per-pixel path tracing
  is too slow to redraw every frame of a drag, so while the camera is
  actively moving it renders at reduced resolution and bounce count to stay
  responsive, then sharpens back up over the next few frames once it stops
  — orbiting/flying should never feel frozen, just softer while in motion.
  Materials are flattened to a colour + emissive per triangle, so it is not
  pixel-for-pixel identical to the rasterised view — texture detail and true
  reflections/refraction (glass, water) are not modelled.

## How it is put together

```
src/
  core/       document model, units, geometry, undo/redo store, storage, plan export
  render/     three.js viewer, cameras, sun/sky, editing gadgets, procedural textures
    build/    one module per object type, turning document objects into geometry
  ui/         panels, controls, toolbar, app shell
```

A few decisions worth knowing about:

**Metres everywhere.** The document stores metres and nothing else. Conversion
to centimetres happens only in the input controls, which is why a measurement
can never quietly drift by a factor of a hundred.

**Real geometry over textures.** Walls are built block by block and paving tile
by tile, rather than faked with a repeating texture. It costs a little
performance and buys the thing the app exists for: knowing how many blocks a
wall takes and whether a whole tile lands against the shed.

**No asset files.** Every texture is painted onto a canvas at load time. The
whole app is one static bundle with no image requests, which is what makes the
Pages deploy trivial and lets colours be parameters rather than baked pixels.

**Snapshot undo.** A garden document is small enough that cloning it per edit is
cheaper than maintaining a diff, and it cannot fall out of sync. Drags are
coalesced into a single undo step.

### About WebAssembly

You asked whether WebAssembly would help. Having built it: no, and adding it
would make the project harder to maintain for no gain. The heavy work here is
GPU-side (shading, shadow mapping, overdraw from the grass billboards), and
WebAssembly does not touch that. The CPU-side work — laying out tiles and
blocks, sampling splines, scattering tufts — runs only when an object changes,
takes single-digit milliseconds for a whole garden, and is dominated by
allocation rather than arithmetic, which is exactly the case where the
JS↔wasm boundary gives back whatever it saves.

The performance work that does matter is already in: `InstancedMesh` for every
repeated element (a lawn is one draw call for thousands of tufts, a terrace one
for hundreds of tiles), shared cached materials and textures so nothing is
rebuilt per object, per-object dirty checking so only what changed is rebuilt,
a shadow frustum fitted to the plot, and a **Detailniveau** setting that scales
scatter density. If a garden ever does get heavy enough to need more, the right
next step is a worker, not wasm.

## Known limits

- Paving is clipped by unit centre, so the border strip where whole tiles do
  not fit is drawn in the joint colour rather than as individually cut tiles.
  Counts are for whole tiles; add your usual cutting allowance.
- Herringbone is exact for the usual 2:1 paver; other ratios still interlock
  but leave a small regular gap.
- Surfaces are simple polygons without holes — model a bed inside a lawn as an
  L-shaped or C-shaped lawn (the sample garden does this).
- Terrain is flat. Height differences are modelled as raised surfaces, not as
  slopes.
- Ray tracing mode gives every triangle a flat diffuse colour (sampled from
  its rasterised texture) plus emissive for lit bulbs — no texture detail,
  metal/glass reflection or refraction, and alpha-cutout foliage/grass
  billboards render as solid shapes instead of cut-out leaves. It also
  rebuilds its whole triangle+BVH buffer from the scene on every edit while
  active, which is fine for a static "look" but not for fast iteration.
