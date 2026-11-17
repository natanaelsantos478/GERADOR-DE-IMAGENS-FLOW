#!/usr/bin/env bash
# Tree models (Polyfork, CC BY 4.0, already <300 KB, origin at the trunk base) -> public/models/nature/
set -euo pipefail
D="$(cd "$(dirname "$0")/../.." && pwd)/public/models/nature"; mkdir -p "$D"
get() { curl -sSL --fail -o "$D/$1.glb" "https://polyfork.dev/cdn/$2.glb"; }
get oak broadleaf-oak-997c22; get pine tall-pine-tree-ab4108; get palm palm-tree-a307da; get birch birch-tree-181b33; get bush round-bush-cd2ac0
