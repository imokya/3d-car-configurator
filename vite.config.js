import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the built site works on GitHub Pages project URLs
  // (https://<user>.github.io/<repo>/) as well as any sub-path hosting.
  base: "./",
  resolve: {
    alias: [
      // The app imports bare "three" expecting the WebGPU build (the old
      // importmap pointed it at three.webgpu.js). Exact-match regex so
      // "three/tsl" and "three/addons/*" still resolve via package exports.
      { find: /^three$/, replacement: "three/webgpu" },
    ],
  },
  esbuild: {
    target: "esnext", // three.webgpu.js uses top-level await
  },
  build: {
    target: "esnext",
    // GLB/HDR in public/ are already optimized; just copy them through.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
});
