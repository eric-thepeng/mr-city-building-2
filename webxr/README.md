# Mars Homecoming (MR City Building) — WebXR

A browser port of the Unity game on `main`, built with [three.js](https://threejs.org) and WebXR.
**Live: <https://mars.pengguo.net>**

The site opens on a landing page with **Enter AR** and **Enter VR** (and a link to play in the
browser with a mouse).

It targets **Snap Specs** (AR, hands only) and **Meta Quest** (AR passthrough or VR, with hands or
controllers). It also runs on desktop with a mouse. No build step and no install: it is plain ES modules,
and three.js loads from a CDN.

## Devices

| Device | Mode | Input |
|--------|------|-------|
| Snap Specs | *Enter AR* (`immersive-ar`) | Hands: pinch near a building to carry it, or pinch while pointing to pull it along the ray |
| Quest | *Enter AR* (passthrough) or *Enter VR* | Hands as above, or controllers (trigger/grip, thumbstick pushes/pulls) |
| Desktop | – | Mouse |

Notes for Specs, from Snap's WebXR guidance:
- All session features are optional. If the runtime has no `local-floor`, the game uses `local` and
  lifts the player rig to an assumed 1.55 m eye height.
- Pinches are detected from the thumb-tip and index-tip joint distance, the same way Snap's samples do it.
  The game doesn't depend on `select` events.
- Antialiasing is off on Specs, because fill rate is the limit. The profile is picked from the user agent;
  add `?specs` to force it on.
- In AR, the sky, fog and virtual hand meshes are hidden.
- Glass (the Farm's dome) is frosted and drawn on both sides; Unity's 6%-opaque glass looked like a missing lid.
- Buildings use lit materials plus part of their texture as glow. Dark colours look see-through on
  Specs' display, and the earlier toon shading rendered black there.

### The sandbox

The Unity game surrounded the player with a large landscape. Here it is a **sandbox in front of you**:
- **Layout:** the area of the Unity landscape that holds the 36 ore and gas nodes, squeezed into a
  **61 × 56 cm** board with the hills flattened.
- **Scale:** everything on the board, buildings included, is shown at **half** the Unity size
  (`BOARD_SCALE` in `src/game.js`).
- **Placement:** when you enter AR or VR, the board appears about 0.75 m ahead and 0.45 m below your eyes,
  facing you. **Recenter** (under the budget sign) moves it in front of you again; **New game** restarts.
- **Hand:** the buildings in your hand wait along the near edge of the board.

### Going up: cliffs, clouds and crystal veins

The board has height to play with, so building high can pay off:
- **Terrain:** two mesas along the far edge (20 cm tall at board scale), a canyon between them, a ledge
  on the far left and a rock pillar in the valley. Their walls are too steep to build on.
- **Crystal veins** stick out of the walls (9 of them). The **Cliff Drill** earns +9 next to one.
- **Ice clouds** float above the board (6). The **Weather Station** earns +10 near one and uses it up: the
  cloud is pulled into the station, and a see-through outline marks where it forms again, with a
  countdown ("Cloud forms here in 3 builds"). The **Wind Turbine** earns +5 near
  a cloud and does not use it up.
- **Height:** the Wind Turbine earns +1 for every 2.5 cm it stands above the valley floor.
- **Sky Platform:** a tall, cheap stand with one beam. Other buildings can be built on top of it, which is
  the cheap way to reach clouds and high veins.
- **Beam cost** is per building (`beamCost`, money per game unit): 100 by default, 20 for the Sky
  Platform, 40 for the Cliff Drill and 60 for the Wind Turbine.

The new buildings use models from the same low-poly space kit as the Unity buildings. Veins and clouds
are made in `tools/bake.js`, and the rock bands on the cliff faces are drawn by the terrain shader
(`addRockStrata` in `src/assets.js`). Shapes and positions are set in `cliffHeight`, `VEINS` and `CLOUDS` in
`tools/bake.js`.

### Hands, milestones and packs

The first hand of a game is random. When a hand is used up, the sign above the budget shows **two hand
cards** (the buildings turning on top, and what is in the hand); pinch, point at or click one to deal it.

**Score** counts every point placements earned or lost; it is separate from the budget. At score
milestones (20, 50, 90, 140, 200, then every 80) a **random** locked building pack joins the deck, and a
green card shows what it adds: what each new building scores, the bonuses it gives existing buildings,
and the pack's hands (text generated from the data in `Progress.describe`; tap the card to close it). The
new pack's first hand is one of the two choices at the next pick. Once all three packs (Highlander,
Skywatch, Cliffside) are in, a milestone pays +30 budget instead. Add **`?unlock`** to the address to
start with every pack.

**Game over:** when the budget drops below 0 (neighbours can cost money), the sign says so and the
remaining buildings can't be picked up; **New game** starts again.

**Support beams** stand on the ground, on resource nodes, or on the top of a building made for it
(`"standOn": true` in `expansion.json`; only the Sky Platform today). A beam that lands on any other
building shows "can't stand on …".

**Resource nodes** show a tooltip when the mouse or an XR ray points at them: what they are and which
buildings earn next to them (and whether those are unlocked yet). Gas vents puff: a few clouds sway around
the vent and others rise into the air (all puffs are one instanced mesh).

Placing a building gives a small squash-and-stretch and a dust ring.

Buildings, scoring, packs, milestones and hand presets that are not in Unity live in **`data/expansion.json`**, which is merged
into the exported `data/game-data.json` at load time (`src/expansion.js`).

To change the board's size or flatness, edit `SANDBOX` in `tools/bake.js` and bake again.
Its placement in front of you is set by `BOARD_DISTANCE` / `BOARD_BELOW_EYES` in `src/main.js`.

### Memory and performance budget (Specs)

Specs stops apps that use too much memory ("App Stopped: high memory used"), so the game is kept small:

| | First version | Now |
|---|---|---|
| Models | 33 FBX files parsed on the device | one pre-baked `data/world.glb` (1.1 MB) |
| Terrain | 57 Unity pieces, 133k triangles, kept twice | one sandbox mesh, 5.8k triangles |
| Support-beam ground test | raycast against the terrain mesh | O(1) lookup in `data/board.json` |
| Resource nodes | 36 separate models | merged into one mesh per material |
| Textures | two 1024² atlases | two 256² atlases |
| Labels | 119 canvases + textures (5.4 MPx), a new texture whenever the text changes | one shared canvas; each label is only a small texture, made on first use, no mipmaps |
| Red "can't build" model | a second copy of every building | made only when first needed |
| Hand / controller meshes | downloaded from a CDN | not loaded on Specs (the code isn't even fetched) |
| XR resolution | 100% | 60% on Specs (`?fb=1` overrides) |
| Page canvas during XR | three.js resizes it to the full XR frame size, so the frame memory is held twice | shrunk to 1×1 while presenting |
| Sky and fog | switched off when AR starts, which compiles every shader a second time | never created on Specs |
| three.js | unminified build (1.3 MB of source) | minified build |

Measured in desktop Chrome: 27 draw calls (was 84), geometry 13.1 MB → under 1 MB, JS heap 38 MB → 10 MB.
The pointer, grab-rotation and support-beam code no longer creates garbage every frame (GC pauses cause stutter).

**Smoothness.** three.js reads hand joints with one `getJointPose()` per joint (50 calls, each returning new
objects, every frame). `src/xr-perf.js` answers those calls from one batched `fillPoses()` per hand, which is
what fixed stutter on Spectacles for Babylon.js. The XR camera is also updated before labels and the budget
sign turn towards it, so they no longer lag a frame behind the head.

Add **`?fps`** to the address to show the frame rate and the slowest frame of each second above the budget sign.

## Run it

```bash
python -m http.server 8123 --directory webxr
```

Then open <http://localhost:8123>.

- **Desktop:** left-drag buildings with the mouse. A dragged building snaps onto the ground; wheel up lifts
  it (no limit, but taller beams cost more), wheel down brings it back to the ground. Z/X rotates it. The
  camera works like the Unity Scene view (`src/camera-controls.js`): right-drag looks around, W A S D or the
  arrow keys fly, Q/E go down / up, Shift is faster, the wheel moves forward / back, middle-drag pans.
- **No headset?** Open <http://localhost:8123/?emulate>. This installs Meta's
  [Immersive Web Emulation Runtime](https://github.com/meta-quest/immersive-web-emulation-runtime),
  an emulated Quest 3, so you can use *Enter VR* / *Enter AR* in a normal browser. Drive it from the
  console through `window.__xrDevice`. Add `&specs` to try the Specs profile.
- **On a device:** WebXR needs HTTPS. Open <https://mars.pengguo.net>. On Specs, open the Browser from
  Lens Explorer. For local builds on a Quest, you can also run `adb reverse tcp:8123 tcp:8123` and open
  `http://localhost:8123`.

## Deploy

The site is a Cloudflare Worker that serves `webxr/` as static assets on the custom domain
`mars.pengguo.net`. See [`wrangler.jsonc`](../wrangler.jsonc) at the repo root. From the repo root:

```bash
npx wrangler deploy
```

`webxr/.assetsignore` keeps `tools/`, the FBX sources in `assets/`, and this README off the site.

## How it maps to the Unity project

| Unity (`Assets/Scripts`)                          | WebXR (`webxr/src`)                                        |
|---------------------------------------------------|------------------------------------------------------------|
| `BuildingBase.cs`                                 | `Building` in `game.js`: states, cost, release / reset     |
| `SupportBeam.cs`                                  | `Building.calculateSupportBeam` (heightfield + short ray per beam) |
| `ScoringIdentifier.cs`                            | `Building.calculateScoring` / `sendAndAddScore`            |
| `HandManager.cs` + `SO_HandPreset`                | `HandManager` in `game.js`                                 |
| `MoneyManager.cs`                                 | `MoneyManager` in `game.js` (starting budget 100)          |
| `SO_BuildingIdentifier`                           | `buildingInfo` in `data/game-data.json`                    |
| XR Interaction Toolkit (grab / ray / hover)       | `XRInput` in `input.js` (controllers + hand tracking)      |
| TextMeshPro world UI                              | canvas labels in `ui.js`                                   |
| `Environment.prefab` (terrain + resource nodes)   | `environment` in `data/game-data.json`                     |

The data is **exported from the Unity assets**, not hand-copied. If you change a prefab, a
ScriptableObject, or the environment in Unity, regenerate it in two steps:

```bash
python webxr/tools/export_game_data.py
```

This reads the prefab/scene YAML (`tools/unity_yaml.py`) and the Odin-serialized scoring tables and
hand presets, and converts Unity's left-handed transforms to three.js. It writes `data/game-data.json`,
copies the FBX sources into `assets/`, and writes 256 px textures to `data/textures/`.

```bash
python webxr/tools/bake_server.py
```

Then open <http://localhost:8124/tools/bake.html>. (`/tools/preview.html?m=dome,lander_A` shows models from the
space kit side by side.) The page loads the FBX files once and writes
`data/world.glb` (all building and resource models, and the sandbox terrain) and `data/board.json`
(the sandbox heightfield and where the resource nodes sit on it).
To change the sandbox, edit `SANDBOX` at the top of `tools/bake.js` and bake again.

## Differences from the Unity build

- **Resource nodes score.** In Unity, `BuildingBase.Start()` sets `canScore = false` on every
  node, including ore and gas resource nodes. That is why the commit says "working except resource
  scoring". Here they score as the ScriptableObjects describe, for example Gas Extractor next to gas +6.
- **Grabbed buildings stay upright.** They follow the controller's yaw only, so the support beams stay vertical.
- **Ray grab:** on controllers, the thumbstick pushes the building away or pulls it in.
- MK Toon shading is approximated with `MeshToonMaterial`. The gas VFX Graph is a simple puff effect.
- AR mode (`immersive-ar`) uses the same layout over the real world. VR mode adds a gradient sky.
