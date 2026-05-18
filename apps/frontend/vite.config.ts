import path from "node:path";
import { defineConfig } from "vite";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'

export default defineConfig(({ mode }) => {
  const envRoot = path.resolve(__dirname, "../..");
  const env = loadEnv(mode, envRoot, "");
  const backendTarget = env.VITE_BACKEND_TARGET || "http://127.0.0.1:8787";

  return {
    root: path.resolve(__dirname),
    publicDir: path.resolve(__dirname, "public"),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    plugins: [
      TanStackRouterVite(),
      react(),
      tailwindcss()
    ],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes('node_modules')) {
              // Three.js is very large, keep it separate
              if (id.includes('three')) {
                return 'three';
              }
              // Keep all other vendors together to avoid circular dependencies and React scope issues
              return 'vendor';
            }
          }
        }
      }
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
