import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ratavyr listens on :8080. `/api` (REST + the /api/ws WebSocket,
// including its `?access_token=` query) is proxied so the browser talks to a
// single origin in development, exactly as in production where the server
// serves dist/ itself.
export default defineConfig({
  plugins: [react()],
  // three.js alone is ~500 kB minified; it is split into the lazily-loaded viewer chunk.
  build: { chunkSizeWarningLimit: 600 },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
