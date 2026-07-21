import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Keep the live dev router cache isolated from `next build`. Nx tests depend
  // on the production build target and may run while the local dev server is
  // open; sharing `.next` makes nested App Router pages disappear until restart.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: {
    root: path.resolve(import.meta.dirname, "../.."),
  },
  async redirects() {
    const legacyPlatformTabs = [
      ["admins", "administrators"],
      ["custom", "parameters"],
      ["defaults", "localization"],
      ["messaging", "services"],
      ["profile", "general"],
      ["roles", "roles"],
      ["smtp", "email"],
    ] as const;

    return [
      ...legacyPlatformTabs.map(([tab, section]) => ({
        destination: `/platform/settings/${section}`,
        has: [{ key: "tab", type: "query" as const, value: tab }],
        permanent: false,
        source: "/platform/settings",
      })),
      {
        destination: "/platform/settings/general",
        permanent: false,
        source: "/platform/settings",
      },
      {
        destination: "/settings/workspace/general",
        permanent: false,
        source: "/settings/workspace",
      },
    ];
  },
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
