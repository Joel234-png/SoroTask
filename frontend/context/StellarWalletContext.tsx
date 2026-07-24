import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import {
  StellarWalletsKit,
  WalletNetwork,
  ALLOW_ALL_MODULES,
  FREIGHTER_ID,
  ALBEDO_ID,
  XBULL_ID,
  LOBSTR_ID,
} from '@stellar/wallet-kit';

interface WalletState {
  address: string | null;
  walletId: string | null;
  network: WalletNetwork;
  isConnected: boolean;
}

interface StellarWalletContextType extends WalletState {
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  switchNetwork: (network: WalletNetwork) => void;
  kit: StellarWalletsKit | null;
}

const STORAGE_KEY = 'stellar_wallet_session';

const StellarWalletContext = createContext<StellarWalletContextType | undefined>(
  undefined,
);

export const StellarWalletProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [network, setNetwork] = useState<WalletNetwork>(WalletNetwork.TESTNET);
  const [walletState, setWalletState] = useState<WalletState>({
    address: null,
    walletId: null,
    network: WalletNetwork.TESTNET,
    isConnected: false,
  });
  const [kit, setKit] = useState<StellarWalletsKit | null>(null);

  // Initialize StellarWalletsKit instance
  useEffect(() => {
    const walletKit = new StellarWalletsKit({
      network,
      selectedWalletId: FREIGHTER_ID,
      modules: ALLOW_ALL_MODULES,
    });

    setKit(walletKit);
  }, [network]);

  // Restore persisted session on mount
  useEffect(() => {
    if (!kit) return;

    const savedSession = localStorage.getItem(STORAGE_KEY);
    if (savedSession) {
      try {
        const { address, walletId, savedNetwork } = JSON.parse(savedSession);
        if (address && walletId) {
          kit.setWallet(walletId);
          setWalletState({
            address,
            walletId,
            network: savedNetwork || WalletNetwork.TESTNET,
            isConnected: true,
          });
        }
      } catch (err) {
        console.error('Failed to restore wallet session:', err);
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, [kit]);

  const connectWallet = useCallback(async () => {
    if (!kit) return;

    try {
      await kit.openModal({
        onWalletSelected: async (option) => {
          kit.setWallet(option.id);
          const { address } = await kit.getAddress();

          const newState = {
            address,
            walletId: option.id,
            network,
            isConnected: true,
          };

          setWalletState(newState);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
        },
      });
    } catch (error) {
      console.error('Error connecting to wallet:', error);
    }
  }, [kit, network]);

  const disconnectWallet = useCallback(async () => {
    if (kit) {
      await kit.disconnect();
    }
    setWalletState({
      address: null,
      walletId: null,
      network,
      isConnected: false,
    });
    localStorage.removeItem(STORAGE_KEY);
  }, [kit, network]);

  const switchNetwork = useCallback(
    (newNetwork: WalletNetwork) => {
      setNetwork(newNetwork);
      setWalletState((prev) => {
        const updated = { ...prev, network: newNetwork };
        if (prev.isConnected) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        }
        return updated;
      });
    },
    [],
  );

  return (
    <StellarWalletContext.Provider
      value={{
        ...walletState,
        connectWallet,
        disconnectWallet,
        switchNetwork,
        kit,
      }}
    >
      {children}
    </StellarWalletContext.Provider>
  );
};

export const useStellarWallet = () => {
  const context = useContext(StellarWalletContext);
  if (!context) {
    throw new Error(
      'useStellarWallet must be used within a StellarWalletProvider',
    );
  }
  return context;
};