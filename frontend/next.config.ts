import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  experimental: {
    useTypeScriptCli: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config, { isServer }) => {
    // Enable WASM async module support and streaming
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    // Optimize vendor chunk splitting for heavy crypto/math libraries
    if (!isServer && config.optimization?.splitChunks) {
      config.optimization.splitChunks = {
        ...config.optimization.splitChunks,
        chunks: "all",
        maxInitialRequests: 25,
        minSize: 20000,
        cacheGroups: {
          ...config.optimization.splitChunks.cacheGroups,
          stellar: {
            test: /[\\/]node_modules[\\/](@stellar|stellar-sdk)[\\/]/,
            name: "vendor-stellar",
            priority: 40,
            enforce: true,
          },
          cryptoModules: {
            test: /[\\/]node_modules[\\/](snarkjs|circomlibjs|elliptic|bn\.js)[\\/]/,
            name: "vendor-crypto-zk",
            priority: 35,
            enforce: true,
          },
          charts: {
            test: /[\\/]node_modules[\\/](recharts|d3|d3-[^\\/]+)[\\/]/,
            name: "vendor-charts",
            priority: 30,
            enforce: true,
          },
          graph: {
            test: /[\\/]node_modules[\\/](reactflow|dagre|three)[\\/]/,
            name: "vendor-graph",
            priority: 25,
            enforce: true,
          },
        },
      };
    }

    return config;
  },
};

export default nextConfig;
