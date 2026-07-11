"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { instrumentFetch } from "@/src/lib/errors/fetchTracker";

export function ClientInit() {
  useEffect(() => {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || "",
      tracesSampleRate: 1.0,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
    });
    instrumentFetch();
  }, []);
  return null;
}
