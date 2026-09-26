#!/bin/sh
# Unpack official Khronos tools locally; no system installation or sudo.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
case "$(uname -sm)" in
  'Darwin arm64') ;;
  *) echo 'This helper is for Apple Silicon macOS; install KTX-Software 4.4.2 for your platform.' >&2; exit 1 ;;
esac
TOOLS="$ROOT/.tools"
mkdir -p "$TOOLS"
if [ ! -d "$TOOLS/ktx-package" ]; then
  curl -fL --retry 3 https://github.com/KhronosGroup/KTX-Software/releases/download/v4.4.2/KTX-Software-4.4.2-Darwin-arm64.pkg -o "$TOOLS/ktx.pkg"
  pkgutil --expand-full "$TOOLS/ktx.pkg" "$TOOLS/ktx-package"
fi
KTXROOT="$TOOLS/ktx-package/KTX-Software-4.4.2-Darwin-arm64-tools.pkg/Payload/usr/local"
mkdir -p "$KTXROOT/lib"
cp -a "$TOOLS/ktx-package/KTX-Software-4.4.2-Darwin-arm64-library.pkg/Payload/usr/local/lib/"libktx* "$KTXROOT/lib/"
ln -sfn "$KTXROOT/bin/ktx" "$TOOLS/ktx"
"$TOOLS/ktx" --version
