# MR City Building — Specs (Lens Studio)

The Snap Specs (2026, SPECS 27) version of the game, built in Lens Studio with Snap's
CLAD (Closed Loop Agentic Development) tooling. It is a native port of the WebXR version in
`../webxr` (live at <https://mars.pengguo.net>): the same Mars Homecoming sandbox, rules and data.

- Lens Studio **5.25.0** or later (CLAD needs 5.25+). Project: `MarsHomecoming/MarsHomecoming.esproj`.
- Created from the SPECS **Base Template**: the official **Interaction Kit** (SIK 4.0), **UI Kit** (4.0),
  Icons and Motion packages are under `MarsHomecoming/Packages`.
- Assets and packages are stored with Git LFS (`MarsHomecoming/.gitattributes`).

## Play it in Lens Studio

Open `MarsHomecoming/MarsHomecoming.esproj` and use the Preview panel (device: Specs). The sandbox
appears about 75 cm ahead and 45 cm below your eyes, so look down in Preview. With the mouse, click
and drag a building in the hand row (SIK's mouse interactor), point at resource nodes for tooltips,
and click the cards and buttons. On Specs: pinch a building up close or point and pinch from afar.

### Two maps

On Specs the game opens with a choice:

- **Mars Map**: the built-in sandbox, as in the WebXR version.
- **Real Space**: look at a table or the floor, press *Scan Here*, and look around for a few seconds.
  The surface becomes the board. Real objects are terrain: buildings can't go through them, and support
  beams can stand on them. Ore appears at their foot, crystal on top, gas in the open and ice clouds
  above. The scan runs once per launch and is not saved; *New game* keeps the same scan.

Lens Studio Preview has no depth, so it starts directly on the Mars map. To try the whole flow there,
turn on **Preview Map Menu**: Real Space then scans a test table with three objects.

The Inspector of the `MarsHomecoming` object has the settings:

| Setting | Default | |
|---|---|---|
| Board Distance / Board Below Eyes | 75 / 45 cm | where the sandbox appears (and goes on **Recenter**) |
| Unlock All Packs | off | every building pack from the start (WebXR `?unlock`) |
| Debug Colliders | off | draws the grab and hover boxes |
| Start With Choice | off | debug: start at the first milestone (pack card, then the hand choice) |
| First Hand | empty | debug: deal this hand preset first, e.g. `Skywatch_01` |
| Preview Map Menu | off | Preview only: show the Mars Map / Real Space menu (Specs always show it) |
| Sounds | `GeneratedSFX/Mars*.wav` | build, fail, coin, milestone, cloud |

## How it maps to the WebXR version

The game logic is a line-by-line port of `webxr/src/game.js`, so the two can be diffed. Positions
inside the board are in the same game units (Unity metres); the `Board` object is scaled to
50 cm per unit (the WebXR `BOARD_SCALE` 0.5).

| WebXR (`webxr/src`) | Lens (`MarsHomecoming/Assets/Scripts`) |
|---|---|
| `main.js`: setup, board placement, Recenter / New game, frame loop, sign faces the player | `MarsMain.ts` (the `@component` on the `MarsHomecoming` object) |
| `expansion.js` (`mergeExpansion`) + `assets.js` `Heightfield` | `MarsData.ts` (reads the same three JSON files as JsonAssets) |
| `assets.js` `AssetLibrary` (models from `world.glb`, materials) | `MarsModels.ts` `ModelLibrary` + `Assets/Materials/MH_*.mat` |
| `assets.js` terrain `flatShading` + `addRockStrata` | `MarsTerrain.ts` (face normals) + `Assets/Textures/terrain_strata.png` (from `tools/gen-strata.py`) |
| `Building` (states, beams, cost, overlap, scoring, badges, pop) | `MarsBuilding.ts` |
| `collision.js` (layer boxes that follow each model, overlap and push-out) | `MarsCollision.ts` |
| `Game`, `MoneyManager`, `HandManager`, clouds, dust ring, flying scores, `Game.carry` | `MarsGame.ts` |
| `Progress` (score, milestones, packs, card text, choice flow) | `MarsProgress.ts` |
| `makeGasVents` (one InstancedMesh) | `MarsMeshes.ts` `GasPuffs` (one MeshBuilder mesh rewritten per frame) |
| `mergeResourceVisuals` | `ModelLibrary.mergeStatic` (ore rocks + crystal veins: 2 draw calls) |
| `input.js` `XRInput` (pinch near / ray far, yaw-only carry) | SIK `Interactable` + `InteractableManipulation` (rotation axis Y, no scaling) on each hand building; `Interactable` hover on resource nodes |
| `input.js` `MouseInput` | SIK's mouse interactor in Preview |
| `ui.js` `Label` (canvas labels) | `MarsLabelsUI.ts` `WorldLabel` (Lens Text with a background, turned to the camera) |
| `ui.js` `Label.setCard` (two-sided score cards) | `MarsScoreCardUI.ts` `ScoreCard`, drawn from the `CardBlock` lists that `MarsProgress.ts` makes |
| Budget sign labels + in-world buttons | `MarsSignUI.ts` (UI Kit `Frame`, `Button`s) |
| Choice panel (cards, pack card, Continue, 45° building models with score tips) | `MarsChoiceUI.ts` (UI Kit `Frame`, card `Button`s, Flex layout, `ScoreCard`) |
| `makeAudio` (WebAudio tones) | `Assets/GeneratedSFX/Mars*.wav`, made by `tools/gen-sfx.js` with the same notes |
| `data/game-data.json`, `expansion.json`, `board.json`, `world.glb`, `textures/` | `Assets/Data`, `Assets/Models`, `Assets/Textures` (copied by `tools/sync-data.ps1`; the two atlases are stored flipped, see below) |

`UIKitHelpers.ts` is CLAD's UI Kit 4.0 helper, copied unchanged.

The UI and interaction follow `webxr-main` up to commit `4960534b`: two-sided hover cards, the pack
card's tables, card buildings fixed at 45° with a score tip, a name tip on finished buildings, and
carried buildings that stop at the ground and at other buildings (collision follows each model in
layers; the label shows only the cost). The carry limit runs on SIK's `onManipulationUpdate`, right
after it moves the building to the hand, so the building never shows inside the terrain or a building.
The game data follows `webxr-main` up to `c4a3652b` (balance version 1).
Not ported, because they only apply to the desktop web page: the landing page, the Mars sky and fog,
moving the camera with the mouse while carrying, and holding R / F to lift a building with the
mouse. The choice panel's gold border is also not reproduced. Button hover and press states come from UI Kit.

### Real Space (Specs only, no WebXR counterpart)

| Script | Job |
|---|---|
| `MarsMapFlow.ts` | The steps before a game: choose a map, aim, scan, retry or fall back to Mars |
| `MarsMapUI.ts` | The panel for those steps |
| `MarsRoomScan.ts` | Casts rays straight down through the World Mesh on a 4 cm grid, keeps the median of each point's last 5 hits, finds the base surface and fills small holes. Also holds the Preview test room |
| `MarsRoomLayout.ts` | Places the same 51 resource nodes according to the scanned shape |

The scan produces a normal `BoardLayout`, so beams, costs and scoring run unchanged. Only a real board
adds the footprint check (`Heightfield.footprint`), hides the Mars terrain and removes Recenter.

### What is the same art, and what was rebuilt

| | Source |
|---|---|
| All 12 buildings, 26 ore rocks, 9 crystal veins, 6 ice clouds, terrain and side walls | **The same meshes**: `webxr/data/world.glb`, unchanged |
| Building textures | **The same two atlases**, flipped vertically: WebXR samples them with `flipY = true`, which Lens has no switch for (its material UV transform did not apply in the Specs Preview) |
| Materials | **Rebuilt** as glTF materials with the WebXR colours and 45% texture glow |
| Terrain faces and cliff rock bands | **Rebuilt** at start from the same mesh: per-face normals, bands from a lookup texture with the WebXR colours and spacing |
| Support beams, range sphere, dust ring, gas puffs | **Rebuilt** with MeshBuilder at the WebXR sizes |
| Labels, sign, choice panel | **Rebuilt** with Lens Text and UI Kit |

### Scene

```text
MarsHomecoming        MarsMain; placed in front of the player at start and on Recenter
├─ Board              scale 50: terrain, resource nodes, buildings, gas puffs (game units)
├─ BudgetSign         MarsSignUI (UI Kit Frame), over the far edge, turns to face the player
├─ ChoicePanel        MarsChoiceUI (UI Kit Frame), in the hand row when a hand is used up
└─ ModelLibrary       disabled copy of world.glb; models are cloned from it by node name
```

### Keeping the data in sync

The WebXR data is the source of truth. After it changes (new buildings, scoring, packs, a new bake):

```powershell
powershell -File specs/tools/sync-data.ps1
```

New *buildings* also need their model in `world.glb` (the WebXR bake) and nothing else: the Lens
finds `block_<Key>` by name. A new material name in the GLB needs an entry in `MATERIAL_KEYS`
(`MarsModels.ts`) and a material in `Assets/Materials`.

## Specs memory and performance

| | WebXR on Specs | Lens |
|---|---|---|
| Models | one baked `world.glb` | the same GLB, imported once; buildings are copies of its nodes |
| Draw calls | 27 | about 20 for the board, hand and sign (terrain 2, rocks + crystals 2, gas 1, clouds 6, the hand's buildings, sign frame + buttons), plus text labels |
| Support-beam ground test | heightfield lookup + short ray | heightfield lookup + layer box tests (no physics raycasts) |
| Resource nodes | merged per material | merged per material at start (`mergeStatic`) |
| Red "can't build" model | second copy, made on first use | a material swap on the same model |
| Textures | two 256² atlases | the same two |
| Labels | one shared canvas | Lens Text components (no textures) |

Lights: ambient 0.55 and directional 0.85, lower than the template's 1 + 1, so the pale terrain
keeps its shading. Buildings keep 45% of their texture as emissive glow, as in WebXR (dark reads as
see-through on Specs).

## Differences from the WebXR version

- **Beams on resource nodes** stand on the node's bounding box instead of its exact rock surface.
- **Mouse in Preview** drags in SIK's camera plane; there is no wheel lift or Z/X rotation. On Specs,
  carrying is yaw-only through SIK, as in WebXR.

## Testing status

Checked in the Lens Studio Preview with CLAD's simulated SIK hands (`PreviewInteractTool`):
carrying and placing buildings, cost and beam labels, badges, scoring and flying scores to the
budget, "beams too long", the hand choice and dealing, the milestone pack card and Continue, the
Sky Platform (`standOn`) with a Wind Turbine on top (cloud + height score), the Weather Station
using up an ice cloud (ghost with countdown), resource tooltips, New game and Recenter.
The Factory and the Weather Station were compared side by side with the live WebXR version. The
other buildings use the same meshes and atlases but were not compared one by one.

Checked in Preview with the real mouse: the pack card and Continue, picking a hand, the score tip
on card buildings, the hover card on waiting buildings, resource tooltips, and that an open choice
panel blocks the pointer from what is behind it. The name tip on a finished building and that it
can't be picked up again were checked with a building placed by the simulated hand.

Real Space was checked in Preview against the test room, with simulated hands: the menu, Back, scan,
a failed scan and Try Again, the Mars fallback, a building blocked by an object, one placed on top of
an object, one outside the mapped area, and New game.

Not yet checked: game over (budget below 0) in Preview, and anything on Specs glasses. That includes
**the real World Mesh**: its accuracy, how long a scan takes and the cost of the rays are unknown until
the first on-device run (Lens Studio → *Preview Lens* on a paired Specs).

CLAD's preview tools installed `AiPreviewAgentInspect`, `AiPreviewAgentInteract`, `Leaf` and
`Bitmoji 3D` into `Packages/` and an `AiPreviewAgent Handler` object into the scene. They are only
for testing; remove that object before publishing.

## Working with CLAD (Claude Code)

1. Open `MarsHomecoming.esproj` in Lens Studio, and sign in with your Specs account
   (*SPECS Dev Portal → Login*) so you can send Lenses to the glasses.
2. Check that the MCP server is running: *AI Assistant → AI Model Context Protocol (MCP) → Configure Server*.
   Lens Studio writes `.mcp.json` (holds a token, gitignored) into the project folder. The port can change
   each time the server starts.
3. Start Claude Code **from `specs/MarsHomecoming`** (Lens Studio must already be running):

   ```powershell
   cd specs/MarsHomecoming
   claude
   ```

   `MarsHomecoming/.claude/settings.json` turns on the `ls-clad` plugin, adds its marketplace
   (`lens-studio-devs/ls-extensions`) and pre-approves the `lens-studio` MCP server. Run `/mcp` and
   check that `lens-studio` shows as connected.

The plugin only turns on when Claude Code starts in `specs/MarsHomecoming`. Starting it from the repo
root loads neither CLAD nor the MCP server.

The first time CLAD drives simulated hands in Preview, Lens Studio asks to trust the **LEAF** plugin
(filesystem, asset library, push to device); the TypeScript compile waits until it is answered.

To regenerate the rock-band lookup texture:

```powershell
python specs/tools/gen-strata.py
```

To regenerate the sound effects (CLAD's offline synth):

```powershell
node specs/tools/gen-sfx.js "$env:USERPROFILE\.claude\plugins\cache\ls-extensions\ls-clad\1.1.0\skills\build-sfx\tools"
```

Docs: <https://docs.lensstudio.com/build-with-ai/clad/about/what-is-clad?target=specs>
