'use client';

/**
 * useKeeperProfitability Hook
 *
 * Drives the Keeper Profitability scatter plot from a resilient data source.
 * Handles polling, in-flight cancellation, and graceful degradation: the hook
 * always exposes the last good dataset plus an explicit connection status, so
 * the UI keeps rendering through RPC failures and network partitions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createLogger } from '@/src/lib/logger';
import {
  createResilientSource,
  ResilientSource,
} from '@/src/lib/keeper-profitability/resilientSource';
import {
  EconomicsFetcher,
  ProfitabilityResult,
  ResilientSourceConfig,
} from '@/src/lib/keeper-profitability/types';

const logger = createLogger('useKeeperProfitability');

export interface UseKeeperProfitabilityOptions {
  fetcher: EconomicsFetcher;
  config?: Partial<ResilientSourceConfig>;
  /** Auto-refresh interval in ms. Set to 0 to disable polling. */
  pollMs?: number;
  enabled?: boolean;
  /** Test seams forwarded to the resilient source. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

export interface UseKeeperProfitabilityResult {
  result: ProfitabilityResult | null;
  loading: boolean;
  /** Manually trigger a refresh. */
  refresh: () => Promise<void>;
}

const EMPTY: ProfitabilityResult = {
  points: [],
  status: 'offline',
  updatedAt: 0,
  fromCache: false,
  error: null,
  droppedRecords: 0,
  circuitOpen: false,
};

export function useKeeperProfitability(
  options: UseKeeperProfitabilityOptions,
): UseKeeperProfitabilityResult {
  const { fetcher, pollMs = 15_000, enabled = true } = options;

  // Stable key over the source-affecting config so polling restarts only when
  // a meaningful value changes, never on every render.
  const configKey = useMemo(() => JSON.stringify(options.config ?? {}), [options.config]);

  const sourceRef = useRef<ResilientSource | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const [result, setResult] = useState<ProfitabilityResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Recreate the source when fetcher/config changes.
  const source = useMemo(() => {
    const src = createResilientSource({
      fetcher,
      config: options.config,
      sleep: options.sleep,
      random: options.random,
      now: options.now,
    });
    sourceRef.current = src;
    return src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher, configKey]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const next = await source.fetch(controller.signal);
      if (mountedRef.current && !controller.signal.aborted) {
        setResult(next);
        if (next.status !== 'live') {
          logger.warn('Profitability source degraded', {
            status: next.status,
            error: next.error,
          });
        }
      }
    } finally {
      if (mountedRef.current && !controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [enabled, source]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return;

    void refresh();

    if (pollMs > 0) {
      const interval = setInterval(() => void refresh(), pollMs);
      return () => {
        clearInterval(interval);
        abortRef.current?.abort();
      };
    }

    return () => {
      abortRef.current?.abort();
    };
  }, [enabled, pollMs, refresh]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  return { result: enabled ? result : EMPTY, loading, refresh };
}
