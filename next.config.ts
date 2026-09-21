import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security/csp";

const DEV = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The dev server is reached as 127.0.0.1 (NEXT_PUBLIC_SITE_URL); Next warns otherwise.
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    // The static set for every response, including the cron routes the proxy
    // does not match. The CSP itself carries a per-request nonce and is set
    // by proxy.ts (MILESTONES.md §4 decision 51).
    return [
      {
        source: "/(.*)",
        headers: Object.entries(securityHeaders({ dev: DEV })).map(([key, value]) => ({ key, value })),
      },
    ];
  },
};

export default nextConfig;
