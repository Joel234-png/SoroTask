"use client";

import Link from "next/link";
import { FiArrowLeft, FiActivity, FiDatabase } from "react-icons/fi";
import SankeyDiagram from "@/src/components/graph/SankeyDiagram";

export default function TokenomicsPage() {
  return (
    <main className="min-h-screen bg-[#07100f] text-slate-50">
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(135deg,rgba(16,185,129,0.1),transparent_40%),linear-gradient(180deg,#07100f_0%,#091311_100%)]" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.05)_1px,transparent_0)] bg-[length:32px_32px] opacity-40" />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Navigation Header */}
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="inline-flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white transition"
              aria-label="Back to home"
            >
              <FiArrowLeft className="size-5" />
            </Link>
            <div>
              <nav className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
                SoroTask Systems Control
              </nav>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-white sm:text-4xl">
                Tokenomics Simulator
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
              <FiActivity className="animate-pulse" /> Live Flow calculations
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
              <FiDatabase /> Local Simulation
            </span>
          </div>
        </header>

        {/* Feature Grid Layout */}
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          {/* Main Diagram */}
          <div className="space-y-6">
            <SankeyDiagram width={800} height={520} />
          </div>

          {/* Sidebar Docs/Controls */}
          <section className="flex flex-col gap-6">
            {/* Info panel */}
            <article className="rounded-2xl border border-white/10 bg-slate-900/40 p-6 backdrop-blur">
              <h3 className="text-base font-bold text-white mb-3">Sankey Architecture</h3>
              <p className="text-sm leading-6 text-slate-300">
                Sankey diagrams visualize the distribution flow of tokens across protocols, DAO pools, team vestings, and staking rewards pools.
              </p>
              <div className="mt-4 border-t border-white/10 pt-4 space-y-3">
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Concurrent mode</h4>
                  <p className="text-xs text-slate-300 mt-1">
                    Filters the node structure concurrently in React, maintaining 120 FPS animations during inputs.
                  </p>
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Resilience</h4>
                  <p className="text-xs text-slate-300 mt-1">
                    Cyclic tokenomics loops are isolated into feedback lists to maintain a clean layout without layout freeze cycles.
                  </p>
                </div>
              </div>
            </article>

            {/* Quick tips */}
            <article className="rounded-2xl border border-white/10 bg-slate-900/40 p-6 backdrop-blur">
              <h3 className="text-base font-bold text-white mb-2">Workspace Controls</h3>
              <ul className="text-xs text-slate-300 space-y-2 list-disc pl-4 mt-2">
                <li>Toggle dataset models via top-right panel button controls.</li>
                <li>Drag nodes vertically to customized locations.</li>
                <li>Hover over links to display detailed transfer volumes.</li>
                <li>Filter specific nodes with the text input search bar.</li>
              </ul>
            </article>
          </section>
        </div>
      </div>
    </main>
  );
}
