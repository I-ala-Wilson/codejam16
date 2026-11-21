#!/usr/bin/env sh
# Copies the onnxruntime-web wasm runtime (14 MB, not committed) from engine/node_modules into app/public/ort.
set -e
cd "$(dirname "$0")"
src=../engine/node_modules/onnxruntime-web/dist
if [ ! -f "$src/ort-wasm-simd-threaded.wasm" ]; then
  echo "onnxruntime-web not installed: run 'cd ../engine && npm i' first (the app falls back to rule detectors without it)"; exit 0
fi
mkdir -p public/ort
cp "$src/ort-wasm-simd-threaded.mjs" "$src/ort-wasm-simd-threaded.wasm" public/ort/
