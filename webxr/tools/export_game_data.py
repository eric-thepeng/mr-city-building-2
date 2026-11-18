"""Export the Unity game's data for the WebXR build.

Run from the repo root:   python webxr/tools/export_game_data.py

Reads the Unity prefabs / ScriptableObjects on this branch and writes
  webxr/data/game-data.json   (buildings, scoring, hand presets, terrain layout)
  webxr/assets/...            (copies of the FBX models + textures the web build loads)

All transforms are converted from Unity's left-handed space to three.js'
right-handed space (z flipped) and stored as column-major 4x4 matrices.
"""
import json
import math
import os
import re
import shutil
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
import unity_yaml as uy  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'webxr')
uy.init(ROOT)

PRIMITIVES = {'10202': 'cube', '10206': 'cylinder', '10207': 'sphere', '10209': 'plane', '10210': 'quad'}


# ---------------------------------------------------------------- math
def mat_trs(p, r, s):
    """Unity TRS -> three.js column-major matrix (z mirrored)."""
    px, py, pz = p
    qx, qy, qz, qw = r
    # mirror z: position z -> -z, rotation (x, y, z, w) -> (-x, -y, z, w)
    pz = -pz
    qx, qy = -qx, -qy
    n = math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) or 1
    qx, qy, qz, qw = qx / n, qy / n, qz / n, qw / n
    sx, sy, sz = s
    xx, yy, zz = qx * qx, qy * qy, qz * qz
    xy, xz, yz = qx * qy, qx * qz, qy * qz
    wx, wy, wz = qw * qx, qw * qy, qw * qz
    m = [
        (1 - 2 * (yy + zz)) * sx, (2 * (xy + wz)) * sx, (2 * (xz - wy)) * sx, 0,
        (2 * (xy - wz)) * sy, (1 - 2 * (xx + zz)) * sy, (2 * (yz + wx)) * sy, 0,
        (2 * (xz + wy)) * sz, (2 * (yz - wx)) * sz, (1 - 2 * (xx + yy)) * sz, 0,
        px, py, pz, 1,
    ]
    return m


def mul(a, b):
    out = [0.0] * 16
    for c in range(4):
        for r in range(4):
            out[c * 4 + r] = sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4))
    return out


IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def local(n):
    p = n.get('p') or [0, 0, 0]
    r = n.get('r') or [0, 0, 0, 1]
    s = n.get('s') or [1, 1, 1]
    s = [1.0 if (isinstance(v, float) and math.isnan(v)) else v for v in s]
    return mat_trs(p, r, s)


def rnd(m):
    return [round(v, 6) for v in m]


# ---------------------------------------------------------------- assets
copied = {}


