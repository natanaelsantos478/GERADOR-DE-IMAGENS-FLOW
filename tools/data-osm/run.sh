#!/usr/bin/env bash
# Pipeline reproduzível: cd tools/data-osm && ./run.sh   (python>=3.10; cria venv em tools/.cache/osm-venv)
set -e
V=../.cache/osm-venv
[ -d $V ] || { python3 -m venv $V; $V/bin/pip -q install duckdb shapely numpy scipy matplotlib; }
for s in 01_places 03_infra 04_roads_extract 02_airports 07_ports 06_facilities 05_roads_build 08_province_stats 09_validate 10_preview; do echo "== $s"; $V/bin/python $s.py; done
