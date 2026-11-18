# Local room-labeling tools

These optional offline/administrative helpers are not part of the static website build.

## Read Home Assistant room metadata

```sh
uv venv --python 3.13 .venv-web
uv pip install --python .venv-web/bin/python aiohttp==3.13.3 python-dotenv==1.2.1 truststore==0.10.4
.venv-web/bin/python website/scripts/inspect_ha_rooms.py
```

Reads the first nonempty `HA_TOKEN` in the repository-root `.env` or `website/.env`, and optional `HA_URL`. Uses only registry list commands and `get_states`; does not change state/configuration. Stores a filtered inventory in Git-ignored `website/private/room-labeling/ha-inventory.json` with file mode 0600. Does not print or save the token. Light/switch, sensor, and climate metadata, including temperature values and thermostat capabilities, areas, and floors are retained in the private inventory. The website does not load this file or the `.env`.

## Render floor references

Use the Blender 4.5.3 environment documented in `matterport-house/README.md`:

```sh
.venv-blender/bin/python website/scripts/render_floor_labels.py
.venv-blender/bin/python website/scripts/render_floor_labels.py \
  --markers website/private/room-labeling/markers.json
```

Both renders use the same orthographic camera. Source geometry is clipped into floors in temporary Blender memory; the original GLB is never overwritten. Main-floor geometry uses GLB Y >= -0.15 m; basement uses Y <= -0.15 m. The split is useful for room identification but is approximate around stair landings. Marker text and discs are rendered in Blender above the model, without AI-generated geometry or textures.

Marker JSON maps `main` and `basement` to arrays of `{ "id": "M1", "xy": [x, y] }`. These coordinates are Blender's horizontal XY: `(x, y) = (glTF X, -glTF Z)`. `projection.json` records camera/frame details. All generated images, markers, live inventory and the labeling worksheet stay under the ignored private directory and are excluded from GitHub Pages.
