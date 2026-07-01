import type { Metadata } from "next";
import "./globals.css";
import { CommandPalette } from "@/components/CommandPalette";
import { AppProviders } from "@/app/components/AppProviders";
import { AIAssistantProvider } from "@/components/AIAssistant";

export const metadata: Metadata = {
  title: "SoroTask Frontend Performance Monitoring",
  description:
    "Track route load, task open, search, and mutation responsiveness in the SoroTask frontend.",
};

// Runs before first paint to avoid theme flash
const themeScript = `
(function(){
  try {
    var m = localStorage.getItem('theme') || 'system';
    var resolved = m === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : m;
    document.documentElement.setAttribute('data-theme', resolved);
  } catch(e){}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AIAssistantProvider>
          <AppProviders>
            <CommandPalette />
            {children}
          </AppProviders>
        </AIAssistantProvider>
        {/* Initialize Sentry and fetch instrumentation on client */}
        <ClientInit />
      </body>
    </html>
  );
}

/**
 * Client-side initialization for Sentry and error tracking
 * Must be a separate client component to use useEffect
 */
"use client";

import { useEffect } from "react";
import * as Sentry from "@/src/lib/errors/sentry";
import { instrumentFetch } from "@/src/lib/errors/fetchTracker";

function ClientInit() {
  useEffect(() => {
    // Instrument fetch API for tracking
    instrumentFetch();

    // Initialize Sentry if available (file-based config handles setup)
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      console.log("Sentry error tracking enabled");
    }

    // Track app initialization
    Sentry.addSentryBreadcrumb("lifecycle", "Application initialized", {
      userAgent: navigator.userAgent,
      language: navigator.language,
    });
  }, []);

  return null;
}
