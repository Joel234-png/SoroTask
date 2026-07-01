export type OptimisticTxState =
  | "optimistic"
  | "confirmed"
  | "rolled_back"
  | "conflict"
  | "stale";

export type OptimisticTxOperation =
  | "register_task"
  | "update_task"
  | "delete_task"
  | "execute_task"
  | "custom";

export type OptimisticTxPayload = Record<string, unknown>;

export type OptimisticTransaction = {
  clientTxId: string;
  taskId: string;
  operation: OptimisticTxOperation;
  state: OptimisticTxState;
  txHash?: string;
  optimisticPayload: OptimisticTxPayload;
  rollbackPayload?: OptimisticTxPayload;
  confirmedPayload?: OptimisticTxPayload;
  compareKeys?: string[];
  createdAt: number;
  updatedAt: number;
  confirmedAt?: number;
  rolledBackAt?: number;
  staleAt?: number;
  error?: string;
  conflictKeys?: string[];
};

export type TransactionConfirmation = {
  taskId: string;
  operation: OptimisticTxOperation;
  txHash?: string;
  status: "confirmed" | "failed";
  serverPayload?: OptimisticTxPayload;
  error?: string;
  observedAt: number;
};

export type OptimisticTxAuditCode =
  | "confirmed"
  | "rolled_back"
  | "conflict"
  | "stale";

export type OptimisticTxAuditEvent = {
  code: OptimisticTxAuditCode;
  clientTxId: string;
  taskId: string;
  operation: OptimisticTxOperation;
  retriable: boolean;
  timestamp: number;
  message: string;
  redactedPayload: OptimisticTxPayload;
};

export type ReconcileOptimisticTransactionsInput = {
  transactions: OptimisticTransaction[];
  confirmations: TransactionConfirmation[];
  now?: number;
  staleAfterMs?: number;
};

export type ReconcileOptimisticTransactionsResult = {
  transactions: OptimisticTransaction[];
  auditEvents: OptimisticTxAuditEvent[];
};

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;
const SENSITIVE_KEY_PATTERN = /(secret|private|seed|token|signature|credential|password|xdr)/i;

export function createOptimisticTransaction(input: {
  clientTxId: string;
  taskId: string;
  operation: OptimisticTxOperation;
  optimisticPayload: OptimisticTxPayload;
  rollbackPayload?: OptimisticTxPayload;
  txHash?: string;
  compareKeys?: string[];
  createdAt?: number;
}): OptimisticTransaction {
  const createdAt = input.createdAt ?? Date.now();
  return {
    clientTxId: input.clientTxId,
    taskId: input.taskId,
    operation: input.operation,
    state: "optimistic",
    txHash: input.txHash,
    optimisticPayload: input.optimisticPayload,
    rollbackPayload: input.rollbackPayload,
    compareKeys: input.compareKeys,
    createdAt,
    updatedAt: createdAt,
  };
}

export function summarizeOptimisticTransactions(
  transactions: OptimisticTransaction[],
): Record<OptimisticTxState, number> {
  return transactions.reduce<Record<OptimisticTxState, number>>(
    (summary, transaction) => {
      summary[transaction.state] += 1;
      return summary;
    },
    {
      optimistic: 0,
      confirmed: 0,
      rolled_back: 0,
      conflict: 0,
      stale: 0,
    },
  );
}

function redactPayload(payload: OptimisticTxPayload | undefined): OptimisticTxPayload {
  if (!payload) return {};

  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : value,
    ]),
  );
}

function confirmationMatchesTransaction(
  transaction: OptimisticTransaction,
  confirmation: TransactionConfirmation,
): boolean {
  if (transaction.taskId !== confirmation.taskId) return false;
  if (transaction.operation !== confirmation.operation) return false;
  if (transaction.txHash && confirmation.txHash && transaction.txHash !== confirmation.txHash) {
    return false;
  }
  return true;
}

