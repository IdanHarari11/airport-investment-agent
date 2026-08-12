import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the repository focused on the assignment deliverables.
  agentRules: false,
  // Never expose server secrets to the browser bundle.
  // Only variables prefixed with NEXT_PUBLIC_ are inlined client-side (we use none for keys).
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), microphone=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
