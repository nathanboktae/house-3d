# 0.1.3

- Monitor each camera connection and retry errors or 30-second connection timeouts automatically.
- Back off retries from 5 seconds to a maximum of 2 minutes, resetting after 60 seconds connected.
- Recognize MJPEG first frames without waiting for the stream to finish loading.
- Preserve healthy feeds and pending retries across TV rotations and HA state updates.
- Cancel retries while hidden or disconnected; show retry status in the affected camera panel.

# 0.1.2

- Fix startup when Supervisor's `/data/options.json` is readable only by root.
- Read app options before dropping to the unprivileged viewer user; preserve Supervisor file permissions.
- Test actual container startup with a root-owned, mode-0600 options file on AMD64 and ARM64.

# 0.1.1

- Add read-only TV mode with `?tv=1`: Main Floor, Basement, and Garage rotate every 12 seconds with a fade.
- Hide navigation and controls while preserving live temperatures and device states.
- Preload camera streams during indoor views and retry failed feeds automatically.
- Fit each floor to the TV viewport with 8% margins.
- Soften room-lighting boundaries and prevent overlapping regions from dimming twice.

# 0.1.0

- Package the 3D viewer as an ARM64/AMD64 Home Assistant app.
- Add HA-authenticated Ingress and a server-side HA WebSocket connection.
- Configure the initial view in the HA app settings without exposing credentials.
- Preserve standalone browser-local connection settings.