function getConflictKeys(
  transaction: OptimisticTransaction,
  serverPayload: OptimisticTxPayload | undefined,
): string[] {
  if (!serverPayload) return [];
  const compareKeys = transaction.compareKeys ?? [];

  return compareKeys.filter((key) => {
    if (!(key in transaction.optimisticPayload) || !(key in serverPayload)) return false;
    return transaction.optimisticPayload[key] !== serverPayload[key];
  });
}

function makeAuditEvent(input: {
  code: OptimisticTxAuditCode;
  transaction: OptimisticTransaction;
  retriable: boolean;
  timestamp: number;
  message: string;
  payload?: OptimisticTxPayload;
}): OptimisticTxAuditEvent {
  return {
    code: input.code,
    clientTxId: input.transaction.clientTxId,
    taskId: input.transaction.taskId,
    operation: input.transaction.operation,
    retriable: input.retriable,
    timestamp: input.timestamp,
    message: input.message,
    redactedPayload: redactPayload(input.payload),
  };
}

export function reconcileOptimisticTransactions({
  transactions,
  confirmations,
  now = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
}: ReconcileOptimisticTransactionsInput): ReconcileOptimisticTransactionsResult {
  const auditEvents: OptimisticTxAuditEvent[] = [];

  const nextTransactions = transactions.map((transaction) => {
    if (transaction.state !== "optimistic" && transaction.state !== "stale") {
      return transaction;
    }

    const confirmation = confirmations.find((candidate) =>
      confirmationMatchesTransaction(transaction, candidate),
    );

    if (confirmation?.status === "failed") {
      const rolledBack: OptimisticTransaction = {
        ...transaction,
        state: "rolled_back",
        error: confirmation.error,
        updatedAt: confirmation.observedAt,
        rolledBackAt: confirmation.observedAt,
      };
      auditEvents.push(
        makeAuditEvent({
          code: "rolled_back",
          transaction: rolledBack,
          retriable: true,
          timestamp: confirmation.observedAt,
          message: confirmation.error ?? "Optimistic transaction failed and was rolled back.",
          payload: transaction.rollbackPayload ?? transaction.optimisticPayload,
        }),
      );
      return rolledBack;
    }

    if (confirmation?.status === "confirmed") {
      const conflictKeys = getConflictKeys(transaction, confirmation.serverPayload);
      if (conflictKeys.length > 0) {
        const conflicted: OptimisticTransaction = {
          ...transaction,
          state: "conflict",
          confirmedPayload: confirmation.serverPayload,
          conflictKeys,
          updatedAt: confirmation.observedAt,
          confirmedAt: confirmation.observedAt,
        };
        auditEvents.push(
          makeAuditEvent({
            code: "conflict",
            transaction: conflicted,
            retriable: false,
            timestamp: confirmation.observedAt,
            message: `Server confirmation conflicted on: ${conflictKeys.join(", ")}.`,
            payload: confirmation.serverPayload,
          }),
        );
        return conflicted;
      }

      const confirmed: OptimisticTransaction = {
        ...transaction,
        state: "confirmed",
        confirmedPayload: confirmation.serverPayload,
        updatedAt: confirmation.observedAt,
        confirmedAt: confirmation.observedAt,
      };
      auditEvents.push(
        makeAuditEvent({
          code: "confirmed",
          transaction: confirmed,
          retriable: false,
          timestamp: confirmation.observedAt,
          message: "Optimistic transaction matched confirmed server state.",
          payload: confirmation.serverPayload ?? transaction.optimisticPayload,
        }),
      );
      return confirmed;
    }

    if (transaction.state === "optimistic" && now - transaction.createdAt > staleAfterMs) {
      const stale: OptimisticTransaction = {
        ...transaction,
        state: "stale",
        updatedAt: now,
        staleAt: now,
      };
      auditEvents.push(
        makeAuditEvent({
          code: "stale",
          transaction: stale,
          retriable: true,
          timestamp: now,
          message: "Optimistic transaction exceeded the reconciliation window.",
          payload: transaction.optimisticPayload,
        }),
      );
      return stale;
    }

    return transaction;
  });

  return {
    transactions: nextTransactions,
    auditEvents,
  };
}
