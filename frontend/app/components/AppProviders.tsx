"use client";

import { WalletProvider, useWallet } from "@/app/context/WalletContext";
import { WalletConnectionModal } from "@/app/components/WalletConnectionModal";
import { OnboardingProvider } from "@/src/components/onboarding/OnboardingProvider";

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
    <WalletProvider>
      <OnboardingProvider>
        {children}
        <WalletConnectModalHost />
      </OnboardingProvider>
    </WalletProvider>
  );
}
