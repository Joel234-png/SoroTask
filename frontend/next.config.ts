import type { NextConfig } from "next";
import {createNextIntlPlugin} from "next-intl/plugin";

const nextConfig: NextConfig = {
  experimental: {
    useTypeScriptCli: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default createNextIntlPlugin()(nextConfig);
