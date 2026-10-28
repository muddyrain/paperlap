import { defineConfig } from "vite";

export default defineConfig({
  build: { target: "es2022" },
  server: { host: "127.0.0.1", open: false },
  preview: { host: "127.0.0.1", open: false },
});
