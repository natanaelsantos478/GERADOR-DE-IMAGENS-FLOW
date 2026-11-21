#!/usr/bin/env bash
# Sources of the close-range ("near") models, into tools/.cache/models/near (untrusted data; never executed):
#  - Polyfork (CC BY 4.0) GLBs with separate parts (turret, gun, wheels...), from the public CDN.
#  - Quaternius "Toon Shooter Game Kit" (CC0) characters with rifle animations. quaternius.com serves them from Google Drive, whose
#    download quota is usually exhausted, so the three character .gltf files are taken from a public GitHub mirror of the kit.
set -euo pipefail
C="$(cd "$(dirname "$0")/.." && pwd)/.cache/models/near"; mkdir -p "$C/polyfork" "$C/toon"
for id in medium-tank-65da6b armoured-half-track-3deded military-cargo-truck-652f66 towed-field-howitzer-bb9a08 anti-aircraft-gun-93cc80 eight-wheel-industrial-hauler-4dc3d7 defense-turret-12ba8d; do
  [ -s "$C/polyfork/$id.glb" ] || curl -sSL --fail -o "$C/polyfork/$id.glb" "https://polyfork.dev/cdn/$id.glb"
done
if [ ! -s "$C/toon/Character_Soldier.gltf" ]; then
  T="$(mktemp -d)"; git clone --depth 1 https://github.com/jwh781101-ship-it/nantu-arena-assets.git "$T/m" >/dev/null 2>&1
  cp "$T/m"/Character_Soldier.gltf "$C/toon/"; rm -rf "$T"
fi
ls -la "$C/polyfork" "$C/toon"
