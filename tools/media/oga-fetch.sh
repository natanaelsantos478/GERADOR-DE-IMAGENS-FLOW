#!/bin/bash
# usage: oga-fetch.sh slug...  -> tools/.cache/media/oga/<slug>/ (files + meta.txt with license/author)
ROOT="$(cd "$(dirname "$0")/../.." && pwd)/tools/.cache/media/oga"
for s in "$@"; do
  d="$ROOT/$s"; [ -e "$d" ] && { echo "skip $s (exists)"; continue; }
  mkdir -p "$d"; curl -s -m 40 "https://opengameart.org/content/$s" -o "$d.html"
  mv "$d.html" "$d/page.html.txt"
  lic=$(grep -o "license-name'>[^<]*" "$d/page.html.txt" | sed "s/license-name'>//" | paste -sd, -)
  auth=$(grep -o 'href="/users/[^"]*"[^>]*>[^<]*' "$d/page.html.txt" | head -1 | sed 's/.*>//')
  auth2=""
  printf 'license=%s\nauthor=%s\nsource=https://opengameart.org/content/%s\n' "$lic" "${auth:-$auth2}" "$s" > "$d/meta.txt"
  grep -o "https://opengameart.org/sites/default/files/[^\"' ]*" "$d/page.html.txt" | grep -v '/styles/\|license_images\|/pictures/\|audio_preview\|\.png$\|\.jpg$\|\.gif$' | sort -u | while read u; do
    curl -s -m 120 -o "$d/$(basename "${u%%\?*}" | sed 's/%20/_/g')" "$u"
  done
  echo "== $s: $(cat "$d/meta.txt"|tr '\n' ' ')"; ls -la "$d" | tail -n +4 | awk '{print $5,$9}'
done
