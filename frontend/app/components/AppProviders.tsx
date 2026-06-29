"use client";

import { OnboardingProvider } from "@/src/components/onboarding/OnboardingProvider";
import {
  AccessibilityComplianceProvider,
  AccessibilityComplianceStatus,
} from "@/src/components/accessibility/AccessibilityComplianceProvider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AccessibilityComplianceProvider>
      <OnboardingProvider>
        {children}
        <AccessibilityComplianceStatus />
      </OnboardingProvider>
    </AccessibilityComplianceProvider>
  );
}
