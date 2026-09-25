import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@queueless/db"],
};

export default nextConfig;
