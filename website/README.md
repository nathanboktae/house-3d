# House / Live

A local website for the archived house GLB with room brightness driven by Home Assistant. Demo mode is usable now. Actual Home Assistant authentication and entity mapping require your token and room setup.

## Start

From the repository root:

```sh
uv venv --python 3.13 .venv-web
uv pip install --python .venv-web/bin/python -r website/requirements.txt
# Three.js uses the existing pinned dependency:
pnpm install --dir matterport-house/scripts --frozen-lockfile
.venv-web/bin/python website/server.py
```

Open **http://127.0.0.1:8787/**. No token is required for demo mode. The original GLB is served from its existing location and is not modified. The server uses local assets; no model upload or CDN is needed.

## Connect Home Assistant

1. Sign into your [Home Assistant instance](https://home-assistant.example).
2. In your user profile, find **Long-Lived Access Tokens** (under Security). Create a token named **House 3D**. A dedicated non-administrator user is preferable when available.
3. Copy `website/.env.example` to `website/.env`. Paste the token after `HA_TOKEN=`. Do not put it in chat or source code. `.env` files are ignored by Git and are outside the web-served directories.
4. Restart `website/server.py`. The connection badge should turn green. Select **Live home**.
5. Select a room, expand **Edit selected room**, and select the corresponding lights or switches. Cmd/Ctrl-click for multiple entities.

The server reads the token only at startup. The app's integration is read-only: it sends `auth`, `subscribe_events` for `state_changed`, and `get_states`. It never sends a service call. The token itself inherits its user's Home Assistant permissions; it is not a scoped read-only credential. It is never sent to browser clients or included in logs.

The bridge uses Home Assistant's documented [WebSocket API](https://developers.home-assistant.io/docs/api/websocket/) and [long-lived token authentication](https://developers.home-assistant.io/docs/auth_api/#long-lived-access-token). State changes are pushed to the browser with server-sent events. On disconnect the cache is cleared and reconnection backs off to 30 seconds; rejected tokens require updating `.env` and restarting. Only light/switch IDs, friendly names, states, brightness and update timestamps reach the browser.

## Map rooms

The scan's mesh chunks do not define rooms. This prototype applies spatial shading boxes in world coordinates, independent of the original mesh/material divisions. The three starting regions are **illustrative drafts, not surveyed room boundaries**.

- Select a room and expand the editor, or use **Add room**.
- Choose a floor. The approximate floor split is Y = -0.15 m and may need refinement for stairs/split levels.
- **Draw footprint in top view**: click two opposite corners around the room's floor. Press Escape to cancel.
- Adjust X/Z boundaries and the Y height range. This prevents a light affecting the room directly above or below it. Drawing uses a horizontal plane at the room's minimum height; perspective and wall height can affect perceived alignment.
- Give it a name and select its Home Assistant entities.
- Toggle demo lights or change their brightness to preview the shaded footprint.

Up to 16 rectangular regions are supported. Avoid overlapping regions: their tint multipliers compound. Unmapped areas retain their original appearance. Nonrectangular rooms can use multiple nonoverlapping boxes mapped to the same entities. For exact wall boundaries, a future version can replace boxes with polygons or segmented room geometry.

Mapping and demo levels persist in browser local storage. **Export room map** creates a JSON backup; **Import map** validates and restores it. Mappings are specific to the browser origin and are not yet synced between devices.

In live mode, any mapped entity known to be on illuminates the room, using the brightest known light's brightness. Switches use full brightness. If no mapped entity is known on but any is missing/unavailable, the room remains neutral and is labeled unknown. All-known-off rooms dim to 18% rather than disappearing. This intentionally visualizes state; it is not a physical light simulation.

## Scope and hosting

The server binds only to `127.0.0.1` and checks Host/Origin to prevent cross-site access to home states. It has no remote-user authentication and must not be exposed directly to the Internet. A next deployment could be an authenticated Home Assistant dashboard integration or a server behind authenticated HTTPS. The Nabu Casa URL supplies the upstream Home Assistant connection; it does not automatically host this website.

The source textures have baked lighting. A fragment shader adjusts their brightness and tint inside room bounds, preserving UVs and textures. Adding ordinary lights alone would not reliably affect the source's emissive materials. This approach communicates on/off state clearly, but does not simulate fixtures, cast shadows, or remove shadows captured in the scan. Demo controls only affect the website; actual light control is not implemented.

## Validation

```sh
.venv-web/bin/python -m unittest discover -s website/tests -v
node --test website/tests/rooms.test.mjs
```

Tests exercise the WebSocket auth/snapshot/subscription flow against a local fake HA server, state updates, disconnect invalidation, rejected tokens, state ordering, filtered data, inaccessible secret paths, and Host/Origin checks. Frontend tests cover aggregation of mixed/unknown states and room-map validation. Browser checks verify the GLB renders and demo toggles visibly change regional brightness; disconnected live mode shows unknown state with disabled toggles. Real authenticated HA behavior remains unverified until a token is configured.

The supplied Nabu Casa endpoint was checked without credentials on 2026-09-28 and returned `auth_required`. Python’s default certificate-chain validation encountered a compatibility error on this machine; the bridge now uses `truststore` with native system certificate verification, retaining TLS hostname and certificate checks. The unauthenticated endpoint check then passed.
