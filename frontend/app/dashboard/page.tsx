import { Suspense } from "react";
import { DashboardClient } from "./DashboardClient";
import { StatCardSkeleton, ChartSkeleton, TableSkeleton } from "@/components/skeletons";
import { getDashboardServerData } from "@/src/lib/rsc/server-data";

async function DashboardContent() {
  const data = await getDashboardServerData();

import WidgetGrid from "@/components/WidgetGrid";
import { TaskExecutionHeatmapEngine } from "@/src/components/TaskExecutionHeatmapEngine";
import { RPCNodeHealthDashboard } from "@/src/components/rpc/RPCNodeHealthDashboard";
import { useRPCHealthStore } from "@/src/store/rpcHealthStore";

import { useEffect, useMemo, useState } from "react";

type WidgetStatus = "loading" | "empty" | "error" | "success";
type WidgetSize = "small" | "medium" | "large";

type WidgetDefinition = {
  id: string;
  title: string;
  description: string;
  defaultSize: WidgetSize;
  getStatus: () => WidgetStatus;
  render: () => JSX.Element;
};

const widgetRegistry: Record<string, WidgetDefinition> = {
  volume: {
    id: "volume",
    title: "Daily Volume",
    description: "Track total processed volume over the last 24h.",
    defaultSize: "large",
    getStatus: () => "success",
    render: () => (
      <div className="space-y-3">
        <p className="text-3xl font-semibold text-slate-100">$2.41M</p>
        <p className="text-sm text-emerald-300">+12.3% vs yesterday</p>
      </div>
    ),
  },
  keeperHealth: {
    id: "keeperHealth",
    title: "Keeper Health",
    description: "Heartbeat and execution reliability overview.",
    defaultSize: "medium",
    getStatus: () => "success",
    render: () => (
      <div className="space-y-2 text-sm text-slate-200">
        <p>Healthy keepers: 9/10</p>
        <p>Failed executions: 0.8%</p>
      </div>
    ),
  },
  failedTasks: {
    id: "failedTasks",
    title: "Failed Tasks",
    description: "Tasks requiring intervention.",
    defaultSize: "small",
    getStatus: () => "empty",
    render: () => (
      <p className="text-sm text-slate-300">No failed tasks detected.</p>
    ),
  },
  bridgeLatency: {
    id: "bridgeLatency",
    title: "Bridge Latency",
    description: "Cross-network median latency.",
    defaultSize: "small",
    getStatus: () => "loading",
    render: () => (
      <p className="text-sm text-slate-300">Measuring live latency...</p>
    ),
  },
  alertFeed: {
    id: "alertFeed",
    title: "Alert Feed",
    description: "Recent critical incidents and warnings.",
    defaultSize: "medium",
    getStatus: () => "error",
    render: () => (
      <p className="text-sm text-slate-300">
        Alert stream is temporarily unavailable. Retry shortly.
      </p>
    ),
  },
  executionHeatmap: {
    id: "executionHeatmap",
    title: "Execution Success Rate",
    description:
      "Heatmap of task execution success rates across all active tasks.",
    defaultSize: "large",
    getStatus: () => "success" as const,
    render: () => (
      <TaskExecutionHeatmapEngine
        fetchData={() =>
          Promise.resolve({
            periodLabel: "Last 7 days",
            fetchedAt: new Date().toISOString(),
            cells: [
              {
                id: "harvest",
                label: "Harvest",
                successRate: 98,
                totalExecutions: 200,
                status: "success" as const,
              },
              {
                id: "rebalance",
                label: "Rebalance",
                successRate: 72,
                totalExecutions: 50,
                status: "warning" as const,
              },
              {
                id: "rotate",
                label: "Rotate",
                successRate: 40,
                totalExecutions: 30,
                status: "failure" as const,
              },
              {
                id: "topup",
                label: "Top-up",
                successRate: 91,
                totalExecutions: 120,
                status: "success" as const,
              },
              {
                id: "pause",
                label: "Pause",
                successRate: 0,
                totalExecutions: 0,
                status: "empty" as const,
              },
            ],
          })
        }
        maxRetries={3}
        retryDelayMs={500}
      />
    ),
  },
  rpcHealth: {
    id: "rpcHealth",
    title: "RPC Node Health",
    description: "Monitor RPC endpoint health with off-main-thread processing.",
    defaultSize: "large",
    getStatus: () => {
      try {
        const status = useRPCHealthStore.getState().overallStatus;
        if (status === "healthy") return "success";
        if (status === "degraded") return "loading";
        return "error";
      } catch {
        return "loading";
      }
    },
    render: () => <RPCNodeHealthDashboard />,
  },
};

export default function DashboardPage() {
  return (
    <>
      <header data-onboarding="dashboard" className="mb-8 flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-slate-100">
          Analytics Dashboard
        </h1>
        <p className="text-sm text-slate-300">
          Drag cards to reorder them, or toggle widgets to personalize your
          workspace.
        </p>
        <p className="text-xs text-slate-500">
          Last updated: {new Date(data.lastUpdated).toLocaleString()}
        </p>
      </header>

      <DashboardClient initialData={data} />
    </>
  );
}

export default function DashboardPage() {
  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Suspense
        fallback={
          <div className="space-y-6">
            <StatCardSkeleton />
            <ChartSkeleton />
            <TableSkeleton rows={6} />
          </div>
        }
      >
        <DashboardContent />
      </Suspense>
      <WidgetGrid widgetRegistry={widgetRegistry} />
    </main>
  );
}
