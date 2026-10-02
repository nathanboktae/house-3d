"""Build a portable static site from an explicit allowlist; never read environment secrets."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
PUBLIC_FILES = ('index.html', 'style.css', 'app.js', 'rooms.mjs', 'room-map.mjs', 'ha.mjs', 'house-aerial-cropped.png')

def build():
    three = ROOT.parent / 'matterport-house/scripts/node_modules/three'
    model = ROOT.parent / 'matterport-house/output/house.glb'
    if not (three / 'build/three.module.js').is_file():
        raise SystemExit('Install the pinned dependencies: npm install --ignore-scripts --prefix matterport-house/scripts')
    if not model.is_file():
        raise SystemExit('Missing matterport-house/output/house.glb')
    # dist is generated output only. Rebuilding removes obsolete files from previous builds.
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    for name in PUBLIC_FILES:
        shutil.copy2(ROOT / 'public' / name, DIST / name)
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
