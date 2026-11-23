"""Build a portable static site from an explicit allowlist; never read environment secrets."""
from pathlib import Path
import shutil
import json

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
PUBLIC_FILES = ('index.html', 'style.css', 'app.js', 'rooms.mjs', 'room-map.mjs', 'ha.mjs', 'climate.mjs', 'cameras.mjs', 'camera-connection.mjs', 'tesla.mjs', 'optimistic.mjs', 'router.mjs', 'views.json', 'runtime.mjs', 'house-aerial-cropped.png')

def build():
    three = ROOT.parent / 'matterport-house/scripts/node_modules/three'
    model = ROOT.parent / 'matterport-house/output/house-clean.glb'
    if not (three / 'build/three.module.js').is_file():
        raise SystemExit('Install the pinned dependencies: npm install --ignore-scripts --prefix matterport-house/scripts')
    if not model.is_file():
        raise SystemExit('Missing matterport-house/output/house-clean.glb; run clean_model.py')
    # dist is generated output only. Rebuilding removes obsolete files from previous builds.
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    for name in PUBLIC_FILES:
        shutil.copy2(ROOT / 'public' / name, DIST / name)
    # Physical entry pages make History API deep links work on static hosts,
    # including GitHub Pages project subpaths, without a catch-all rewrite.
    views = json.loads((ROOT / 'public/views.json').read_text())
    slugs = [view['slug'] for view in views]
    if not slugs or len(set(slugs)) != len(slugs) or any(
        not slug or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in slug)
        for slug in slugs
    ):
        raise ValueError('View slugs must be unique lowercase path segments.')
    html = (DIST / 'index.html').read_text()
    for slug in slugs:
        route_dir = DIST / slug
        route_dir.mkdir()
        (route_dir / 'index.html').write_text(html.replace('<base href="./">', '<base href="../">', 1))
    target = DIST / 'vendor/three'
    for folder in ('build', 'examples/jsm'):
        shutil.copytree(three / folder, target / folder)
    shutil.copy2(three / 'LICENSE', target / 'LICENSE')
    (DIST / 'model').mkdir()
    shutil.copy2(model, DIST / 'model/house.glb')
    (DIST / '.nojekyll').touch()
    print(f'Static site built: {DIST}')
    return DIST

if __name__ == '__main__':
    build()
