import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "electron-vite";

const sharedAlias = { "@shared": resolve("src/shared") };

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    build: {
      outDir: "dist/main",
      sourcemap: true,
    },
  },
  preload: {
    resolve: { alias: sharedAlias },
    build: {
      outDir: "dist/preload",
      sourcemap: true,
      rollupOptions: {
        output: {
          // sandbox: true 的 Renderer 只能执行 CJS preload；ESM 产物会以
          // "Cannot use import statement outside a module" 失败。
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    base: "./",
    resolve: {
      alias: {
        "@": resolve("src/renderer"),
        ...sharedAlias,
      },
    },
    build: {
      outDir: "dist/renderer",
      sourcemap: true,
    },
    server: {
      host: "127.0.0.1",
      port: 5175,
      strictPort: true,
    },
  },
});
