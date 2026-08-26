"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { instrumentFetch } from "@/src/lib/errors/fetchTracker";

export function ClientInit() {
  useEffect(() => {
// Sentry is initialized in sentry.client.config.ts
    instrumentFetch();
  }, []);
  return null;
}
