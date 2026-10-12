import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files that must be loaded from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
  // Compression is left to the reverse proxy / CDN. Next's built-in gzip was observed to stall
  // streamed server-action responses (see docs/DEPLOYMENT.md, Known limitations).
  compress: false,
  experimental: {
    serverActions: { bodySizeLimit: "8mb" }, // job photos
  },
};

export default nextConfig;