def asset(path):
    """Copy a Unity asset into webxr/assets and return its web path."""
    if path in copied:
        return copied[path]
    rel = path[len('Assets/'):] if path.startswith('Assets/') else path
    rel = rel.replace('Low Poly Modular Terrain Pack/Terrain_Assets/Meshes/', 'terrain/')
    rel = rel.replace(' ', '_')
    dst = os.path.join(OUT, 'assets', rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(os.path.join(ROOT, path), dst)
    copied[path] = 'assets/' + rel
    return copied[path]


def material_info(path):
    if not path or not path.endswith('.mat'):
        return None
    with open(os.path.join(ROOT, path), encoding='utf8') as fh:
        t = fh.read()
    name = os.path.basename(path)[:-4]
    col = re.search(r'- _AlbedoColor: \{r: ([\d.]+), g: ([\d.]+), b: ([\d.]+), a: ([\d.]+)\}', t) or \
        re.search(r'- _BaseColor: \{r: ([\d.]+), g: ([\d.]+), b: ([\d.]+), a: ([\d.]+)\}', t)
    tex = None
    m = re.search(r'- _AlbedoMap:\s*\n\s*m_Texture: \{fileID: \d+, guid: (\w+)', t) or \
        re.search(r'- _BaseMap:\s*\n\s*m_Texture: \{fileID: \d+, guid: (\w+)', t)
    if m and m.group(1) in uy.G2P:
        tex = asset(uy.G2P[m.group(1)])
    return {'name': name, 'color': [float(x) for x in col.groups()] if col else [1, 1, 1, 1], 'map': tex}


def fbx_unit_scale(path):
    """Unity import scale for an FBX (useFileScale=1): UnitScaleFactor / 100."""
    with open(os.path.join(ROOT, path), 'rb') as fh:
        b = fh.read()
    key = b'UnitScaleFactor'
    i = b.find(b'S' + struct.pack('<I', len(key)) + key)
    if i < 0:
        return 0.01
    j = i + 5 + len(key)
    for _ in range(3):
        j += 5 + struct.unpack('<I', b[j + 1:j + 5])[0]
    return struct.unpack('<d', b[j + 1:j + 9])[0] / 100.0


materials = {}


def mat_key(path):
    if path and path.lower().endswith('.fbx'):
        # material embedded in a KayKit FBX: same texture atlas as M_Building
        return mat_key('Assets/Materials/M_Building.mat')
    if path not in materials:
        info = material_info(path)
        if info is None:
            return None
        materials[path] = info
    return materials[path]['name']


# ---------------------------------------------------------------- flatten
def renderers(node, parent=IDENT, skip=lambda n: False, out=None, inherited_model=None):
    """Collect every visible mesh under `node` with its matrix relative to `parent` space."""
    if out is None:
        out = []
    if not node.get('active', True) or skip(node):
        return out
    m = mul(parent, local(node))
    if node.get('model'):
        mats = [mat_key(x) for x in node.get('mats', []) if x]
        out.append({'fbx': asset(node['model']), 'node': None, 'mats': mats, 'm': rnd(m)})
    mesh = node.get('mesh')
    if mesh and mesh['fbx'] in PRIMITIVES.values():
        pass
    elif mesh and mesh['fbx'].lower().endswith('.fbx'):
        mats = [k for k in (mat_key(x) for x in node.get('mats', []) if x) if k]
        out.append({'fbx': asset(mesh['fbx']), 'node': node['name'], 'mats': mats, 'm': rnd(m)})
    for c in node['children']:
        renderers(c, m, skip, out)
    return out


def find(node, name):
    if node.get('name') == name:
        return node
    for c in node['children']:
        r = find(c, name)
        if r:
            return r
    return None


def sobi_name(path):
    return os.path.basename(path)[:-6].replace('SOBI_', '')


# ---------------------------------------------------------------- scoring + hands
def odin_pairs(path):
    with open(os.path.join(ROOT, path), encoding='utf8') as fh:
        t = fh.read()
    head = t.split('SerializedBytesString')[0]
    refs = []
    for m in re.finditer(r'- \{fileID: -?\d+(?:, guid: (\w+))?', head):
        refs.append(uy.G2P.get(m.group(1), m.group(1)) if m.group(1) else path)
    pairs, k = [], None
    for name, entry, data in re.findall(r'- Name: (.*)\n\s+Entry: (\d+)\n\s+Data: (.*)', t):
        name, data = name.strip(), data.strip()
        if name == '$k':
            k = refs[int(data)]
        elif name == '$v':
            pairs.append((k, int(data)))
    return t, pairs


buildings_bi = {}
for f in sorted(os.listdir(os.path.join(ROOT, 'Assets/ScriptableObjects/SOBI'))) + \
        ['Resource/' + x for x in sorted(os.listdir(os.path.join(ROOT, 'Assets/ScriptableObjects/SOBI/Resource')))]:
    if not f.endswith('.asset'):
        continue
    path = 'Assets/ScriptableObjects/SOBI/' + f
    t, pairs = odin_pairs(path)
    buildings_bi[sobi_name(path)] = {
        'displayName': re.search(r'buildingName: (.*)', t).group(1).strip(),
        'detectDistance': float(re.search(r'detectDistance: (.*)', t).group(1)),
        'scoring': {sobi_name(k): v for k, v in pairs},
    }

hands = []
hp_dir = 'Assets/ScriptableObjects/Hand Preset'
for f in sorted(os.listdir(os.path.join(ROOT, hp_dir))):
    if not f.endswith('.asset') or f.startswith('Test'):
        continue
    t, pairs = odin_pairs(hp_dir + '/' + f)
    hands.append({
        'name': f[:-6].replace('HP_', ''),
        'freeMoney': int(re.search(r'freeMoney: (.*)', t).group(1)),
        'buildings': {os.path.basename(k)[:-7].replace('BB_', ''): v for k, v in pairs},
    })

# ---------------------------------------------------------------- building blocks


def building_entry(prefab_path, key):
    tree = uy.tree(prefab_path)
    regular = find(tree, 'Regular Object')
    # The building's visuals relative to the BuildingBase root (root scale included)
    root_scale = mat_trs([0, 0, 0], [0, 0, 0, 1], tree['s'])
    meshes = []
    for c in regular['children']:
        renderers(c, mul(root_scale, local(regular)), out=meshes)
    beams = []
    sb = find(tree, 'Support Beams')
    for c in sb['children']:
        p = c['p']
        beams.append([p[0] * tree['s'][0], p[1] * tree['s'][1], -p[2] * tree['s'][2]])
    return {
        'key': key,
        'scale': tree['s'][0],
        'maxBeamLength': float(tree.get('maxBeamLength') or 0.1),
        'meshes': meshes,
        'beams': beams,  # beam anchor points relative to the building origin (metres)
    }


blocks = {}
for f in sorted(os.listdir(os.path.join(ROOT, 'Assets/Prefabs/Building Blocks'))):
    if f.endswith('.prefab') and f != 'BB_Template.prefab':
        key = f[3:-7]
        blocks[key] = building_entry('Assets/Prefabs/Building Blocks/' + f, key)

# ---------------------------------------------------------------- environment
env = uy.tree('Assets/Prefabs/Environment.prefab')
env_m = local(env)
static, resources = [], []


def walk_env(node, parent):
    if not node.get('active', True):
        return
    m = mul(parent, local(node))
    src = node.get('prefab', '')
    if src.startswith('Assets/Prefabs/Resource Nodes/'):
        kind = 'GasNode' if 'Gas' in os.path.basename(src) else 'OreNode'
        regular = find(node, 'Regular Object')
        meshes = []
        for c in regular['children']:
            renderers(c, mul(mat_trs([0, 0, 0], [0, 0, 0, 1], node['s'] if not any(
                math.isnan(v) for v in node['s']) else [0.4, 0.4, 0.4]), local(regular)), out=meshes)
        p = node['p']
        # world position of the node (translation of parent * local position, no node scale)
        pm = mul(parent, mat_trs(p, node['r'], [1, 1, 1]))
        resources.append({'type': kind, 'm': rnd(pm), 'meshes': meshes, 'vfx': kind == 'GasNode'})
        return
    if node.get('model') or (node.get('mesh') and str(node['mesh']['fbx']).lower().endswith('.fbx')):
        renderers(node, parent, out=static)
        return
    for c in node['children']:
        walk_env(c, m)


for c in env['children']:
    walk_env(c, env_m)

data = {
    'source': 'Exported from the Unity project (main branch) by webxr/tools/export_game_data.py',
    'startingMoney': 100,
    'buildingSpawn': {'unity': [-0.286, 0.996, 0.193], 'spacing': 0.15},
    'buildingInfo': buildings_bi,
    'handPresets': hands,
    'blocks': blocks,
    'fbxUnitScale': {web: fbx_unit_scale(src) for src, web in copied.items() if src.lower().endswith('.fbx')},
    'materials': {v['name']: {'color': v['color'], 'map': v['map']} for v in materials.values()},
    'environment': {'static': static, 'resources': resources},
}
os.makedirs(os.path.join(OUT, 'data'), exist_ok=True)
with open(os.path.join(OUT, 'data', 'game-data.json'), 'w', encoding='utf8') as fh:
    json.dump(data, fh, indent=1)
print('blocks', list(blocks), 'static', len(static), 'resources', len(resources))
print('copied', len(copied), 'files')
