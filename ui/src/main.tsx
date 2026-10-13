import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./lib/auth";
import { AutoRefreshProvider } from "./lib/autoRefresh";
import { PageRefreshProvider } from "./lib/pageRefresh";
import { App } from "./App";
import { loadPinselaFonts } from "./pinsela/engine/render/fontManifest";
import "./pinsela/design/brand.css";
import "./styles.css";
import "./pinsela/design/pinsela-pages.css";
import "./pinsela/design/pinsela-ui.css";
import "./pinsela/design/pinsela-local-editor.css";
import "./pinsela/design/pinsela-shell.css";

function routerBasenameFromViteBaseUrl(baseUrl: string): string {
  // Vite's BASE_URL always ends with "/". React Router's basename should not.
  const b = (baseUrl || "/").trim();
  if (b === "/" || b === "") return "";
  return b.endsWith("/") ? b.slice(0, -1) : b;
}

// Register the bundled fonts (Inter and the other Google OFL families) on the document so the editor UI
// and any main-thread canvas render with the same fonts the server PNG uses.
if (typeof document !== "undefined" && (document as any).fonts) {
  void loadPinselaFonts((document as any).fonts);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter basename={routerBasenameFromViteBaseUrl(import.meta.env.BASE_URL)}>
      <QueryClientProvider client={queryClient}>
        <AutoRefreshProvider>
          <PageRefreshProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </PageRefreshProvider>
        </AutoRefreshProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);
