#!/usr/bin/env bash
set -euo pipefail

NODE="${NODE:-$(command -v node || true)}"
export FFMPEG="${FFMPEG:-ffmpeg}"
export FFPROBE="${FFPROBE:-ffprobe}"

if [[ -z "$NODE" ]]; then
  echo "Node.js 20+ is required. Set NODE to its executable path." >&2
  exit 1
fi

"$NODE" render-video.mjs "$@"

for argument in "$@"; do
  if [[ "$argument" == "--smoke" || "$argument" == "--render-only" || "$argument" == "--audio-only" ]]; then
    exit 0
  fi
done

"$NODE" verify-video.mjs
