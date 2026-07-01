/**
 * useBackgroundSync
 *
 * Primary React hook for consuming Background Sync state and actions.
 *
 * ```tsx
 * const { isOnline, isSyncing, enqueue, getActions, pendingCount } = useBackgroundSync();
 * ```
 */

"use client";

import { useSyncContext } from "@/src/context/SyncContext";
import type {
  QueuedSyncAction,
  SyncStatus,
  ConnectionQuality,
} from "./SyncContext";
import type {
  SyncOperationType,
  SyncPayload,
} from "@/src/lib/sync/types";

export function useBackgroundSync(): {
  state: ReturnType<typeof useSyncContext>["state"];
  isOnline: boolean;
  isSyncing: boolean;
  connectionQuality: ConnectionQuality;
  syncStatus: SyncStatus;
  pendingCount: number;
  failedCount: number;
  inFlightCount: number;
  metrics: {
    totalActionsProcessed: number;
    successfulActions: number;
    failedActions: number;
    averageLatencyMs: number | null;
    oldestPendingAgeMs: number | null;
  };
  lastSyncAt: number | null;

  enqueue: <T extends SyncOperationType>(
    type: T,
    payload: Extract<SyncPayload, { type: never } & { [K in T]: any }>[T],
    priority?: number,
  ) => QueuedSyncAction | undefined;
  retry: (actionId: string) => void;
  cancel: (actionId: string) => void;
  clearCompleted: () => void;
  flush: () => Promise<void>;
  refresh: () => void;
  getActions: () => readonly QueuedSyncAction[];
} {
  const store = useSyncContext();

  return {
    state: store.state,
    isOnline: store.state.network.online,
    isSyncing: store.state.status === "syncing",
    connectionQuality: store.state.network.quality,
    syncStatus: store.state.status,
    pendingCount: store.state.pendingCount,
    failedCount: store.state.failedCount,
    inFlightCount: store.state.inFlightCount,
    metrics: store.state.metrics,
    lastSyncAt: store.state.lastSyncAt,
    enqueue: store.enqueue as any,
    retry: store.retry,
    cancel: store.cancel,
    clearCompleted: store.clearCompleted,
    flush: store.flush,
    refresh: store.refresh,
    getActions: store.getActions,
  };
}
