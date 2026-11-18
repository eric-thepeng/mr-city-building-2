# MR City Building — WebXR

A browser port of the Unity game on `main`, built with [three.js](https://threejs.org) and WebXR.
**Live: <https://mars.pengguo.net>**

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
- In AR, the sky, fog and virtual hand meshes are hidden. The world-space **New game** button sits under
  the budget board.

### Memory budget (Specs)

Specs stops apps that use too much memory ("App Stopped: high memory used"), so the game is kept small:

| | Before | Now |
|---|---|---|
| Models | 33 FBX files parsed on the device | one pre-baked `data/world.glb` (1.3 MB) |
| Terrain | 57 Unity pieces, 133k triangles, kept twice for rendering + collisions | 81×81 heightfield, 12.8k triangles, 6 × 6 m around the player |
| Support-beam ground test | raycast against the terrain mesh | O(1) lookup in `data/terrain.json` |
| Textures | two 1024² atlases | two 256² atlases |
| Labels | 119 canvas textures (5.4 MPx) | made on first use, no mipmaps, one shared hover panel (~8 textures) |
| Red "can't build" model | a second copy of every building | made only when first needed |
| Hand / controller meshes | downloaded from a CDN | not loaded on Specs |
| XR resolution | 100% | 75% on Specs (`?fb=1` overrides) |

Measured in desktop Chrome: geometry 13.1 MB → 0.74 MB, JS heap 38 MB → 22 MB.

## Run it

```bash
python -m http.server 8123 --directory webxr
```

Then open <http://localhost:8123>.

- **Desktop:** drag buildings with the mouse. The scroll wheel sets the height, Q/E rotates, and dragging empty space orbits the camera.
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

Then open <http://localhost:8124/tools/bake.html>. The page loads the FBX files once and writes
`data/world.glb` (all building and resource models) and `data/terrain.json` (the simplified heightfield).
To change the terrain's area or detail, edit `TERRAIN` at the top of `tools/bake.js` and bake again.

## Differences from the Unity build

- **Resource nodes score.** In Unity, `BuildingBase.Start()` sets `canScore = false` on every
  node, including ore and gas resource nodes. That is why the commit says "working except resource
  scoring". Here they score as the ScriptableObjects describe, for example Gas Extractor next to gas +6.
- **Grabbed buildings stay upright.** They follow the controller's yaw only, so the support beams stay vertical.
- **Ray grab:** on controllers, the thumbstick pushes the building away or pulls it in.
- MK Toon shading is approximated with `MeshToonMaterial`. The gas VFX Graph is a simple puff effect.
- AR mode (`immersive-ar`) uses the same layout over the real world. VR mode adds a gradient sky.
