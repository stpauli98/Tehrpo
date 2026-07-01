import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Default je 1 MB; dokumenti/fotografije lako pređu. Klijent dodatno ograničava na 10 MB.
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
