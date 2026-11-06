import type { NextConfig } from "next";

// React's dev build needs eval for debugging; production never uses it.
const scriptSrc =
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1"],
  // sharp's native binary loads libvips (a separate @img/sharp-libvips-*
  // package on Linux) through the dynamic linker, which file tracing cannot
  // see. Without this, Vercel functions fail with
  // "libvips-cpp.so...: cannot open shared object file".
  outputFileTracingIncludes: {
    "/api/**/*": [
      // glibc Linux only (Vercel's runtime); "linux-" excludes linuxmusl.
      "./node_modules/@img/sharp-libvips-linux-*/**/*",
      "./node_modules/@img/sharp-linux-*/**/*",
    ],
  },
  // Private runtime data and credentials must never enter a function bundle.
  outputFileTracingExcludes: {
    "/*": ["./.local/**/*", "./backups/**/*", "./.env", "./.env.*", "./.git/**/*"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' https://vercel.com https://*.blob.vercel-storage.com; ${scriptSrc}; style-src 'self' 'unsafe-inline'; font-src 'self' data:`,
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
