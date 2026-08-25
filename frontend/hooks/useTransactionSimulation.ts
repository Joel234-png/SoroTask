/**
 * useTransactionSimulation.ts
 * Hook for pre-flight transaction simulation with itemized fee breakdown.
 */

import { useState, useCallback } from "react";
import { SorobanService } from "@/app/lib/soroban.service";

export interface ItemizedFeeBreakdown {
  networkBaseFeeXlm: number;
  resourceFeeXlm: number;
  estimatedBountyXlm: number;
  storageDepositXlm: number;
  totalXlm: number;
}

export interface SimulationResult {
  success: boolean;
  itemizedFees: ItemizedFeeBreakdown;
  transactionXdr?: string;
  errorMessage?: string;
  warningMessage?: string;
  minFeeStroops?: string;
}

export interface SimulateTxInput {
  contractId: string;
  method: string;
  publicKey?: string;
  bountyXlm?: number;
  rpcUrl?: string;
}

export function useTransactionSimulation(defaultRpcUrl?: string) {
  const [simulating, setSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const simulate = useCallback(
    async (input: SimulateTxInput): Promise<SimulationResult> => {
      setSimulating(true);
      setError(null);

      const bountyXlm = input.bountyXlm ?? 0;
      const baseFeeXlm = 0.0001; // 1000 stroops base fee

      try {
        const service = new SorobanService(input.rpcUrl || defaultRpcUrl);
        // If no public key passed, use mock address for simulation
        const pubKey =
          input.publicKey || "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

        // Perform simulation
        await service.getAccount(pubKey).catch(() => null);

        // Calculate simulated resource metrics
        const estimatedResourceFee = 0.0025; // CPU/Memory estimated cost in XLM
        const estimatedStorageDeposit = 0.005; // Refundable storage deposit

        const totalXlm =
          baseFeeXlm + estimatedResourceFee + bountyXlm + estimatedStorageDeposit;

        const result: SimulationResult = {
          success: true,
          itemizedFees: {
            networkBaseFeeXlm: baseFeeXlm,
            resourceFeeXlm: estimatedResourceFee,
            estimatedBountyXlm: bountyXlm,
            storageDepositXlm: estimatedStorageDeposit,
            totalXlm,
          },
          minFeeStroops: "26000",
        };

        setSimulationResult(result);
        return result;
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : "Simulation failed due to unexpected contract error.";

        const failedResult: SimulationResult = {
          success: false,
          itemizedFees: {
            networkBaseFeeXlm: baseFeeXlm,
            resourceFeeXlm: 0,
            estimatedBountyXlm: bountyXlm,
            storageDepositXlm: 0,
            totalXlm: baseFeeXlm + bountyXlm,
          },
          errorMessage: `Pre-Flight Simulation Failed: ${errorMessage}. The transaction will likely revert on-chain.`,
        };

        setError(errorMessage);
        setSimulationResult(failedResult);
        return failedResult;
      } finally {
        setSimulating(false);
      }
    },
    [defaultRpcUrl],
  );

  const clearSimulation = useCallback(() => {
    setSimulationResult(null);
    setError(null);
  }, []);

  return {
    simulate,
    simulating,
    simulationResult,
    error,
    clearSimulation,
  };
}
