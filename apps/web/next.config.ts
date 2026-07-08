import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        destination: "http://localhost:3200/api/realtime",
        source: "/api/realtime",
      },
    ];
  },
  allowedDevOrigins: ["100.110.219.64"],
};

export default withNextIntl(nextConfig);
