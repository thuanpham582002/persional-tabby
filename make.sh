#!/bin/bash

# Set environment variables
export ARCH="arm64"  # or "x86_64" for Intel Macs
export RUST_TARGET_TRIPLE="aarch64-apple-darwin"  # or "x86_64-apple-darwin" for Intel Macs

# Install Rust target
rustup target add $RUST_TARGET_TRIPLE

# Install dependencies
yarn --network-timeout 1000000

# Build with webpack
yarn run build

# Run prepackage plugins script
node scripts/prepackage-plugins.mjs

# Patch electron-builder (if needed)
sed -i '' 's/updateInfo = await/\/\/updateInfo = await/g' node_modules/app-builder-lib/out/targets/ArchiveTarget.js

# Create electron symlink workaround
ln -s ../../node_modules/electron app/node_modules

# Build macOS packages
node scripts/build-macos.mjs

# Create artifact directories and move files
mkdir -p artifact-dmg artifact-zip
mv dist/*.dmg artifact-dmg/
mv dist/*.zip artifact-zip/
