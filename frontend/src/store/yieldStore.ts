import { create } from "zustand";
import { calculateYieldForecast, YieldConfig, YieldProjectionPoint } from "../lib/yield/calculator";

interface YieldStoreState {
  // Inputs
  principal: number;
  apr: number;
  frequency: "daily" | "weekly" | "monthly" | "annually";
  durationYears: number;
  gasFeePerTx: number;
  keeperFeePerTx: number;
  multiplier: number;

  // Outputs
  projections: YieldProjectionPoint[];
  finalSimple: number;
  finalCompound: number;
  finalNetCompound: number;
  totalFeesPaid: number;
  depleted: boolean;
  warnings: string[];

  // Actions
  setInputs: (inputs: Partial<YieldConfig>) => void;
  runForecast: () => void;
  reset: () => void;
}

const defaultInputs: YieldConfig = {
  principal: 1000,
  apr: 15,
  frequency: "monthly",
  durationYears: 2,
  gasFeePerTx: 0.1,
  keeperFeePerTx: 0.5,
  multiplier: 1.0,
};

export const useYieldStore = create<YieldStoreState>((set, get) => ({
  ...defaultInputs,
  projections: [],
  finalSimple: 0,
  finalCompound: 0,
  finalNetCompound: 0,
  totalFeesPaid: 0,
  depleted: false,
  warnings: [],

  setInputs: (newInputs) => {
    set((state) => ({ ...state, ...newInputs }));
    get().runForecast();
  },

  runForecast: () => {
    const {
      principal,
      apr,
      frequency,
      durationYears,
      gasFeePerTx,
      keeperFeePerTx,
      multiplier,
    } = get();

    const result = calculateYieldForecast({
      principal,
      apr,
      frequency,
      durationYears,
      gasFeePerTx,
      keeperFeePerTx,
      multiplier,
    });

    set({
      projections: result.projections,
      finalSimple: result.finalSimple,
      finalCompound: result.finalCompound,
      finalNetCompound: result.finalNetCompound,
      totalFeesPaid: result.totalFeesPaid,
      depleted: result.depleted,
      warnings: result.warnings,
    });
  },

  reset: () => {
    set({
      ...defaultInputs,
      projections: [],
      finalSimple: 0,
      finalCompound: 0,
      finalNetCompound: 0,
      totalFeesPaid: 0,
      depleted: false,
      warnings: [],
    });
    get().runForecast();
  },
}));
