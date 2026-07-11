import {
  createOptimisticTransaction,
  reconcileOptimisticTransactions,
  summarizeOptimisticTransactions,
} from "../optimisticTxReconciler";

const baseTime = Date.parse("2026-06-29T12:00:00.000Z");

describe("optimisticTxReconciler", () => {
  it("confirms a matching optimistic transaction with server state", () => {
    const optimistic = createOptimisticTransaction({
      clientTxId: "client-1",
      taskId: "task-1",
      operation: "register_task",
      txHash: "hash-1",
      optimisticPayload: {
        status: "pending",
        contract: "CABC",
        secret: "hidden",
      },
      createdAt: baseTime,
    });

    const result = reconcileOptimisticTransactions({
      transactions: [optimistic],
      confirmations: [
        {
          taskId: "task-1",
          operation: "register_task",
          txHash: "hash-1",
          status: "confirmed",
          serverPayload: { status: "active", contract: "CABC" },
          observedAt: baseTime + 1_000,
        },
      ],
      now: baseTime + 1_000,
    });

    expect(result.transactions[0]).toMatchObject({
      state: "confirmed",
      confirmedPayload: { status: "active", contract: "CABC" },
    });
    expect(result.auditEvents[0]).toMatchObject({
      code: "confirmed",
      clientTxId: "client-1",
      taskId: "task-1",
      retriable: false,
    });
    expect(result.auditEvents[0].redactedPayload).toMatchObject({
      status: "active",
      contract: "CABC",
    });
  });

  it("rolls back a failed transaction and redacts sensitive optimistic fields", () => {
    const optimistic = createOptimisticTransaction({
      clientTxId: "client-2",
      taskId: "task-2",
      operation: "update_task",
      txHash: "hash-2",
      optimisticPayload: {
        intervalSec: 60,
        privateKey: "do-not-log",
      },
      rollbackPayload: {
        intervalSec: 300,
      },
      createdAt: baseTime,
    });

    const result = reconcileOptimisticTransactions({
      transactions: [optimistic],
      confirmations: [
        {
          taskId: "task-2",
          operation: "update_task",
          txHash: "hash-2",
          status: "failed",
          error: "tx_bad_seq",
          observedAt: baseTime + 2_000,
        },
      ],
      now: baseTime + 2_000,
    });

    expect(result.transactions[0]).toMatchObject({
      state: "rolled_back",
      rollbackPayload: { intervalSec: 300 },
      error: "tx_bad_seq",
    });
    expect(result.auditEvents[0].redactedPayload).toMatchObject({
      intervalSec: 300,
    });
    expect(JSON.stringify(result.auditEvents)).not.toContain("do-not-log");
  });

  it("detects conflicts when a confirmation does not match the optimistic payload", () => {
    const optimistic = createOptimisticTransaction({
      clientTxId: "client-3",
      taskId: "task-3",
      operation: "update_task",
      txHash: "hash-3",
      optimisticPayload: { intervalSec: 900 },
      createdAt: baseTime,
      compareKeys: ["intervalSec"],
    });

    const result = reconcileOptimisticTransactions({
      transactions: [optimistic],
      confirmations: [
        {
          taskId: "task-3",
          operation: "update_task",
          txHash: "hash-3",
          status: "confirmed",
          serverPayload: { intervalSec: 60 },
          observedAt: baseTime + 3_000,
        },
      ],
      now: baseTime + 3_000,
    });

    expect(result.transactions[0]).toMatchObject({
      state: "conflict",
      conflictKeys: ["intervalSec"],
    });
    expect(result.auditEvents[0]).toMatchObject({
      code: "conflict",
      retriable: false,
    });
  });

  it("marks stale optimistic transactions for fallback review", () => {
    const optimistic = createOptimisticTransaction({
      clientTxId: "client-4",
      taskId: "task-4",
      operation: "delete_task",
      txHash: "hash-4",
      optimisticPayload: { deleted: true },
      createdAt: baseTime,
    });

    const result = reconcileOptimisticTransactions({
      transactions: [optimistic],
      confirmations: [],
      now: baseTime + 10 * 60 * 1000,
      staleAfterMs: 5 * 60 * 1000,
    });

    expect(result.transactions[0]).toMatchObject({
      state: "stale",
      staleAt: baseTime + 10 * 60 * 1000,
    });
    expect(result.auditEvents[0]).toMatchObject({
      code: "stale",
      retriable: true,
    });
  });

  it("summarizes reconciler health for UI surfaces", () => {
    const transactions = [
      createOptimisticTransaction({
        clientTxId: "client-5",
        taskId: "task-5",
        operation: "register_task",
        optimisticPayload: {},
        createdAt: baseTime,
      }),
      {
        ...createOptimisticTransaction({
          clientTxId: "client-6",
          taskId: "task-6",
          operation: "update_task",
          optimisticPayload: {},
          createdAt: baseTime,
        }),
        state: "conflict" as const,
      },
    ];

    expect(summarizeOptimisticTransactions(transactions)).toEqual({
      optimistic: 1,
      confirmed: 0,
      rolled_back: 0,
      conflict: 1,
      stale: 0,
    });
  });
});
