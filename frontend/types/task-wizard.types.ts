export interface TaskWizardFormData {
  targetContractId: string;
  functionName: string;
  functionArgs: string; // JSON string representation
  cronInterval: string; // e.g. "0 * * * *"
  gasDeposit: string; // XLM or Stroops amount
}

export interface SimulationResult {
  success: boolean;
  minResourceFee: string;
  estimatedCpuInstructions: number;
  estimatedMemoryBytes: number;
  errorMessage?: string;
}

export enum WizardStep {
  TARGET_CONTRACT = 1,
  FUNCTION_AND_ARGS = 2,
  TRIGGER_AND_SIMULATION = 3,
  GAS_DEPOSIT = 4,
}