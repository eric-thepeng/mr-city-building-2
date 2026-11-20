// Merges data/expansion.json (hand-made buildings, nodes and hand presets) into the
// data exported from Unity (data/game-data.json). Used by the game and by tools/bake.js.

/** Expansion meshes give `scale` and `at`; turn them into the exported matrix form. */
function meshEntry({ fbx, node = null, mats = [], scale = 1, at = [0, 0, 0] }) {
  const s = scale;
  return { fbx, node, mats, m: [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, at[0], at[1], at[2], 1] };
}

export function mergeExpansion(data, ext) {
  for (const [key, block] of Object.entries(ext.blocks ?? {})) {
    data.blocks[key] = { ...block, meshes: block.meshes.map(meshEntry) };
  }
  Object.assign(data.buildingInfo, ext.buildingInfo ?? {});
  for (const [key, add] of Object.entries(ext.scoringAdd ?? {})) {
    Object.assign(data.buildingInfo[key].scoring, add);
  }
  data.handPresets.push(...(ext.handPresets ?? []));
  return data;
}
