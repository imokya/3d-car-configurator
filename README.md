# WebGPU+Car Configuration+行歌

WebGPU car configurator (McLaren Artura) built with three.js r180 + TSL node materials.

## Features

- WebGPU renderer (`three/webgpu`) with TSL paint: candy clearcoat + metal-flake sparkle
- Real-time ground reflection (full-res reflector + MSAA + distance-based mip blur)
- Bloom post-processing, day/night studio HDRI switching
- 6 paint finishes, camera presets, #debug parameter panel, `#noreflection` toggle
- Draco-compressed model (~1M triangles)

## Dev

```bash
npm install
npm run dev
```

## Build

```bash
npm run build   # outputs to dist/
npm run preview # local preview of the build
```

`vite.config.js` uses `base: "./"`, so the build works on GitHub Pages project URLs directly.

## Notes

- `REFLECTION_ENABLED` / `BLOOM_ENABLED` flags in `src/main.js` toggle heavy passes for perf A/B.
- Requires a WebGPU-capable browser (Chrome/Edge 113+). Firefox falls back to WebGL2 via three's renderer where supported.
- Model & HDRI: see `public/assets/HDRI-LICENSE.txt`.
