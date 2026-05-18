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
              if (id.includes('three')) return 'three';
              if (id.includes('@react-three/fiber')) return 'fiber';
              if (id.includes('@react-three/drei')) return 'drei';
              if (id.includes('radix-ui') || id.includes('lucide-react')) return 'ui-vendor';
              if (id.includes('@tanstack')) return 'tanstack-vendor';
              if (id.includes('@json-render')) return 'json-render-vendor';
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
