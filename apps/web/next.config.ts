import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        destination: "http://localhost:3100/api/admin/:path*",
        source: "/api/admin/:path*",
      },
      {
        destination: "http://localhost:3100/api/:path*",
        source: "/api/:path*",
      },
    ];
  },
};

export default nextConfig;
