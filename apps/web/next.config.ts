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
  allowedDevOrigins: ['100.110.219.64'],
};

export default nextConfig;
