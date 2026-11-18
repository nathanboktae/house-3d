# House 3D archive

The completed model and reproducible conversion workflow are in [matterport-house](matterport-house/README.md).

- [Cleaned textured house model](matterport-house/output/house-clean.glb)
- [Original scan archive](matterport-house/output/house.glb)
- [Conversion and validation scripts](matterport-house/scripts/)
- [Rendered preview](matterport-house/output/clean-preview-front.png)
- [Original public-viewer assets](matterport-house/source/)

## Nathan’s Home

[Nathan’s Home](website/README.md) is a static 3D house viewer with editable lighting zones and a direct browser-to-Home-Assistant connection. Enter `HA_TOKEN` in the site’s settings to save it in browser local storage. Run `python3 website/server.py`, or build `website/dist/` for GitHub Pages. No backend is required.

## Home Assistant app

Install this repository through the HA Apps store to serve the viewer on your HA OS device. It opens through HA Ingress and connects automatically; no URL or long-lived token needs to be supplied. ARM64 (including Raspberry Pi 5) and AMD64 are supported. See [installation and configuration](DOCS.md).
