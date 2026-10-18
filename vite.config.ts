import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cp, readFile } from "node:fs/promises";
import { resolve, normalize, sep } from "node:path";

// Excalidraw's fonts are served from this app rather than a public CDN.
const fonts = resolve("node_modules/@excalidraw/excalidraw/dist/prod/fonts");
function excalidrawFonts(): Plugin {
  return {
    name: "excalidraw-fonts",
    configureServer(server) {
      server.middlewares.use("/excalidraw/fonts", async (request, response, next) => {
        const file = normalize(resolve(fonts, `.${decodeURIComponent(request.url?.split("?")[0] || "")}`));
        if (!file.startsWith(fonts + sep)) return next();
        try {
          const data = await readFile(file);
          response.setHeader("Content-Type", file.endsWith(".woff2") ? "font/woff2" : "application/octet-stream");
          response.end(data);
        } catch {
          next();
        }
      });
    },
    async writeBundle(options) {
      await cp(fonts, resolve(options.dir || "dist", "excalidraw/fonts"), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), excalidrawFonts()],
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Keep Vite's preload helper with the always-loaded vendor code.
          if (id.includes("preload-helper")) return "react";
          if (!id.includes("node_modules")) return;
          if (/[\\/]three[\\/]/.test(id)) return "three";
          if (/@react-three|three-stdlib|troika|maath|camera-controls/.test(id)) return "r3f";
          if (/better-auth|@better-|zod|nanostores|jose/.test(id)) return "auth";
          if (/react-dom|scheduler|zustand|use-sync-external-store|[\\/]react[\\/]/.test(id)) return "react";
        },
      },
    },
  },
  server: {
    proxy: {
      "/ws": { target: "ws://127.0.0.1:3001", ws: true },
      "/health": { target: "http://127.0.0.1:3001" },
      "/api": { target: "http://127.0.0.1:3001" },
      "/mcp": { target: "http://127.0.0.1:3001" },
    },
  },
});
