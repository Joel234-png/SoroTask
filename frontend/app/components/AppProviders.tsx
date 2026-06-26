"use client";

import { OnboardingProvider } from "@/src/components/onboarding/OnboardingProvider";
import { JankProfilerProvider } from "@/src/components/JankProfilerProvider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <JankProfilerProvider>
      <OnboardingProvider>{children}</OnboardingProvider>
    </JankProfilerProvider>
  );
}
