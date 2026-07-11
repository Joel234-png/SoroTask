"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useZKProverEngine } from "@/src/hooks/useZKProverEngine";
import { ZKProofStatusBadge } from "./ZKProofStatusBadge";
import { ZKProofLogStream } from "./ZKProofLogStream";
import { ZKProofDiagnosticsPanel } from "./ZKProofDiagnosticsPanel";
import type { ZkTask, ZkProofGenerationOptions } from "@/src/lib/zk-proof";

interface ZKProverPanelProps {
  tasks: ZkTask[];
  walletConnected: boolean;
  walletAddress: string | null;
  onZkVerified: (taskId: number, conditionHash: string) => void;
  onAddLog?: (log: {
    taskId: string;
    target: string;
    keeper: string;
    status: "success" | "failed" | "pending";
    timestamp: string;
  }) => void;
}

export function ZKProverPanel({
  tasks,
  walletConnected,
  walletAddress,
  onZkVerified,
  onAddLog,
}: ZKProverPanelProps) {
  const {
    state,
    isGenerating,
    isVerifying,
    isBusy,
    generateProof,
    verifyProof,
    reset,
    setTasks,
  } = useZKProverEngine();

  const [selectedTaskId, setSelectedTaskId] = useState<number | "">("");
  const [taskCondition, setTaskCondition] = useState<string>(
    '{"minLiquidity": 10000}',
  );
  const [secretData, setSecretData] = useState<string>(
    '{"actualLiquidity": 25000, "salt": "0xfe3a"}',
  );
  const [verifierAddress, setVerifierAddress] = useState<string>(
    "CDVERIFY456789ABCDEF1234567890ABCDEF1234",
  );
  const [simulateCongestion, setSimulateCongestion] = useState(false);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [activeTab, setActiveTab] = useState<"workspace" | "diagnostics">(
    "workspace",
  );

  useEffect(() => {
    setTasks(tasks);
  }, [tasks, setTasks]);

  const selectedTask = tasks.find((t) => t.id === Number(selectedTaskId));

  const handleGenerateProof = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedTaskId) return;

      const options: ZkProofGenerationOptions = {
        taskCondition,
        secretData,
        verifierAddress,
        simulateCongestion,
        simulateFailure,
      };

      try {
        await generateProof(options);
      } catch {
        // Error is captured in pipeline state via error tracker
      }
    },
    [
      selectedTaskId,
      taskCondition,
      secretData,
      verifierAddress,
      simulateCongestion,
      simulateFailure,
      generateProof,
    ],
  );

  const handleVerifyOnChain = useCallback(async () => {
    if (!selectedTaskId || !state.proof) return;

    try {
      const result = await verifyProof(
        state.proof,
        selectedTask?.contractAddress ?? "",
        verifierAddress,
        walletAddress,
        walletConnected,
      );

      if (result.success) {
        onZkVerified(Number(selectedTaskId), result.conditionHash);
        if (onAddLog) {
          onAddLog({
            taskId: `#${selectedTaskId}`,
            target: selectedTask?.contractAddress || "CD123...XYZ",
            keeper: "Freighter Client",
            status: "success",
            timestamp: "Just now",
          });
        }
      }
    } catch {
      // Error is captured in pipeline state
    }
  }, [
    selectedTaskId,
    state.proof,
    selectedTask,
    verifierAddress,
    walletAddress,
    walletConnected,
    verifyProof,
    onZkVerified,
    onAddLog,
  ]);

  const handleCopyReport = useCallback((): string => {
    const report = {
      systemMetadata: {
        timestamp: new Date().toISOString(),
        walletConnected,
        walletAddress,
        userAgent:
          typeof window !== "undefined" ? window.navigator.userAgent : "node",
      },
      taskDetails: selectedTask
        ? {
            id: selectedTask.id,
            contractAddress: selectedTask.contractAddress,
            functionName: selectedTask.functionName,
            gasBalance: selectedTask.gasBalance,
          }
        : "None selected",
      zkParameters: {
        condition: taskCondition,
        verifier: verifierAddress,
      },
      recordedErrors: state.errors,
    };
    return JSON.stringify(report, null, 2);
  }, [
    walletConnected,
    walletAddress,
    selectedTask,
    taskCondition,
    verifierAddress,
    state.errors,
  ]);

  const handleReset = useCallback(() => {
    reset();
    setSelectedTaskId("");
    setTaskCondition('{"minLiquidity": 10000}');
    setSecretData('{"actualLiquidity": 25000, "salt": "0xfe3a"}');
  }, [reset]);

  return (
    <div className="bg-neutral-900/60 backdrop-blur-md border border-neutral-800 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-64 h-64 bg-indigo-600/5 rounded-full blur-3xl pointer-events-none" />

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 border-b border-neutral-800 pb-4 relative z-10">
        <div>
          <h2 className="text-xl font-bold bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent flex items-center gap-2">
            Zero-Knowledge (ZK) Proof Verification
          </h2>
          <p className="text-xs text-neutral-500 mt-1">
            Build privacy-preserving task evaluations using the browser prover engine.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {state.status !== "idle" && (
            <ZKProofStatusBadge
              status={state.status}
              progress={state.progress}
            />
          )}
          <div className="flex items-center bg-neutral-950 p-1 rounded-xl border border-neutral-800">
            <button
              onClick={() => setActiveTab("workspace")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === "workspace"
                  ? "bg-neutral-800 text-neutral-100 shadow-md"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              Workspace
            </button>
            <button
              onClick={() => setActiveTab("diagnostics")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                activeTab === "diagnostics"
                  ? "bg-neutral-800 text-neutral-100 shadow-md"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              Diagnostics
              {state.errors.length > 0 && (
                <span className="bg-red-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                  {state.errors.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {activeTab === "workspace" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 relative z-10">
          <div className="space-y-5">
            <h3 className="text-sm font-semibold text-neutral-300 tracking-wide uppercase">
              1. ZK Generation Setup
            </h3>

            <form onSubmit={handleGenerateProof} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1">
                  Target Automation Task <span className="text-red-400">*</span>
                </label>
                <select
                  value={selectedTaskId}
                  onChange={(e) =>
                    setSelectedTaskId(
                      e.target.value ? Number(e.target.value) : "",
                    )
                  }
                  required
                  className="w-full bg-neutral-950 border border-neutral-800 hover:border-neutral-700 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 rounded-xl px-4 py-2.5 outline-none transition text-sm text-neutral-200"
                >
                  <option value="">-- Choose registered task --</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      Task #{task.id} - {task.functionName} (
                      {task.contractAddress.slice(0, 10)}...)
                    </option>
                  ))}
                </select>
                {tasks.length === 0 && (
                  <p className="text-xs text-amber-400/80 mt-1.5 flex items-center gap-1">
                    No registered tasks available. Create a task first.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1">
                  Private Task Condition (JSON)
                </label>
                <textarea
                  value={taskCondition}
                  onChange={(e) => setTaskCondition(e.target.value)}
                  rows={2}
                  className="w-full bg-neutral-950 border border-neutral-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 rounded-xl px-4 py-2.5 outline-none transition text-xs font-mono text-neutral-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1">
                  Secret Client Data (Isolated)
                </label>
                <textarea
                  value={secretData}
                  onChange={(e) => setSecretData(e.target.value)}
                  rows={2}
                  className="w-full bg-neutral-950 border border-neutral-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 rounded-xl px-4 py-2.5 outline-none transition text-xs font-mono text-neutral-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1">
                  ZK Verifier Address
                </label>
                <input
                  type="text"
                  value={verifierAddress}
                  onChange={(e) => setVerifierAddress(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 rounded-xl px-4 py-2.5 outline-none transition text-xs font-mono text-neutral-300"
                />
              </div>

              <div className="bg-neutral-950 p-4 rounded-2xl border border-neutral-800/80 space-y-3">
                <div className="text-xs font-semibold text-neutral-400 mb-1">
                  QA Simulation Panel
                </div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="congestion-toggle"
                    className="text-xs text-neutral-400"
                  >
                    Simulate Worker Pool Congestion (Latency)
                  </label>
                  <input
                    id="congestion-toggle"
                    type="checkbox"
                    checked={simulateCongestion}
                    onChange={(e) => setSimulateCongestion(e.target.checked)}
                    className="h-4 w-4 rounded bg-neutral-900 border-neutral-700 text-violet-500 focus:ring-violet-500"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="failure-toggle"
                    className="text-xs text-neutral-400 text-red-300/80"
                  >
                    Simulate Computational Proof Failure
                  </label>
                  <input
                    id="failure-toggle"
                    type="checkbox"
                    checked={simulateFailure}
                    onChange={(e) => setSimulateFailure(e.target.checked)}
                    className="h-4 w-4 rounded bg-neutral-900 border-neutral-700 text-red-500 focus:ring-red-500"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isBusy || !selectedTaskId}
                  className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-medium py-3 px-4 rounded-xl shadow-lg hover:shadow-violet-600/20 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {isGenerating ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      Generating Proof on Worker Pool...
                    </span>
                  ) : (
                    "Generate Zero-Knowledge Proof"
                  )}
                </button>
                {state.status !== "idle" && (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="px-4 py-3 rounded-xl border border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700 transition text-sm"
                  >
                    Reset
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="space-y-5 flex flex-col">
            <h3 className="text-sm font-semibold text-neutral-300 tracking-wide uppercase">
              2. Worker Pipeline Logs & On-Chain verification
            </h3>

            <ZKProofLogStream logs={state.logs} />

            {state.proof && (
              <div className="bg-neutral-950 border border-violet-900/30 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-neutral-300">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 bg-green-400 rounded-full shadow-sm animate-pulse" />
                    ZK Proof Generated Successfully
                  </span>
                  <button
                    onClick={() =>
                      navigator.clipboard.writeText(
                        JSON.stringify(state.proof, null, 2),
                      )
                    }
                    className="text-[10px] text-violet-400 hover:text-violet-300"
                  >
                    Copy Proof JSON
                  </button>
                </div>
                <div className="max-h-[120px] overflow-y-auto font-mono text-[10px] text-neutral-400 p-2.5 bg-neutral-900/60 rounded-xl border border-neutral-800">
                  <pre>{JSON.stringify(state.proof, null, 2)}</pre>
                </div>

                <div className="pt-2">
                  <button
                    onClick={handleVerifyOnChain}
                    disabled={isVerifying || state.status === "success"}
                    className={`w-full font-medium py-3 px-4 rounded-xl shadow-lg transition-all text-sm flex items-center justify-center gap-2 ${
                      state.status === "success"
                        ? "bg-green-600 text-white cursor-default"
                        : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white hover:shadow-emerald-600/20 active:scale-[0.99]"
                    }`}
                  >
                    {isVerifying ? (
                      <>
                        <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                        Invoking verify_zk_condition...
                      </>
                    ) : state.status === "success" ? (
                        "Verified & Secured On-Chain"
                    ) : (
                      "Submit & Verify Proof On-Chain"
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <ZKProofDiagnosticsPanel
          errors={state.errors}
          onCopyReport={handleCopyReport}
        />
      )}
    </div>
  );
}
