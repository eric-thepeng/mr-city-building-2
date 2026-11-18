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
- The terrain is merged into one mesh per material, to keep draw calls low.
- In AR, the sky, fog and virtual hand meshes are hidden. The world-space **New game** button sits under
  the budget board.

## Run it

```bash
python -m http.server 8123 --directory webxr
```

Then open <http://localhost:8123>.

- **Desktop:** drag buildings with the mouse. The scroll wheel sets the height, Q/E rotates, and dragging empty space orbits the camera.
- **No headset?** Open <http://localhost:8123/?emulate>. This installs Meta's
  [Immersive Web Emulation Runtime](https://github.com/meta-quest/immersive-web-emulation-runtime),
  an emulated Quest 3, so you can use *Enter VR* / *Enter MR* in a normal browser.
- **On a device:** WebXR needs HTTPS. Open <https://mars.pengguo.net>. On Specs, open the Browser from
  Lens Explorer. For local builds on a Quest, you can also run `adb reverse tcp:8123 tcp:8123` and open
  `http://localhost:8123`.

## Deploy

The site is a Cloudflare Worker that serves `webxr/` as static assets on the custom domain
`mars.pengguo.net`. See [`wrangler.jsonc`](../wrangler.jsonc) at the repo root. From the repo root:

```bash
npx wrangler deploy
```

`webxr/.assetsignore` keeps `tools/` and this README off the site.

## How it maps to the Unity project

| Unity (`Assets/Scripts`)                          | WebXR (`webxr/src`)                                        |
|---------------------------------------------------|------------------------------------------------------------|
| `BuildingBase.cs`                                 | `Building` in `game.js`: states, cost, release / reset     |
| `SupportBeam.cs`                                  | `Building.calculateSupportBeam` (downward raycast per beam) |
| `ScoringIdentifier.cs`                            | `Building.calculateScoring` / `sendAndAddScore`            |
| `HandManager.cs` + `SO_HandPreset`                | `HandManager` in `game.js`                                 |
| `MoneyManager.cs`                                 | `MoneyManager` in `game.js` (starting budget 100)          |
| `SO_BuildingIdentifier`                           | `buildingInfo` in `data/game-data.json`                    |
| XR Interaction Toolkit (grab / ray / hover)       | `XRInput` in `input.js` (controllers + hand tracking)      |
| TextMeshPro world UI                              | canvas labels in `ui.js`                                   |
| `Environment.prefab` (terrain + resource nodes)   | `environment` in `data/game-data.json`                     |

The data is **exported from the Unity assets**, not hand-copied. If you change a prefab, a
ScriptableObject, or the environment in Unity, regenerate it:

```bash
python webxr/tools/export_game_data.py
```

The export reads the prefab/scene YAML (`tools/unity_yaml.py`) and the Odin-serialized
scoring tables and hand presets. It converts Unity's left-handed transforms to three.js, writes
`data/game-data.json`, and copies the FBX models and textures it needs into `assets/`.

## Differences from the Unity build

- **Resource nodes score.** In Unity, `BuildingBase.Start()` sets `canScore = false` on every
  node, including ore and gas resource nodes. That is why the commit says "working except resource
  scoring". Here they score as the ScriptableObjects describe, for example Gas Extractor next to gas +6.
- **Grabbed buildings stay upright.** They follow the controller's yaw only, so the support beams stay vertical.
- **Ray grab:** on controllers, the thumbstick pushes the building away or pulls it in.
- MK Toon shading is approximated with `MeshToonMaterial`. The gas VFX Graph is a simple puff effect.
- AR mode (`immersive-ar`) uses the same layout over the real world. VR mode adds a gradient sky.
