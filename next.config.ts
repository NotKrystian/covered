import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (deploy/). `node server.js`
  // serves the app; .next/static and public are copied in by the Dockerfile.
  output: "standalone",
};

export default nextConfig;
