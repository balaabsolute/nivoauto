import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files that must be loaded from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
  // Note: the app deliberately has no loading.tsx route boundaries. In testing with Next 15.5 they
  // intermittently stalled client navigations and post-action refreshes (job cards, period changes).
  // Loading feedback is shown inline instead (pending buttons, "Updating…" on period changes).
  experimental: {
    serverActions: { bodySizeLimit: "8mb" }, // job photos
  },
};

export default nextConfig;
