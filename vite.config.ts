import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The browser entry auto-mounts OpenUI's development inspector. The
      // native entry exports the identical runtime without that side effect,
      // so the clinical PWA never exposes an unrelated debug surface.
      "@openuidev/react-lang": new URL(
        "./node_modules/@openuidev/react-lang/dist/index.native.mjs",
        import.meta.url,
      ).pathname,
    },
  },
  root: "src/pwa",
  publicDir: "public",
  build: {
    outDir: "../../dist/pwa",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // Development showcase tunnel only. The production build is served by
    // the BFF/reverse proxy and does not trust forwarded hosts through Vite.
    allowedHosts: [".ngrok-free.app"],
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/health": "http://127.0.0.1:3000",
      "/ready": "http://127.0.0.1:3000",
    },
  },
});
