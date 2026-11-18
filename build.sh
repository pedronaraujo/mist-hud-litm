#!/bin/sh
# Build dist/mist-hud-litm.zip (the folder Foundry installs) from the repo files.
set -e
cd "$(dirname "$0")"
rm -rf dist/mist-hud-litm dist/mist-hud-litm.zip
mkdir -p dist/mist-hud-litm
cp -r module.json LICENSE README.md scripts templates styles lang ui dice dist/mist-hud-litm/
(cd dist && zip -qr mist-hud-litm.zip mist-hud-litm && rm -rf mist-hud-litm)
echo "dist/mist-hud-litm.zip"
