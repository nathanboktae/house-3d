# Nathan’s Home

A backend-free 3D home viewer with editable room lighting regions and direct Home Assistant updates. It runs on GitHub Pages or any HTTPS static host. The GLB is unchanged; demo controls never switch real lights. Live mode controls individual devices directly.

## Run locally

From the repository root, with Python 3 and Node.js/npm installed:

```sh
npm install --ignore-scripts --prefix matterport-house/scripts
python3 website/server.py
```

Open **http://127.0.0.1:8787/**. The existing pnpm lockfile can also be used: `pnpm install --dir matterport-house/scripts --frozen-lockfile`.

`server.py` only builds and serves static files using Python’s standard library. No Python packages, API proxy, `.env`, or backend runtime are needed. Use `--port 8788` if the old preview is still running. For a build without a preview server:

```sh
python3 website/build.py
```

Deploy **only `website/dist/`**. The allowlisted build includes the frontend, pinned Three.js files and license, and `model/house.glb`. It excludes `.env`, logs, source scan metadata, tests, and Python code. All asset URLs are relative, including import-map entries, so repository subpaths such as `/house3d/` work. No third-party runtime script CDN is used.

## Connect Home Assistant

1. Open **Home Assistant settings** in the website.
2. Confirm the Home Assistant HTTPS URL (Nathan’s Nabu Casa instance is prefilled).
3. Paste a long-lived access token into **HA_TOKEN**, then click **Save & Connect**. Create a token in your Home Assistant profile if needed.
4. Choose **Live home**, then map rooms to their light/switch entities.

The browser stores the token under local-storage key `HA_TOKEN` and the selected origin under `HA_URL`. It reconnects automatically on reload and after network interruptions. Leaving the token field empty preserves the saved token only when the instance URL is unchanged. Changing the URL requires supplying a token for that instance. **Forget token** closes the connection and deletes those two storage keys; it does not revoke the credential in Home Assistant. Room maps remain saved separately. The former server `.env` is no longer read or needed.

The settings dialog does not display the saved token. Browser storage failures are reported instead of silently pretending the token was saved. Other open tabs of this origin update when the saved credentials change.

### Authentication on every request

