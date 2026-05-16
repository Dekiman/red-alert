import path from "node:path";
import { defineConfig } from "vite";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'

export default defineConfig(({ mode }) => {
  const envRoot = path.resolve(__dirname, "../..");
  const env = loadEnv(mode, envRoot, "");
  const backendTarget = env.VITE_BACKEND_TARGET || "http://127.0.0.1:3030";

  return {
    root: path.resolve(__dirname),
    publicDir: path.resolve(__dirname, "public"),
    plugins: [
      TanStackRouterVite(),
      react(),
      tailwindcss()
    ],
    build: {
      outDir: path.resolve(__dirname, "../../dist/frontend"),
      emptyOutDir: true
    },
    server: {
      proxy: {
        "/api": {
          target: backendTarget,
          changeOrigin: true
        },
        "/health": {
          target: backendTarget,
          changeOrigin: true
        },
        "/ui-socket": {
          target: backendTarget,
          changeOrigin: true,
          ws: true
        }
      }
    }
  };
});
