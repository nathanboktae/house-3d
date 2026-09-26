# Matterport house → textured GLB

Generated from the unauthenticated [public Matterport viewer](https://my.matterport.com/show/?m=w78hMjyWbY6), model `w78hMjyWbY6`, on 2026-09-26 UTC. The deliverable is **`output/house.glb`**. It is self-contained: geometry, UVs, materials, and eight PNG textures are embedded. No account, cookies, private API, guessed asset path, or access-control bypass was used.

## Files

- `source/`: original viewer HTML, parsed prefetch metadata, 50k DAM, tile manifest, eight original highest-detail GLB tiles and their original KTX2 textures. `selection.json` records the chosen manifest leaves; `sha256.json` fingerprints the archive.
- `intermediate/house.obj`, `house.mtl`, `textures/`: editable, textured OBJ equivalent, Z-up in metres.
- `output/house.glb`: final model, standard glTF Y-up in metres.
- `output/statistics.json`, `blender-validation.json`, `gltf-validation.json`: machine-readable validation.
- `output/preview-{front,back,top}.png`: renders made by reopening the final GLB in Blender.
- `scripts/`: downloader, converter, validators, dependency manifests and a local Three.js viewer.

## Retrieval and LOD selection

The starting point was [Digital-Sawdust/matterport](https://github.com/Digital-Sawdust/matterport). Its public-page prefetch parsing approach was inspected; the full archiver was not run because a smaller downloader could retrieve exactly the relevant advertised assets. DAM decoding prior art was also reviewed ([rogue_matterport_archiver](https://github.com/willowpsychology/rogue_matterport_archiver), [DAM protobuf schema](https://gist.github.com/foone/4bd3d9ca059d59e070d1e2aed7ddfe36)). DAM decoding was unnecessary for the selected higher-quality tiled source.

1. Download `https://my.matterport.com/show/?m=w78hMjyWbY6` with `curl`.
2. Parse the page's `window.MP_PREFETCHED_MODELDATA` JSON, including its `parseJSON` string encoding.
3. Read `queries.GetModelPrefetch.data.model.assets`. It advertises one available `50k` DAM, high/low DAM texture templates, and a `basic2` mesh tile manifest. No higher-resolution DAM is advertised; no guessed `500k` URL was tried.
4. Download the DAM for preservation and the advertised tile manifest. Its levels contain 1, 2, 8, and 8 tiles for LOD 0, 1, 2, and 3 respectively.
5. Select all eight leaf tiles at LOD 3, the highest advertised level (geometric error 0.02). Because refinement is `REPLACE`, parent LODs are omitted to avoid overlapping duplicate geometry. Every leaf is included, covering both stories.
6. Retrieve each tile by substituting its **manifest-provided** URI into the signed template. Retrieve only texture filenames explicitly referenced by each tile. There are eight 2048×2048 KTX2 textures.

The downloader obtains new signed URLs from freshly fetched viewer metadata on every run. Archived URLs are provenance, not hardcoded download inputs. If the model becomes unavailable or a request is denied, the downloader fails; it does not substitute credentials or attempt other access routes. This is an asset archive for conversion, not a complete offline interactive Matterport tour.

## Conversion

`convert_to_glb.py` uses DracoPy to decode the tile primitives using the explicit Draco attribute IDs. It checks vertex/index counts and finite coordinates against the source accessors. Source indices and per-vertex UVs are retained; vertices are not welded and triangles are not simplified.

[Khronos KTX-Software](https://github.com/KhronosGroup/KTX-Software/releases/tag/v4.4.2) decodes each KTX2 texture's top mip to PNG with `ktx extract --transcode rgba8`. PNG introduces no further lossy image compression. KTX reports a deprecated source DFD `bytesPlanes=0` warning but successfully decodes all textures; the final PNG-based GLB has no KTX dependency.

The coordinate change into Blender is `(x,y,z) → (x,-z,y)`, and glTF's top-left UV convention is converted to Blender/OBJ with `(u,v) → (u,1-v)`. Blender reverses these convention changes on GLB export. Source tiles have no node transforms. Final bounds are compared back in source glTF coordinates.

Materials use photographic color as emissive color with a black base, avoiding new illumination over the already baked lighting. This uses core glTF materials, without required extensions. Backface culling preserves the dollhouse cutaway behavior. For physically relighting the house, connect these images to Principled Base Color instead; the source imagery already contains lighting and shadows.

Blender 4.5.3 LTS's Python module performs the export. Flat normals split vertices at face boundaries on export: the final GLB has more vertex records than the decoded source, but exactly the same triangle count and spatial geometry. No duplicate material removal was needed: the eight materials reference distinct atlases.

## Reproduce

Requirements: Python 3.11, `uv`, `curl`, Khronos KTX-Software 4.4.2, and Node.js with npm or pnpm for the optional standards/browser checks. Python dependencies are pinned in `scripts/requirements.txt`; JavaScript dependencies are pinned in `scripts/package.json` and `pnpm-lock.yaml`.

Run from the repository root (`house3d/`):

```sh
uv venv --python 3.11 .venv-blender
uv pip install --python .venv-blender/bin/python -r matterport-house/scripts/requirements.txt

# Apple Silicon macOS: unpack official KTX tools locally without installing globally.
sh matterport-house/scripts/setup_ktx_macos.sh

# Refresh and archive the publicly advertised assets.
sh matterport-house/scripts/download_model.sh

.venv-blender/bin/python matterport-house/scripts/convert_to_glb.py \
  --ktx "$PWD/.tools/ktx"

.venv-blender/bin/python matterport-house/scripts/validate_blender.py

pnpm install --dir matterport-house/scripts --frozen-lockfile
node matterport-house/scripts/validate_gltf.cjs
```

On other platforms, install the official KTX-Software binary for that platform and use `--ktx /path/to/ktx`. The converter is also compatible with Blender's background Python entry point if NumPy and DracoPy are installed into that Blender Python environment. The tested path above uses `bpy` directly, so no Blender desktop installation is required.

To convert the preserved archive again, omit the downloader command. A fresh download may reflect future changes to the hosted scan; it is not guaranteed to reproduce this archive byte-for-byte. Blender exports may also vary in ordering across platforms.

During this run, KTX's official macOS package was expanded under `/tmp/house-ktx` and its library copied beside the extracted tools. The converter was invoked with `--ktx /tmp/house-ktx/KTX-Software-4.4.2-Darwin-arm64-tools.pkg/Payload/usr/local/bin/ktx`; the setup helper above reproduces that layout under `.tools/`. Blender's native module crashed under the execution sandbox, so conversion and rendering ran outside that sandbox. An initial Blender 5.2.2 module attempt was replaced by the pinned 4.5.3 LTS environment.

## Validation and statistics

- Fresh Blender import passed: 53 mesh objects, 108,289 triangles, UV layers on every mesh, eight packed textures at 2048×2048.
- Source and reimported GLB bounds match within 0.0001 m. All eight manifest leaves and all source triangles are retained.
- Three rendered views were inspected. Both levels, stairs, walls, floors, kitchen, and bedrooms retain their source spatial relationships. Comparison with the public dollhouse showed the expected layout and texture placement; no major section was omitted by conversion. This does not imply the original scan covers every real-world surface.
- Khronos glTF Validator `2.0.0-dev.3.10`: **0 errors, 0 warnings, 0 infos, 0 hints**.
- Three.js `0.186.1` loaded and rendered the GLB locally: 53 meshes, 108,289 triangles, eight embedded textures. The model was not uploaded to an external validation service.

```yaml
Vertices: 322684  # final GLB records, including flat-normal splits
Decoded_source_vertices: 121217
Triangles: 108289
Mesh_primitives: 53
Materials: 8
Textures: 8  # embedded PNG, each 2048 × 2048
GLB_file_size_bytes: 24281436  # 24.28 MB / 23.16 MiB
Approximate_bounding_box_metres: [15.504, 8.465, 10.143]  # X, Y-up, Z
Bounding_box_min: [-3.334, -2.735, -7.453]
Bounding_box_max: [12.170, 5.730, 2.690]
```

To inspect interactively:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory matterport-house
# Open http://127.0.0.1:8765/scripts/viewer.html
```

Drag to orbit; scroll to zoom. To inspect in Blender, use File → Import → glTF 2.0 and choose `output/house.glb`; use Material Preview or Rendered mode to see textures. For OBJ, set forward Y / up Z to retain the documented Z-up coordinates.

## Limitations

This is the viewer's scan mesh, not CAD/BIM or a watertight architectural reconstruction. Furniture and reflective/thin surfaces have fragmented, stretched, or missing triangles; there are small scan spikes and holes. Ceilings and exterior/roof geometry are incomplete. Back-facing walls disappear as in a dollhouse view. The impressive fixed-position panoramas are separate imagery and are not substituted for the mesh's baked texture atlases. Navigation, panorama transitions, room labels, floor-isolation controls, and other Matterport UI features are not part of the GLB. No cleanup, hole filling, texture hallucination, or destructive simplification was applied.
