import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // libsql ships native bindings — keep it out of the bundler.
  serverExternalPackages: ["@libsql/client"],
};

export default nextConfig;
