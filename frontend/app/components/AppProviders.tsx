"use client";

import { WalletProvider, useWallet } from "@/app/context/WalletContext";
import { WalletConnectionModal } from "@/app/components/WalletConnectionModal";
import { OnboardingProvider } from "@/src/components/onboarding/OnboardingProvider";
import { JankProfilerProvider } from "@/src/components/JankProfilerProvider";
import {
  AccessibilityComplianceProvider,
  AccessibilityComplianceStatus,
} from "@/src/components/accessibility/AccessibilityComplianceProvider";

function WalletConnectModalHost() {
  const { isConnectModalOpen, closeConnectModal } = useWallet();

  return (
    <WalletConnectionModal
      open={isConnectModalOpen}
      onClose={closeConnectModal}
    />
  );
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <JankProfilerProvider>
      <AccessibilityComplianceProvider>
        <WalletProvider>
          <OnboardingProvider>
            {children}
            <AccessibilityComplianceStatus />
            <WalletConnectModalHost />
          </OnboardingProvider>
        </WalletProvider>
      </AccessibilityComplianceProvider>
    </JankProfilerProvider>
  );
}
