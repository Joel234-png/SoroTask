"use client";

import React, { createContext, useContext, type ReactNode } from "react";
import { useZKProverEngine } from "@/src/hooks/useZKProverEngine";
import type {
  ZkEngineConfig,
  UseZKProverEngineReturn,
} from "@/src/hooks/useZKProverEngine";

const ZKProverEngineContext = createContext<UseZKProverEngineReturn | null>(null);

interface ZKProverProviderProps {
  config?: Partial<ZkEngineConfig>;
  children: ReactNode;
}

export function ZKProverProvider({ config, children }: ZKProverProviderProps) {
  const engine = useZKProverEngine(config);

  return (
    <ZKProverEngineContext.Provider value={engine}>
      {children}
    </ZKProverEngineContext.Provider>
  );
}

export function useZKProverEngineContext(): UseZKProverEngineReturn {
  const ctx = useContext(ZKProverEngineContext);
  if (!ctx) {
    throw new Error(
      "useZKProverEngineContext must be used within a ZKProverProvider",
    );
  }
  return ctx;
}
