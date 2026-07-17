import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Keep the live dev router cache isolated from `next build`. Nx tests depend
  // on the production build target and may run while the local dev server is
  // open; sharing `.next` makes nested App Router pages disappear until restart.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
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
