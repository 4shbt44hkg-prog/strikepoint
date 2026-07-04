import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5174,
    proxy: {
      "/ws": {
        target: "ws://localhost:8081",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    target: "es2022",
  },
});
