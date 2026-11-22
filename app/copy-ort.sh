#!/usr/bin/env sh
# Copies the onnxruntime-web wasm runtime (14 MB, not committed) from engine/node_modules into app/public/ort.
set -e
cd "$(dirname "$0")"
src=../engine/node_modules/onnxruntime-web/dist
if [ ! -f "$src/ort-wasm-simd-threaded.wasm" ]; then
  echo "Installing engine dependencies (onnxruntime-web)..."
  (cd ../engine && npm i --no-audit --no-fund)
fi
mkdir -p public/ort
cp "$src/ort-wasm-simd-threaded.mjs" "$src/ort-wasm-simd-threaded.wasm" public/ort/
# The downloadable Echo Lock extension on the Lock page, rebuilt from extension/ so it never goes stale.
rm -f public/echo-lock.zip
(cd ../extension && zip -qr ../app/public/echo-lock.zip manifest.json background.js veil.js)
