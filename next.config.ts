import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (deploy/). `node server.js`
  // serves the app; .next/static and public are copied in by the Dockerfile.
  output: "standalone",
  // File tracing misses playwright-core's browsers.json (loaded by dynamic path),
  // so the reader crashes in the standalone bundle. Ship the whole package.
  outputFileTracingIncludes: {
    "/api/*": [
      "./node_modules/.pnpm/playwright@*/node_modules/playwright/**/*",
      "./node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/**/*",
    ],
  },
};

export default nextConfig;
