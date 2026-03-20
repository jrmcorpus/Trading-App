import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const loadEnvFromFile = (filePath: string) => {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    if (!key) continue;
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
};

// https://vitejs.dev/config/
export default defineConfig(() => {
  loadEnvFromFile(path.resolve(process.cwd(), ".env.local"));
  const bridgePort = Number(process.env.MT5_BRIDGE_PORT || 8787);
  const bridgeTarget = `http://localhost:${bridgePort}`;

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    css: {
      postcss: "./postcss.config.js",
    },
    server: {
      port: 3000,
      open: true,
      proxy: {
        "/api/mt5": {
          target: bridgeTarget,
          changeOrigin: true,
        },
        "/api/mt4": {
          target: bridgeTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
      minify: "terser",
    },
  };
});
