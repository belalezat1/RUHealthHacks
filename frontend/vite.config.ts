import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the UI and API share one origin through the proxy, matching production routing.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
    },
  },
  build: { outDir: "dist", sourcemap: false, assetsDir: "assets" },
});
