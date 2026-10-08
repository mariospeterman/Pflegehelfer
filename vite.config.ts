import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolveBuildIdentity } from "./scripts/build-identity.mjs";

const buildIdentity = resolveBuildIdentity();
const configuredTunnelHost = process.env.PFH_NGROK_DOMAIN?.trim()
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const allowedTunnelHosts = [
  ".ngrok-free.app",
  ".ngrok.app",
  ...(configuredTunnelHost &&
  /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(configuredTunnelHost)
    ? [configuredTunnelHost]
    : []),
];

export default defineConfig({
  plugins: [
    react(),
    {
      name: "pflegehelfer-build-identity",
      generateBundle(_options, bundle) {
        this.emitFile({
          type: "asset",
          fileName: "build-info.json",
          source: `${JSON.stringify({ surface: "pwa", ...buildIdentity }, null, 2)}\n`,
        });
        const shellAssets = Object.values(bundle)
          .map((entry) => `/${entry.fileName}`)
          .filter((fileName) =>
            /\.(?:css|js|woff2?|png|svg|webmanifest|html)$/i.test(fileName),
          );
        this.emitFile({
          type: "asset",
          fileName: "sw-assets.json",
          source: `${JSON.stringify([...new Set(["/", ...shellAssets])])}\n`,
        });
      },
    },
  ],
  define: {
    __PFH_BUILD_ID__: JSON.stringify(buildIdentity.buildId),
    __PFH_BUILD_SHA__: JSON.stringify(buildIdentity.sourceSha),
  },
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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@openuidev")) return "openui";
          if (
            id.includes("recharts") ||
            id.includes("d3-") ||
            id.includes("victory-")
          )
            return "charts";
          if (id.includes("react") || id.includes("scheduler")) return "react";
          return "vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    // Development showcase tunnel only. The production build is served by
    // the BFF/reverse proxy and does not trust forwarded hosts through Vite.
    allowedHosts: allowedTunnelHosts,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/health": "http://127.0.0.1:3000",
      "/ready": "http://127.0.0.1:3000",
    },
  },
});
