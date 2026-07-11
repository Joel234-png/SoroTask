"use client";

import { RPCNodeHealthDashboard } from "@/src/components/rpc/RPCNodeHealthDashboard";

export default function RPCHealthPage() {
  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold text-slate-100">
          RPC Node Health Monitor
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Real-time health monitoring of RPC endpoints using off-main-thread
          processing.
        </p>
      </header>
      <RPCNodeHealthDashboard />
    </main>
  );
}
