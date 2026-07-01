export { ProverEngine } from "./prover-engine";
export { WorkerPool } from "./worker-pool";
export { VerifierClient } from "./verifier-client";
export { ErrorTracker } from "./error-tracker";
export { ZkProofPipeline } from "./pipeline";

export type {
  ZkTask,
  ZkProofPayload,
  ZkProofGenerationOptions,
  ZkProofPhase,
  DiagnosticError,
  PipelineStage,
  PipelineLogEntry,
  ZkProofPipelineState,
  ZkEngineConfig,
  ZkVerificationResult,
} from "./types";
