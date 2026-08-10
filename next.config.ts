import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Server Actions handle all mutations in this app; raise the body limit so
    // document metadata + inline attachments can be posted.
    serverActions: { bodySizeLimit: "4mb" },
  },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
