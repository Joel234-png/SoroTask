import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  experimental: {
    useTypeScriptCli: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

// Issue #813: wrap the default config so Sentry's webpack plugin instruments
// client, server, and edge bundles and uploads source maps on build. Runtime
// init lives in sentry.client/server/edge.config.ts; breadcrumbs for wallet
// connection and transaction lifecycle events are captured in
// src/lib/errors/breadcrumbs.ts.
export default withSentryConfig(nextConfig, {
  // Options below are only consulted when the corresponding env vars/org are
  // configured; builds without a Sentry DSN simply skip source-map upload.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
});