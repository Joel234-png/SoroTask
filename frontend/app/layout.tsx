import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CommandPalette } from "@/components/CommandPalette";
import { AppProviders } from "@/app/components/AppProviders";
import { AIAssistantProvider } from "@/components/AIAssistant";
import { ClientInit } from "./ClientInit";
import { ErrorBoundary } from "@sentry/nextjs";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "next-themes";
import enMessages from "@/i18n/translations/en.json";

function GlobalErrorFallback({ error, resetError }: any) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-900 text-neutral-100">
      <h2 className="text-xl font-bold mb-4">Something went wrong!</h2>
      <button onClick={resetError} className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-500">Try again</button>
    </div>
  );
}

export const metadata: Metadata = {
  title: "SoroTask Frontend Performance Monitoring",
  description:
    "Track route load, task open, search, and mutation responsiveness in the SoroTask frontend.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SoroTask",
  },
  icons: {
    icon: "/icons/icon-192x192.png",
    apple: "/icons/icon-192x192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};



export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ErrorBoundary fallback={GlobalErrorFallback}>
          <NextIntlClientProvider messages={enMessages} locale="en">
            <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
              <AIAssistantProvider>
                <AppProviders>
                  <CommandPalette />
                  {children}
                </AppProviders>
              </AIAssistantProvider>
            </ThemeProvider>
          </NextIntlClientProvider>
        </ErrorBoundary>
        {/* Initialize Sentry and fetch instrumentation on client */}
        <ClientInit />
      </body>
    </html>
  );
}