import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  // IMPORTANT: Make Vite serve apps/desktop/src/renderer as the app root
  root: path.resolve(__dirname, "src/renderer"),

  // Load .env files from apps/desktop (where .env.local lives)
  envDir: __dirname,

  // IMPORTANT for Electron file:// builds
  base: "./",

  plugins: [react()],

  envPrefix: ["VITE_", "REACT_APP_"],

  resolve: {
    alias: {
      // renderer imports from "@tc/shared"
      "@tc/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },

  server: {
    port: 5173,
    strictPort: false,

    proxy: {
      "/opensky": {
        target: "https://opensky-network.org",
        changeOrigin: true,
        secure: true,
      },
      "/aisstream": {
        target: "https://api.aisstream.io",
        changeOrigin: true,
        secure: true,
      },
    },

    // allow importing shared workspace files from outside Vite root
    fs: {
      allow: [
        path.resolve(__dirname, "src/renderer"),
        path.resolve(__dirname, "../../packages/shared/src"),
        path.resolve(__dirname, ".."),
        path.resolve(__dirname, "../.."),
      ],
    },
  },

  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
  },

  define: {
    "process.env": JSON.stringify(process.env),
  },
});
