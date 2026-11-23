# House 3D Home Assistant app

## Install on HA OS (including Raspberry Pi 5)

1. Open **Settings → Apps → App store → ⋮ → Repositories** (older HA versions call these Add-ons).
2. Add `https://github.com/nathanboktae/house-3d`.
3. Refresh the store, select **House 3D**, and click **Install**. HA builds the image locally for ARM64 or AMD64; the first install downloads build dependencies and may take several minutes.
4. Set **Configuration → default_view** if desired: `dollhouse`, `main-floor`, `basement`, or `outside`.
5. Start the app. Choose **Open Web UI**, or enable **Show in sidebar**.

The repository root is the app build context. No separate integration, HACS install, HA configuration mount, port mapping, or long-lived token is needed. Restart this app after changing its configuration; Home Assistant itself does not need restarting.

For a local installation before publishing changes, copy this repository into `/addons/house_3d` on HA, omitting `.git`, `.venv*`, `node_modules`, `.env*`, `website/private`, and `website/dist`. Reload the store and install **House 3D** under Local apps. The Docker build uses an explicit file allowlist and rebuilds the static assets.

## Launch and authentication

Ingress uses your existing HA login. Open the app from HA's sidebar or Open Web UI; do not bookmark the temporary `/api/hassio_ingress/...` session address. View navigation and deep links within that session preserve the mounted ingress path. The initial view comes from the app configuration; opening a specific view path takes precedence over that default.

The browser connects to the app's same-origin WebSocket bridge. The bridge authenticates internally through `http://supervisor/core/websocket` using the runtime `SUPERVISOR_TOKEN`. That credential is never returned in HTML, JavaScript, runtime settings, cookies, or local storage. No Nabu Casa hostname is embedded or needed. The runtime settings response contains only the mode and default view. Existing standalone browser credentials are ignored in Ingress mode.

The server accepts only Supervisor ingress connections from `172.30.32.2`, using the actual socket peer, not forwarded headers. No container port is published. Access logs are disabled to avoid recording ingress session paths. Startup reads Supervisor’s options as root, then permanently drops to the unprivileged viewer user before starting the HTTP server. The sidebar is admin-only by default. The bridge uses the app's HA authority, not per-user HA device permissions: anyone allowed to access this app can exercise its HA API connection. Keep access limited to trusted users.

For launch preferences, use the HA app configuration and the non-secret runtime settings endpoint. Credentials in query strings could be retained in history and logs; JavaScript-readable cookies would expose the same secret to page scripts. Neither is needed here. Standalone static hosting still uses the browser-local URL/token settings described in `website/README.md`.

## Development and verification

```sh
node --test website/tests/*.test.mjs
python3 website/build.py
python3 -m unittest discover -s website/tests -p 'test_*.py'
python3 -m pip install -r addon/requirements.txt
python3 -m unittest discover -s addon -p 'test_*.py'
docker build -t house-3d:local .
```

Bridge tests use a synthetic HA endpoint; they never control real devices. They cover ingress peer checks, token isolation, WebSocket forwarding, upstream failure, and static paths. Installing in your HA instance remains the final end-to-end test.

If the viewer cannot connect, check that HA Core is running, then restart the app. The app needs `homeassistant_api: true` and its Supervisor-provided token. Do not add a token to the configuration or expose port 8099 directly to work around an ingress error.

## TV mode

After opening the app through Home Assistant, append `?tv=1` to the viewer URL. Main Floor, Basement, and Garage rotate every 12 seconds with a fade. Floor views fit the display with at least 8% margins. Navigation and controls are disabled while readings remain live. Remove the parameter and reload to restore normal mode.

## Updating

Refresh the app store repository, open House 3D, and install the available update. Home Assistant builds the new version locally and restarts the app; refresh any open viewer tabs afterward.
