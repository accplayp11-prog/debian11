import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for argon2 and ws which use native Node.js modules
  serverExternalPackages: ["argon2", "ws", "@libsql/client", "@vercel/sandbox"],
  // Webpack config to handle native modules
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Don't attempt to process server-only modules on the client
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
