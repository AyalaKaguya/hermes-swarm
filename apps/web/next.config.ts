import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        destination: "http://localhost:3200/api/admin/:path*",
        source: "/api/admin/:path*",
      },
      {
        destination: "http://localhost:3200/api/:path*",
        source: "/api/:path*",
      },
    ];
  },
};

export default nextConfig;