Home Assistant’s [WebSocket protocol](https://developers.home-assistant.io/docs/api/websocket/) authenticates once per socket with `{type: "auth", access_token: HA_TOKEN}`. Every subsequent command is authorized by that authenticated connection; repeating the token on every command is not part of the protocol. Each reconnect sends the saved token again. The app subscribes to `state_changed`, obtains `get_states`, and sends heartbeat `ping` messages. Live controls use `call_service` with one explicit light/switch entity ID and `turn_on` or `turn_off`, following the [HA WebSocket API](https://developers.home-assistant.io/docs/api/websocket/). No area-wide, floor-wide, or group commands are sent. Commands are not retried automatically; failures/timeouts are reported and actual state events drive the display. It does not use REST.

The token is sent **only to the configured Home Assistant WebSocket endpoint**. It is never appended to a URL or attached to GitHub Pages, GLB, JavaScript, or texture requests. It is never included in room-map exports, build artifacts, or application logs.

Local storage persists the token unencrypted for this browser profile. Any JavaScript running on the same origin can read it; a token has its Home Assistant user’s permissions, and live controls can operate mapped devices. Use a trusted browser/site and preferably a dedicated non-administrator HA user. All projects under a given `username.github.io` share the same origin and local storage; a separate trusted custom domain provides separation from other Pages projects. The build vendors its scripts locally, but deployment code must still be trusted. Public static hosting also makes the included house GLB publicly downloadable; Home Assistant authentication protects live states, not the static model.

## Does Nabu Casa support CORS?

Nabu Casa exposes the Home Assistant instance through its remote-access tunnel. REST CORS and WebSocket origins are separate mechanisms; a successful WebSocket connection does not imply REST requests are allowed.

Observed for Nathan’s endpoint during this update:

- An unauthenticated `OPTIONS /api/states` preflight with origin `https://example.github.io` and requested header `authorization` returned **403**, with no `Access-Control-Allow-*` headers. REST is therefore not enabled for that sample origin as currently configured; the actual deployed origin may differ.
- A WebSocket handshake to `/api/websocket` with that same origin returned **`auth_required`**.
- The static preview’s **Test connection** button also received the handshake directly from Nabu Casa in the browser. This test sends no token.

The app uses the working WebSocket route, so no REST CORS configuration is needed for its current functionality. Authenticated read-only registry and state queries were subsequently verified using the local `.env` token. The static build never reads or embeds that token.

If adding REST calls later, use `Authorization: Bearer HA_TOKEN` on requests to the configured instance and allow the deployed website’s **origin** in Home Assistant’s HTTP CORS settings, for example `https://USERNAME.github.io` (no repository path). Current Home Assistant exposes **CORS allowed origins** under Settings → System → Network → HTTP server; older versions use `http.cors_allowed_origins` in `configuration.yaml`. See the [official HTTP documentation](https://www.home-assistant.io/integrations/http/). No Home Assistant settings were changed by this work.

## Deploy to GitHub Pages

The repository includes `.github/workflows/pages.yml`, triggered **manually** with `workflow_dispatch`:

1. Push the code and model to your GitHub repository.
2. In repository **Settings → Pages**, choose **GitHub Actions** as the source.
3. Run **Actions → Deploy Nathan’s Home → Run workflow**.
4. Open the Pages URL and enter the token through Home Assistant settings on that site.

The workflow installs the exact pinned viewer dependencies, runs the browser-client tests, builds and checks `website/dist`, and deploys that artifact using the official Pages actions. It does not use a GitHub secret containing `HA_TOKEN`; each visitor supplies a token locally in their own browser. It does not deploy on every push. This workflow has been prepared but has not been run or published from this task. GitHub’s [custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) explains repository setup.

## Map rooms

The default map contains Nathan’s 19 named rooms, traced as polygon footprints from the numbered floor images. M12 and B6 share one Stairway spanning both floors. B8 is Basement Hallway. Click an in-scene label or sidebar card to select its room. **Main Floor** and **Basement** filter the scan, labels, and sidebar; All floors shows main-floor labels so basement names do not obscure the floor above. The Labels checkbox hides labels.

The map matches 16 Home Assistant lights across 14 rooms. Den combines `light.den` and `light.media`. Primary Bath uses `light.primary_vanity`; Kitchen uses `light.kitchen_east_lights` and `light.kitchen_west_light`; Living Room uses `light.living_room`. Upper Hallway, Stairway, Basement Bathroom, Storage Room, and Basement Hallway have no mapped lights and remain neutral in live mode. The exterior `light.front_door` is intentionally unassigned. Entity matches were checked against the read-only inventory; no HA area, device, or configuration was changed.

- Expand **Edit selected room** to adjust the name, bounds, and mapped light/switch entities.
- Changing bounds scales the existing polygon and its label. Height bounds keep lighting on the correct floor; the approximate floor split is Y = -0.15 m.
- **Draw footprint in top view** replaces the selected polygon with a rectangle: click two opposite corners; Escape cancels.
- Demo toggles and brightness sliders preview the effect without controlling real lights.

Up to 32 regions with 3–16 polygon vertices each are supported. Polygon points are editable in exported JSON (`footprint` contains world X/Z pairs). Older rectangular maps remain supported. Avoid overlaps, which compound shading. Concave footprints keep areas such as Storage Room from spilling into the stairwell. Boundaries are approximate traces, not surveyed walls.

Mapping and demo levels persist in local storage (`house-live-rooms-v2`). **Export room map** creates a JSON backup; **Import map** validates and restores it. Untouched old draft regions automatically upgrade to the named map; customized legacy maps are preserved. **Use labeled room map** loads the confirmed defaults and backs up the previous map under `house-live-rooms-backup`. Maps are specific to the browser origin and are not synced between devices.

In live mode, any mapped entity known to be on illuminates the room, using the brightest known light's brightness. Switches use full brightness. If no mapped entity is known on but any is missing/unavailable, the room remains neutral and is labeled unknown. All-known-off rooms dim to 18% rather than disappearing. This intentionally visualizes state; it is not a physical light simulation.

## Visual limitations

The source textures have baked lighting. A fragment shader adjusts their brightness and tint inside room bounds, preserving UVs and textures. Ordinary lights alone would not reliably affect the source’s emissive materials. This visualizes on/off state rather than simulating fixtures or new shadows. Room footprints are approximate, especially at shared walls and open-plan boundaries.

## Validation

```sh
node --test website/tests/*.test.mjs
python3 website/build.py
python3 -m unittest discover -s website/tests -p 'test_*.py'
```

Tests cover browser storage and forgetting, secure URL validation, partial-storage failures, per-connection authentication, reconnects, heartbeats, subscription/snapshot ordering, stale callback protection, state filtering, permission/authentication failures, and unknown-room handling. Build checks verify the original GLB checksum, subdirectory-safe paths, and exclusion of secret/server files. Browser testing confirms the settings dialog, direct unauthenticated Nabu Casa handshake, demo lighting, and static GLB rendering. No actual token is required or embedded in tests.

Room tests also cover the confirmed map, floor filtering, concave footprints, proportional edits, and migration without losing custom mappings.

## Individual light controls

Choose **Top view**, a floor, and **Live home**. Click a sun/light icon to immediately turn that individual device on or off. Rooms with multiple devices show a separate labeled icon for each. Each command targets exactly one available entity; entities advertising group members are disabled. In demo mode the same icon changes shading only. Sidebar live buttons also toggle their individual devices directly. No control dialog is shown. The UI reports failures and does not optimistically pretend a light changed.

The October 2 inventory refresh added Living Room and Kitchen East/West to the default map. Existing custom browser maps are preserved: export a backup and select **Use labeled room map** to load the refreshed defaults, or edit those rooms manually. The old screenshot’s three draft regions are not the current 19-room map. No real devices were operated during development verification.
