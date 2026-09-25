import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@queueless/db"],
  poweredByHeader: false,
};

export default nextConfig;
