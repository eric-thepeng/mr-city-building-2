"""Minimal Unity YAML reader: flattens prefabs/scenes into plain JSON trees.

Only what the WebXR port needs: transforms (Unity space), names, active
flags, mesh/material references, and a few game-script fields.
"""
import functools
import glob
import json
import os
import re

ROOT = None
G2P = {}


def init(root):
    global ROOT
    ROOT = root
    for m in glob.glob(os.path.join(root, 'Assets/**/*.meta'), recursive=True):
        try:
            with open(m, encoding='utf8', errors='ignore') as fh:
                g = re.search(r'guid: (\w+)', fh.read(1000)).group(1)
            G2P[g] = os.path.relpath(m[:-5], root).replace('\\', '/')
        except Exception:
            pass


def guid_of(path):
    with open(os.path.join(ROOT, path + '.meta'), encoding='utf8') as fh:
        return re.search(r'guid: (\w+)', fh.read()).group(1)


def vec(s):
    return [float(x) for x in re.findall(r'[xyzw]: (-?[\d.eE+-]+)', s)] if s else None


def fld(body, key):
    m = re.search(r'^\s*' + re.escape(key) + r': (.*)$', body, re.M)
    return m.group(1).strip() if m else None


def ref(body, key):
    m = re.search(re.escape(key) + r': \{fileID: (-?\d+)(?:, guid: (\w+))?', body)
    return (m.group(1), m.group(2)) if m else (None, None)


@functools.lru_cache(None)
def parse(path):
    with open(os.path.join(ROOT, path), encoding='utf8') as fh:
        t = fh.read()
    docs = re.split(r'^--- !u!(\d+) &(-?\d+)( stripped)?\n', t, flags=re.M)
    objs = {}
    for i in range(1, len(docs), 4):
        objs[docs[i + 1]] = (docs[i], docs[i + 3], bool(docs[i + 2]))
    return objs


def build(path, tf_id):
    objs = parse(path)
    cls, b, strip = objs[tf_id]
    if strip:
        return None
    go_id = ref(b, 'm_GameObject')[0]
    gb = objs[go_id][1]
    node = {
        'id': tf_id, 'go': go_id, 'name': fld(gb, 'm_Name'),
        'active': fld(gb, 'm_IsActive') != '0',
        'p': vec(fld(b, 'm_LocalPosition')), 'r': vec(fld(b, 'm_LocalRotation')),
        's': vec(fld(b, 'm_LocalScale')),
        'mesh': None, 'mats': [], 'scripts': [], 'children': [],
    }
    for c in re.findall(r'component: \{fileID: (-?\d+)\}', gb):
        ccls, cb, _ = objs.get(c, ('?', '', 0))
        if ccls == '33':
            fid, g = ref(cb, 'm_Mesh')
            node['mesh'] = {'fbx': G2P.get(g, g), 'fileID': fid}
        elif ccls == '23':
            head = cb.split('m_StaticBatchInfo')[0]
            node['mats'] = [G2P.get(g, g) for g in re.findall(r'- \{fileID: \d+, guid: (\w+)', head)]
        elif ccls == '114':
            fid, g = ref(cb, 'm_Script')
            script = G2P.get(g, '?')
            node['scripts'].append(os.path.basename(script))
            if script.endswith('BuildingBase.cs'):
                node['maxBeamLength'] = fld(cb, 'maxBeamLength')
            if script.endswith('ScoringIdentifier.cs'):
                node['bi'] = G2P.get(ref(cb, 'myBI')[1])
        elif ccls == '2083052967':
            node['vfx'] = True
    for cfid in re.findall(r'- \{fileID: (-?\d+)\}', b.split('m_Children:')[1].split('m_Father')[0]):
        ccls, cb, cstrip = objs[cfid]
        if cstrip:
            node['children'].append(instance(path, ref(cb, 'm_PrefabInstance')[0]))
        else:
            node['children'].append(build(path, cfid))
    return node


def setprop(n, pp, v, og):
    m = re.match(r'm_Local(Position|Rotation|Scale)\.([xyzw])', pp)
    if m:
        k = {'Position': 'p', 'Rotation': 'r', 'Scale': 's'}[m.group(1)]
        n[k][('xyzw').index(m.group(2))] = float(v)
    elif pp == 'm_IsActive':
        n['active'] = v != '0'
    elif pp == 'm_Name':
        n['name'] = v
    elif pp == 'maxBeamLength':
        n['maxBeamLength'] = v
    elif pp == 'myBI' and og:
        n['bi'] = G2P.get(og, og)
    elif pp.startswith('m_Materials.Array.data') and og:
        i = int(re.search(r'\[(\d+)\]', pp).group(1))
        while len(n['mats']) <= i:
            n['mats'].append(None)
        n['mats'][i] = G2P.get(og, og)


