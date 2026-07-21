import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/** Serve shared CJS acceptChatEvent as ESM under Vite (build + DIGITALME_VITE_DEV). */
function chatEventAcceptEsm(): import("vite").Plugin {
  return {
    name: "digitalme-chat-event-accept-esm",
    enforce: "pre",
    transform(code, id) {
      const norm = id.replace(/\\/g, "/");
      if (!norm.endsWith("/src/r2/chat-event-accept.js")) return null;
      if (/\bexport\s+\{/.test(code)) return null;
      const withoutExports = code.replace(
        /\nmodule\.exports\s*=\s*\{[\s\S]*\}\s*;?\s*$/m,
        "\n"
      );
      return {
        code: `${withoutExports}\nexport { acceptChatEvent };\n`,
        map: null,
      };
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname),
  base: "./",
  plugins: [react(), chatEventAcceptEsm()],
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    sourcemap: true,
    commonjsOptions: {
      include: [/chat-event-accept\.js$/, /node_modules/],
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname), path.resolve(__dirname, "..")],
    },
  },
});
