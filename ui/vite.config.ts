import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve as resolvePath } from "node:path";

function normalizeBasePath(v: string | undefined): string {
  let base = (v || "/").trim();
  if (!base) base = "/";
  if (!base.startsWith("/")) base = `/${base}`;
  if (!base.endsWith("/")) base = `${base}/`;
  return base;
}

function rewriteProxySetCookie(cookie: string): string {
  return String(cookie || "")
    .replace(/;\s*Domain=[^;]+/gi, "")
    .replace(/;\s*Secure/gi, "");
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyApiTarget = (env.VITE_PROXY_API_TARGET || "").trim();
  const configuredRecoveryFile = (env.VITE_LOCAL_ACCOUNT_RECOVERY_FILE || "").trim();
  const fsAllow = [resolvePath(process.cwd())];
  if (configuredRecoveryFile) {
    fsAllow.push(dirname(configuredRecoveryFile));
  }
  const proxyConfig: Record<string, any> = {};

  if (proxyApiTarget) {
    proxyConfig["/api"] = {
      target: proxyApiTarget,
      changeOrigin: true,
      secure: true,
      configure(proxy) {
        proxy.on("proxyRes", (proxyRes) => {
          const cookies = proxyRes.headers["set-cookie"];
          if (!Array.isArray(cookies) || !cookies.length) return;
          proxyRes.headers["set-cookie"] = cookies.map((cookie) => rewriteProxySetCookie(cookie));
        });
      },
    };
  }

  return {
    // Default to root deployments. For path deployments,
    // set VITE_BASE_PATH="/v2/" at build time.
    base: normalizeBasePath(env.VITE_BASE_PATH),
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules")) {
              if (id.includes("lucide-react")) return "icons-vendor";
              if (id.includes("react-dom") || id.includes("/react/") || id.includes("scheduler")) return "react-vendor";
              if (id.includes("@tanstack/react-query") || id.includes("@tanstack/query-core")) return "query-vendor";
              return "vendor";
            }

            const normalizedId = id.replace(/\\/g, "/");
            if (
              normalizedId.includes("/src/pinsela/core/export")
              || normalizedId.includes("/src/pinsela/core/selectionRasterOps")
            ) {
              return "editor-export";
            }
            if (normalizedId.includes("/src/pinsela/ui/darkglass/modals")) {
              return "editor-modals";
            }
            if (
              normalizedId.includes("/src/pinsela/ui/darkglass/canvas/FormatPicker")
              || normalizedId.includes("/src/pinsela/ui/darkglass/canvas/ProjectPagesGrid")
            ) {
              return "editor-secondary-ui";
            }
            if (normalizedId.includes("/src/pinsela/")) {
              return "editor-bundle";
            }
          },
        },
      },
    },
    server: {
      host: "0.0.0.0",
      port: Number(env.PORT || 5173),
      strictPort: true,
      fs: {
        allow: fsAllow,
      },
      proxy: Object.keys(proxyConfig).length ? proxyConfig : undefined,
    },
  };
});
