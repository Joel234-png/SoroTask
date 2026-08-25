"use client";

import React from "react";
import type { SimulationResult } from "@/hooks/useTransactionSimulation";

export interface PreFlightSimulationModalProps {
  isOpen: boolean;
  simulation: SimulationResult | null;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  taskTitle?: string;
}

export function PreFlightSimulationModal({
  isOpen,
  simulation,
  isLoading = false,
  onConfirm,
  onCancel,
  taskTitle = "Task Transaction",
}: PreFlightSimulationModalProps) {
  if (!isOpen) return null;

  const fees = simulation?.itemizedFees;
  const isSuccess = simulation?.success ?? false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="simulation-modal-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-neutral-700 bg-neutral-900 p-6 shadow-2xl space-y-6">
        <header className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <div>
            <h2
              id="simulation-modal-title"
              className="text-lg font-semibold text-neutral-100"
            >
              Pre-Flight Transaction Simulation
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">{taskTitle}</p>
          </div>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              isLoading
                ? "bg-blue-500/10 text-blue-300 border border-blue-500/20"
                : isSuccess
                  ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                  : "bg-rose-500/10 text-rose-300 border border-rose-500/20"
            }`}
          >
            {isLoading
              ? "Simulating RPC..."
              : isSuccess
                ? "Simulation Passed"
                : "Simulation Failed"}
          </span>
        </header>

        {isLoading ? (
          <div className="py-8 flex flex-col items-center justify-center space-y-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <p className="text-xs text-neutral-400">
              Running Soroban RPC <code className="font-mono">simulateTransaction</code>…
            </p>
          </div>
        ) : simulation?.errorMessage ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-200 space-y-2">
            <div className="font-semibold flex items-center gap-1.5 text-rose-100">
              <span>⚠️</span> Simulation Warning / Error
            </div>
            <p>{simulation.errorMessage}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <h3 className="text-xs font-medium uppercase tracking-wider text-neutral-400">
              Itemized Fee Breakdown
            </h3>

            <dl className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-950/60 p-4 text-sm space-y-2.5">
              <div className="flex items-center justify-between pt-1">
                <dt className="text-neutral-400">Network Base Fee (XLM)</dt>
                <dd className="font-mono text-neutral-200">
                  {fees?.networkBaseFeeXlm.toFixed(4)} XLM
                </dd>
              </div>

              <div className="flex items-center justify-between pt-2.5">
                <dt className="text-neutral-400">CPU &amp; Memory Resource Fees</dt>
                <dd className="font-mono text-neutral-200">
                  {fees?.resourceFeeXlm.toFixed(4)} XLM
                </dd>
              </div>

              <div className="flex items-center justify-between pt-2.5">
                <dt className="text-neutral-400">Estimated Task Bounty</dt>
                <dd className="font-mono text-neutral-200">
                  {fees?.estimatedBountyXlm.toFixed(4)} XLM
                </dd>
              </div>

              <div className="flex items-center justify-between pt-2.5">
                <dt className="text-neutral-400">Refundable Storage Deposit</dt>
                <dd className="font-mono text-neutral-200">
                  {fees?.storageDepositXlm.toFixed(4)} XLM
                </dd>
              </div>

              <div className="flex items-center justify-between pt-3 font-semibold text-neutral-100 border-t border-neutral-700/80">
                <dt>Total Estimated Cost</dt>
                <dd className="font-mono text-emerald-400 text-base">
                  {fees?.totalXlm.toFixed(4)} XLM
                </dd>
              </div>
            </dl>

            {simulation?.warningMessage && (
              <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                ℹ️ {simulation.warningMessage}
              </p>
            )}
          </div>
        )}

        <footer className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-medium text-neutral-300 hover:bg-neutral-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isLoading || !isSuccess}
            onClick={onConfirm}
            className={`rounded-xl px-5 py-2 text-xs font-medium transition-colors ${
              !isSuccess || isLoading
                ? "cursor-not-allowed bg-neutral-800 text-neutral-500"
                : "bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-600/20"
            }`}
          >
            Sign in Wallet
          </button>
        </footer>
      </div>
    </div>
  );
}

export default PreFlightSimulationModal;