def find(n, id_):
    if n is None:
        return None
    if n.get('id') == id_ or n.get('go') == id_ or id_ in n.get('aliases', ()):
        return n
    for c in n['children']:
        r = find(c, id_)
        if r:
            return r
    return None


def instance(path, pid):
    objs = parse(path)
    b = objs[pid][1]
    _, sg = ref(b, 'm_SourcePrefab')
    src = G2P.get(sg, sg)
    mods = re.findall(
        r'- target: \{fileID: (-?\d+), guid: (\w+)[^}]*\}\n\s+propertyPath: (.*)\n\s+value: (.*)\n'
        r'\s+objectReference: \{fileID: (-?\d+)(?:, guid: (\w+))?', b)
    if src.lower().endswith('.fbx'):
        node = {'name': os.path.basename(src)[:-4], 'model': src, 'active': True,
                'p': [0, 0, 0], 'r': [0, 0, 0, 1], 's': [1, 1, 1], 'children': [], 'mats': []}
        root_ids = set()
        for fid, g, pp, v, of, og in mods:
            if pp == 'm_Name' or pp.startswith('m_LocalPosition'):
                root_ids.add(fid)
        for fid, g, pp, v, of, og in mods:
            if pp.startswith('m_Local') and fid not in root_ids:
                continue
            setprop(node, pp, v, og)
    else:
        node = json.loads(json.dumps(root_of(src)))
        for fid, g, pp, v, of, og in mods:
            if g != sg:
                continue
            n = find(node, fid)
            if n:
                setprop(n, pp, v, og)
    node['prefab'] = src
    # stripped objects in *this* file that stand for objects of the source prefab
    aliases = {}
    for fid, (ccls, cb, strip) in objs.items():
        if strip and ref(cb, 'm_PrefabInstance')[0] == pid:
            aliases[fid] = ref(cb, 'm_CorrespondingSourceObject')[0]
    for fid, corr in aliases.items():
        n = find(node, corr)
        if n is not None:
            n.setdefault('aliases', []).append(fid)
    # Re-key ids into this file's frame: Unity derives the fileID of an object that
    # comes from a prefab instance as (instanceFileID ^ sourceFileID) & 0x7fff...
    if not src.lower().endswith('.fbx'):
        def remap(n):
            for k in ('id', 'go'):
                if n.get(k):
                    n[k] = str((int(pid) ^ int(n[k])) & 0x7FFFFFFFFFFFFFFF)
            n['aliases'] = []
            for c in n['children']:
                if c:
                    remap(c)
        remap(node)
    # GameObjects / prefab instances added under this instance's stripped transforms
    for fid, (ccls, cb, strip) in objs.items():
        if strip:
            continue
        if ccls == '4':
            fa = ref(cb, 'm_Father')[0]
        elif ccls == '1001' and fid != pid:
            fa = ref(cb, 'm_TransformParent')[0]
        else:
            continue
        fb = objs.get(fa)
        if fb and fb[2] and ref(fb[1], 'm_PrefabInstance')[0] == pid:
            corr = ref(fb[1], 'm_CorrespondingSourceObject')[0]
            target = find(node, corr) or node
            target['children'].append(build(path, fid) if ccls == '4' else instance(path, fid))
    return node


@functools.lru_cache(None)
def root_of(path):
    objs = parse(path)
    for fid, (cls, b, strip) in objs.items():
        if cls == '4' and not strip and ref(b, 'm_Father')[0] == '0':
            return build(path, fid)
    for fid, (cls, b, strip) in objs.items():
        if cls == '1001' and ref(b, 'm_TransformParent')[0] == '0':
            return instance(path, fid)
    return None


def clean(n):
    n = dict(n)
    for k in ['id', 'go', 'aliases']:
        n.pop(k, None)
    for k in list(n):
        if n[k] in (None, [], False) and k not in ('children', 'active'):
            n.pop(k)
    n['children'] = [clean(c) for c in n['children'] if c]
    return n


def tree(path):
    return clean(root_of(path))


if __name__ == '__main__':
    import sys
    init(sys.argv[1])
    print(json.dumps(tree(sys.argv[2]), indent=1))
