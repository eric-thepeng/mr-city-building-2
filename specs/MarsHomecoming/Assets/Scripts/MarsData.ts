// MarsData — the game's data, read from the same JSON files as the WebXR version.
// Owns: types, merging expansion.json into game-data.json (port of webxr/src/expansion.js),
// and the baked heightfield lookup (port of Heightfield in webxr/src/assets.js).
// Inputs: three JsonAssets (Assets/Data/*.json, copied from webxr/data by specs/tools/sync-data.ps1).
// Must not: touch the scene.

export interface BlockDef {
  key: string
  maxBeamLength: number
  beamCost?: number
  /** support beam anchors in building-local game units */
  beams: number[][]
}

export interface BuildingInfo {
  displayName: string
  detectDistance: number
  scoring: Record<string, number>
  altitude?: {per: number; points: number}
  consumes?: string[]
  note?: string
  about?: string
  standOn?: boolean
}

export interface HandPreset {
  name: string
  freeMoney: number
  buildings: Record<string, number>
}

export interface Pack {
  name: string
  displayName: string
  blurb?: string
  summary?: string
  presets: HandPreset[]
}

export interface ResourceDef {
  index: number
  type: string
  vfx?: boolean
  air?: boolean
  /** position in board space (game units) */
  p: number[]
  /** rotation as [x, y, z, w] */
  q: number[]
}

export interface BoardLayout {
  width: number
  depth: number
  resources: ResourceDef[]
  heightfield: {x0: number; z0: number; step: number; nx: number; nz: number; heights: number[]}
}

export interface GameData {
  startingMoney: number
  buildingSpawn: {spacing: number}
  buildingInfo: Record<string, BuildingInfo>
  handPresets: HandPreset[]
  blocks: Record<string, BlockDef>
  packs: Pack[]
  milestones: number[]
  milestoneBonus: number
  board: BoardLayout
}

/** Reads the three JSON assets and merges the expansion the way webxr/src/expansion.js does. */
export function loadGameData(gameJson: JsonAsset, expansionJson: JsonAsset, boardJson: JsonAsset): GameData {
  const data = JSON.parse(gameJson.getString())
  const ext = JSON.parse(expansionJson.getString())
  const board = JSON.parse(boardJson.getString()) as BoardLayout

  const blocks: Record<string, BlockDef> = {}
  const copyBlock = (key: string, b: any) => {
    blocks[key] = {key, maxBeamLength: b.maxBeamLength, beamCost: b.beamCost, beams: b.beams ?? []}
  }
  for (const key of Object.keys(data.blocks)) copyBlock(key, data.blocks[key])
  for (const key of Object.keys(ext.blocks ?? {})) copyBlock(key, ext.blocks[key])

  const info: Record<string, BuildingInfo> = data.buildingInfo
  Object.assign(info, ext.buildingInfo ?? {})
  for (const key of Object.keys(ext.infoAdd ?? {})) Object.assign(info[key], ext.infoAdd[key])
  for (const key of Object.keys(ext.scoringAdd ?? {})) Object.assign(info[key].scoring, ext.scoringAdd[key])

  // The Unity hand presets are always in play; the new ones come in packs unlocked at milestones.
  const byName: Record<string, HandPreset> = {}
  for (const p of ext.handPresets ?? []) byName[p.name] = p
  const packs: Pack[] = (ext.packs ?? []).map((p: any) => ({
    name: p.name,
    displayName: p.displayName,
    blurb: p.blurb,
    summary: p.summary,
    presets: p.presets.map((n: string) => byName[n]),
  }))

  return {
    startingMoney: data.startingMoney,
    buildingSpawn: data.buildingSpawn,
    buildingInfo: info,
    handPresets: data.handPresets,
    blocks,
    packs,
    milestones: ext.milestones ?? [],
    milestoneBonus: ext.milestoneBonus ?? 0,
    board,
  }
}

/** Ground height lookup on the baked sandbox grid (board space, game units). O(1) per query. */
export class Heightfield {
  readonly x0: number
  readonly z0: number
  readonly step: number
  readonly nx: number
  readonly nz: number
  readonly h: number[]

  constructor(hf: BoardLayout["heightfield"]) {
    this.x0 = hf.x0
    this.z0 = hf.z0
    this.step = hf.step
    this.nx = hf.nx
    this.nz = hf.nz
    this.h = hf.heights
  }

  /** Height at (x, z), or -Infinity off the board. Matches the baked triangles. */
  at(x: number, z: number): number {
    const fx = (x - this.x0) / this.step
    const fz = (z - this.z0) / this.step
    if (fx < 0 || fz < 0 || fx > this.nx - 1 || fz > this.nz - 1) return -Infinity
    const i = Math.min(Math.floor(fx), this.nx - 2)
    const j = Math.min(Math.floor(fz), this.nz - 2)
    const u = fx - i
    const v = fz - j
    const n = this.nx
    const h = this.h
    if (u + v <= 1) {
      return h[j * n + i] + (h[j * n + i + 1] - h[j * n + i]) * u + (h[(j + 1) * n + i] - h[j * n + i]) * v
    }
    const d = h[(j + 1) * n + i + 1]
    return d + (h[(j + 1) * n + i] - d) * (1 - u) + (h[j * n + i + 1] - d) * (1 - v)
  }
}

/** "LivingPod" -> "Living Pod" (display names from the data win). */
export function displayName(data: GameData, key: string): string {
  const n = data.buildingInfo[key]?.displayName ?? key
  return n.replace(/([a-z])([A-Z])/g, "$1 $2")
}
