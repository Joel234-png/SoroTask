"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProverEngine } from "@/src/lib/zk-proof";
import type {
  ZkTask,
  ZkProofPayload,
  ZkProofGenerationOptions,
  ZkVerificationResult,
  ZkProofPipelineState,
  ZkEngineConfig,
} from "@/src/lib/zk-proof";

export type { ZkEngineConfig };

const DEFAULT_CONFIG: ZkEngineConfig = {
  workerCount: 4,
  maxRetries: 3,
  baseDelayMs: 800,
  congestionMultiplier: 3,
};

export interface UseZKProverEngineReturn {
  engine: ProverEngine;
  state: ZkProofPipelineState;
  isGenerating: boolean;
  isVerifying: boolean;
  isBusy: boolean;
  generateProof: (options: ZkProofGenerationOptions) => Promise<ZkProofPayload>;
  verifyProof: (
    proof: ZkProofPayload,
    contractAddress: string,
    verifierAddress: string,
    walletAddress: string | null,
    walletConnected: boolean,
  ) => Promise<ZkVerificationResult>;
  reset: () => void;
  setTasks: (tasks: ZkTask[]) => void;
  workerStats: { idle: number; busy: number; total: number; queued: number };
}

export function useZKProverEngine(
  config: Partial<ZkEngineConfig> = {},
): UseZKProverEngineReturn {
  const mergedConfig = useMemo(() => ({ ...DEFAULT_CONFIG, ...config }), [config]);
  const engineRef = useRef<ProverEngine | null>(null);
  const [state, setState] = useState<ZkProofPipelineState>({
    status: "idle",
    proof: null,
    logs: [],
    errors: [],
    currentStage: "idle",
    progress: 0,
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  if (!engineRef.current) {
    engineRef.current = new ProverEngine({
      config: mergedConfig,
      onStateChange: () => {
        if (engineRef.current) {
          setState({ ...engineRef.current.pipeline.getState() });
        }
      },
    });
  }

  const engine = engineRef.current;

  useEffect(() => {
    return () => {
      engine.shutdown();
    };
  }, [engine]);

  const generateProof = useCallback(
    async (options: ZkProofGenerationOptions): Promise<ZkProofPayload> => {
      setIsGenerating(true);
      try {
        const proof = await engine.generateProof(options);
        return proof;
      } finally {
        setIsGenerating(false);
      }
    },
    [engine],
  );

  const verifyProof = useCallback(
    async (
      proof: ZkProofPayload,
      contractAddress: string,
      verifierAddress: string,
      walletAddress: string | null,
      walletConnected: boolean,
    ): Promise<ZkVerificationResult> => {
      setIsVerifying(true);
      try {
        const result = await engine.verifyProof(
          proof,
          contractAddress,
          verifierAddress,
          walletAddress,
          walletConnected,
        );
        return result;
      } finally {
        setIsVerifying(false);
      }
    },
    [engine],
  );

  const reset = useCallback(() => {
    engine.pipeline.reset();
    setIsGenerating(false);
    setIsVerifying(false);
  }, [engine]);

  const setTasks = useCallback(
    (tasks: ZkTask[]) => {
      engine.setTasks(tasks);
    },
    [engine],
  );

  const isBusy = isGenerating || isVerifying;

  const workerStats = useMemo(() => engine.getWorkerPoolStats(), [engine]);

  return {
    engine,
    state,
    isGenerating,
    isVerifying,
    isBusy,
    generateProof,
    verifyProof,
    reset,
    setTasks,
    workerStats,
  };
}
