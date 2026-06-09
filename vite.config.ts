import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Builds the React islands for the Agent Platform Console.
//
// Discipline:
//   - Reads from src/views/v2/main.tsx (cockpit) and src/views/v2/wall/main.tsx (/wall)
//   - Emits to public/v2/main.{js,css} and public/v2/wall.{js,css}
//   - Does NOT touch public/assets/* (the live shell) or src/views/dashboard.ts
//   - emptyOutDir is scoped to public/v2/ only
//
// Per-entry CSS: we keep cssCodeSplit ON so the wall entry's CSS lands at
// public/v2/wall.css (not bundled into main.css). assetFileNames maps
// emitted CSS to <entryName>.css.
export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname),
  // Disable Vite's publicDir feature — the existing console already owns
  // <root>/public for its vanilla shell, and our outDir lives inside it.
  // Without this, Vite warns about the overlap and may copy/clobber files.
  publicDir: false,
  build: {
    target: "es2022",
    outDir: resolve(__dirname, "public/v2"),
    emptyOutDir: true,
    manifest: true,
    cssCodeSplit: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/views/v2/main.tsx"),
        wall: resolve(__dirname, "src/views/v2/wall/main.tsx"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        // CSS for an entry chunk arrives with info.name = "<entry>.css"
        // (Vite/Rollup convention). Map it back to <entry>.css at the root.
        assetFileNames: (info) => {
          if (info.name === "main.css" || info.name === "wall.css") return info.name;
          if (info.name && /\.css$/.test(info.name)) return info.name;
          return "assets/[name]-[hash][extname]";
        },
      },
    },
  },
});
