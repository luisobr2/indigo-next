import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output: produces a self-contained .next/standalone bundle
  // that we copy into the runtime stage of the Dockerfile. Cuts the
  // production image from ~1.2 GB to ~200 MB and removes the need to
  // ship node_modules.
  output: "standalone",
};

export default nextConfig;
