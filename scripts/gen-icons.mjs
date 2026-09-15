#!/usr/bin/env node
// Renders build/icon.svg (the source of truth for the app icon) down to the
// raster assets electron-builder and the app itself need. Run via `yarn gen:icons`
// after editing the SVG. See CLAUDE.md / README.md "App icon".
import { mkdir } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const svgPath = join(root, 'build', 'icon.svg')

const targets = [
  // electron-builder generates .ico/.icns from this at build time (see README
  // "App icon" — delete build/icon.ico and build/icon.icns if they reappear,
  // they'd otherwise take precedence over this file).
  { out: join(root, 'build', 'icon.png'), size: 1024 },
  // Linux window icon (src/main/app/window.ts) and the app's own asset.
  { out: join(root, 'resources', 'icon.png'), size: 512 }
]

for (const { out, size } of targets) {
  await mkdir(dirname(out), { recursive: true })
  await sharp(svgPath, { density: 384 }).resize(size, size).png().toFile(out)
  console.log(`wrote ${out} (${size}x${size})`)
}
