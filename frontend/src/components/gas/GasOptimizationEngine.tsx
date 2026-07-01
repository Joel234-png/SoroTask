"use client";

import React, { useState } from "react";
import { useGasOptimizationStore } from "../../store/gasOptimizationStore";
import {
  FiCpu,
  FiZap,
  FiClock,
  FiLayers,
  FiRefreshCw,
  FiPlay,
  FiAlertCircle,
  FiCheckCircle,
} from "react-icons/fi";

export default function GasOptimizationEngine() {
  const {
    congestionLevel,
    baseFee,
    activeTxCount,
    feeTiers,
    bestHourUtc,
    potentialOffpeakSavingsPercent,
    batchOpportunities,
    isSimulating,
    simulationResult,
    refreshMetrics,
    runSimulation,
    applyBatching,
  } = useGasOptimizationStore();

  const [simContractId, setSimContractId] = useState("CC7G...X24");
  const [simMethod, setSimMethod] = useState("claim_yield");

  function handleSimulate(e: React.FormEvent) {
    e.preventDefault();
    runSimulation(simContractId, simMethod);
  }

  // Get color for congestion levels
  const congestionColors = {
    low: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
    medium: "text-sky-400 bg-sky-400/10 border-sky-400/20",
    high: "text-rose-400 bg-rose-400/10 border-rose-400/20",
  };

  return (
    <div
      className="grid gap-6 lg:grid-cols-[1fr_360px] rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-2xl backdrop-blur-md"
      data-testid="gas-optimization-engine-container"
    >
      {/* Main Gas Optimization cockpit */}
      <section className="space-y-6">
        {/* Real-time network metrics banner */}
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/5 bg-slate-950/40 p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-400">
              <FiCpu className="size-5" />
            </span>
            <div>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Network Congestion</p>
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                Soroban Mainnet
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                    congestionColors[congestionLevel] || "text-slate-300 bg-slate-500/10"
                  }`}
                  data-testid="congestion-badge"
                >
                  {congestionLevel.toUpperCase()}
                </span>
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-xs text-slate-400">Base Gas Fee</p>
              <p className="text-xl font-bold font-mono text-white">{baseFee} XLM</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Active Queue</p>
              <p className="text-xl font-bold font-mono text-white">{activeTxCount} txs</p>
            </div>
            <button
              onClick={refreshMetrics}
              className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-300 hover:bg-white/10 hover:text-white transition"
              title="Refresh gas estimates"
              type="button"
            >
              <FiRefreshCw className="size-4" />
            </button>
          </div>
        </header>

        {/* Speed tier options cards */}
        <div className="grid gap-3 sm:grid-cols-3">
          {feeTiers.map((tier) => {
            const icons = {
              fast: <FiZap className="text-amber-300" />,
              standard: <FiClock className="text-sky-300" />,
              "safe-low": <FiClock className="text-slate-400" />,
            };
            return (
              <div
                key={tier.tier}
                className="rounded-xl border border-white/5 bg-slate-950/40 p-4 flex flex-col justify-between h-[110px]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{tier.tier}</span>
                  {icons[tier.tier]}
                </div>
                <div className="mt-4">
                  <p className="text-lg font-bold font-mono text-white">{tier.baseFeeXlm} XLM</p>
                  <p className="text-[10px] text-slate-400 mt-1">Est. arrival: {tier.etaSeconds}s</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Scheduled Optimizer & Batch opportunities */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Scheduling recommendations */}
          <article className="rounded-xl border border-white/5 bg-slate-950/40 p-5 flex flex-col justify-between">
            <div>
              <h4 className="text-sm font-bold text-white mb-2 flex items-center gap-1.5">
                <FiClock className="text-amber-400" />
                Schedule Advisor
              </h4>
              <p className="text-xs leading-5 text-slate-300">
                Network demand dips during off-peak times. Run scheduled automations at night to minimize gas consumption.
              </p>
            </div>
            <div className="mt-4 border-t border-white/5 pt-4">
              <p className="text-xs text-slate-400">
                Recommended Slot: <span className="font-bold text-emerald-400">{bestHourUtc}:00 UTC</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Potential Savings: <span className="font-bold text-emerald-400">-{potentialOffpeakSavingsPercent}%</span>
              </p>
            </div>
          </article>

          {/* Batching suggestions */}
          <article className="rounded-xl border border-white/5 bg-slate-950/40 p-5 flex flex-col justify-between">
            <div>
              <h4 className="text-sm font-bold text-white mb-2 flex items-center gap-1.5">
                <FiLayers className="text-sky-400" />
                Multi-call Batcher
              </h4>
              <p className="text-xs leading-5 text-slate-300">
                We detected multiple separate contract calls that can be grouped into single multi-call payloads to bypass base transaction overheads.
              </p>
            </div>
            <div className="mt-4 space-y-2">
              {batchOpportunities.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No batchable transactions remaining.</p>
              ) : (
                batchOpportunities.map((opportunity) => (
                  <div
                    key={opportunity.id}
                    className="flex items-center justify-between rounded bg-white/5 p-2 text-xs border border-white/5"
                  >
                    <div>
                      <p className="font-bold text-slate-300">{opportunity.methodsCount} calls to {opportunity.contractId}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Save {opportunity.potentialSavingXlm} XLM base fee</p>
                    </div>
                    <button
                      onClick={() => applyBatching(opportunity.id)}
                      className="rounded bg-sky-400 text-slate-950 px-2 py-1 text-[10px] font-bold hover:bg-sky-300"
                    >
                      Batch
                    </button>
                  </div>
                ))
              )}
            </div>
          </article>
        </div>
      </section>

      {/* Interactive dry-run simulator panel */}
      <section className="rounded-xl border border-white/10 bg-slate-950/40 p-5 flex flex-col gap-4">
        <div>
          <h4 className="text-sm font-bold text-white flex items-center gap-2">
            <FiPlay className="text-emerald-400" />
            Transaction Gas Simulator
          </h4>
          <p className="text-xs text-slate-400 mt-0.5">Simulate calls to verify code gas footprint.</p>
        </div>

        <form onSubmit={handleSimulate} className="space-y-3">
          <div>
            <label htmlFor="simContractId" className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Contract ID</label>
            <input
              id="simContractId"
              type="text"
              required
              value={simContractId}
              onChange={(e) => setSimContractId(e.target.value)}
              className="w-full rounded bg-slate-900 border border-white/10 px-3 py-1.5 text-xs text-white focus:border-emerald-400 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="simMethod" className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Method Name</label>
            <input
              id="simMethod"
              type="text"
              required
              value={simMethod}
              onChange={(e) => setSimMethod(e.target.value)}
              className="w-full rounded bg-slate-900 border border-white/10 px-3 py-1.5 text-xs text-white focus:border-emerald-400 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={isSimulating}
            className="w-full rounded bg-emerald-400 text-slate-950 py-2 text-xs font-bold hover:bg-emerald-300 disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {isSimulating ? (
              <>
                <span className="size-3.5 animate-spin rounded-full border border-slate-950 border-t-transparent" />
                Simulating...
              </>
            ) : (
              <>Simulate Dry Run</>
            )}
          </button>
        </form>

        {/* Simulation readouts */}
        {simulationResult && (
          <div
            className={`rounded-xl border p-4 text-xs ${
              simulationResult.status === "success"
                ? "border-emerald-500/20 bg-emerald-500/5 text-slate-200"
                : "border-rose-500/20 bg-rose-500/5 text-slate-200"
            }`}
            data-testid="simulation-readout"
          >
            <div className="flex items-center gap-1.5 font-bold mb-2">
              {simulationResult.status === "success" ? (
                <>
                  <FiCheckCircle className="text-emerald-400" />
                  <span className="text-emerald-400">Simulation Succeeded</span>
                </>
              ) : (
                <>
                  <FiAlertCircle className="text-rose-400" />
                  <span className="text-rose-400">Simulation Failed</span>
                </>
              )}
            </div>

            {simulationResult.status === "success" ? (
              <div className="space-y-2 font-mono text-[10px]">
                <p>Hash: {simulationResult.txHash}</p>
                <p>Gas consumed: {simulationResult.gasConsumed.toLocaleString()} units</p>
                <p>Fee cost: {simulationResult.feePaidXlm} XLM</p>
                <p>Events emitted: {simulationResult.eventsCount}</p>
              </div>
            ) : (
              <div className="space-y-2 font-mono text-[10px]">
                <p className="text-rose-300 font-bold">{simulationResult.errorMessage}</p>
                <p>Diagnostics: execution halted due to gas limit exhaustion or transaction assert fail.</p>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
