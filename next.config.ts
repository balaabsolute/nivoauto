import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files that must be loaded from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
  experimental: {
    serverActions: { bodySizeLimit: "8mb" }, // job photos
  },
};

export default nextConfig;
