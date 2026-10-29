import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite(WASM)·pg 는 번들하지 않고 node_modules 에서 직접 로드
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default nextConfig;
