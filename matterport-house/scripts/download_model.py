#!/usr/bin/env python3
"""Download only assets explicitly advertised by the unauthenticated public viewer."""
import json, re, struct, subprocess, hashlib
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'source'

def fetch(url, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error', '--retry', '3', url, '-o', str(path)], check=True)

def glb_json(path):
    b = path.read_bytes()
    assert b[:4] == b'glTF'
    return json.loads(b[20:20 + struct.unpack_from('<I', b, 12)[0]])

def leaves(n):
    children = n.get('children', [])
    if children:
        assert n.get('refine', 'REPLACE') == 'REPLACE'
        for child in children:
            yield from leaves(child)
    elif 'content' in n:
        yield n

def main():
    fetch('https://my.matterport.com/show/?m=w78hMjyWbY6', SOURCE / 'viewer.html')
    html = (SOURCE / 'viewer.html').read_text()
    match = re.search(r'window.MP_PREFETCHED_MODELDATA = parseJSON\((".+?")\);', html)
    data = json.loads(json.loads(match[1])) if match else json.loads(re.search(r'window.MP_PREFETCHED_MODELDATA = (\{.+?\}\}\});', html)[1])
    (SOURCE / 'prefetch.json').write_text(json.dumps(data, indent=2))
    assets = data['queries']['GetModelPrefetch']['data']['model']['assets']
    for mesh in assets['meshes']:
        if mesh['status'] == 'available':
            fetch(mesh['url'], SOURCE / mesh['filename'])
    tileset = assets['tilesets'][0]
    fetch(tileset['url'], SOURCE / 'tileset.json')
    manifest = json.loads((SOURCE / 'tileset.json').read_text())
    selected = list(leaves(manifest['root']))
    for tile in selected:
        uri = tile['content']['uri']
        assert '..' not in Path(uri).parts and not Path(uri).is_absolute()
        dest = SOURCE / 'tiles' / uri
        fetch(tileset['urlTemplate'].replace('<file>', uri), dest)
        for image in glb_json(dest).get('images', []):
            name = image['uri']
            assert Path(name).name == name
            image_uri = str(Path(uri).parent / name)
            fetch(tileset['urlTemplate'].replace('<file>', image_uri), dest.parent / name)
        print('Downloaded', uri, flush=True)
    (SOURCE / 'selection.json').write_text(json.dumps(selected, indent=2))
    hashes = {str(p.relative_to(SOURCE)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(SOURCE.rglob('*')) if p.is_file() and p.name != 'sha256.json'}
    (SOURCE / 'sha256.json').write_text(json.dumps(hashes, indent=2))

if __name__ == '__main__':
    main()
