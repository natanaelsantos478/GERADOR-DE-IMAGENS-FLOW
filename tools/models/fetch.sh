#!/usr/bin/env bash
# Downloads the raw sources into tools/.cache/models (untrusted data; never executed) and converts .blend/.fbx/.obj to
# intermediate GLBs in tools/.cache/models/raw-glb using Blender's `bpy` module in a venv:
#   uv venv --python 3.13 .venv && uv pip install --python .venv/bin/python bpy
# then `node build.mjs && node make-manifest.mjs && node contact-sheet.mjs`.
set -euo pipefail
C="$(cd "$(dirname "$0")/.." && pwd)/.cache/models"; H="$(cd "$(dirname "$0")" && pwd)"; PY="${BPY:-$H/.venv/bin/python}"
OGA=https://opengameart.org/sites/default/files
get() { mkdir -p "$C/$1"; curl -sSL --fail -o "$C/$1/$2" "$3"; [[ "$2" == *.zip ]] && (cd "$C/$1" && unzip -oq "$2") || true; }
get cimpletoon cimpletoon.zip $OGA/cimpletoon.zip
get abrams abrams.blend $OGA/abrams-tank.blend
get mobilesam romb.blend $OGA/romb_0.blend
get containership cs.blend $OGA/container-ship-full.blend1_.blend
get attackchopper attackchopper.zip $OGA/attackchopper.zip
get cooling Cooling_Tower.zip $OGA/Cooling_Tower.zip
get kenney-industrial k.zip $OGA/kenney_city-kit-industrial_2.0.zip
get kenney-commercial k.zip $OGA/kenney_city-kit-commercial_2.1.zip
get kenney-blocky k.zip $OGA/kenney_blocky-characters_2.0.zip
# Polyfork (CDN, GLB direct): ids listed in tools/.cache/models/polyfork/ids.txt (see defs.mjs for the ones used)
mkdir -p "$C/polyfork"; for id in $(grep -o "PF('[^']*')" "$H/defs.mjs" | sed "s/PF('//;s/')//" | sort -u); do curl -sSL --fail -o "$C/polyfork/$id.glb" "https://polyfork.dev/cdn/$id.glb"; done
mkdir -p "$C/raw-glb"
for n in armor submarine destroyer1 stealthfighter stealth_bomber1 cruiser01 carrier01 cruise_missile01 mechinf howitzer helicopter02; do
  "$PY" -I "$H/blend2glb.py" "$C/cimpletoon/cimpletoon/$n.blend" "$C/raw-glb/$n.glb" --no-anim; done
cp_() { "$PY" -I "$H/blend2glb.py" "$1" "$C/raw-glb/$2.glb" --no-anim; }
cp_ "$C/abrams/abrams.blend" abrams; cp_ "$C/mobilesam/romb.blend" mobilesam; cp_ "$C/containership/cs.blend" containership
"$PY" -I "$H/import2glb.py" "$C/attackchopper/FBX/Attack_Helicopter.fbx" "$C/raw-glb/apache.glb"
"$PY" -I "$H/import2glb.py" "$C/cooling/cooling_tower.fbx" "$C/raw-glb/cooling.glb"
