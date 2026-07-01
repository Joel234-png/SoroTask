"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { PrefetchManager } from "@/src/lib/predictive-prefetch/prefetch-manager";
import { DEFAULT_PREFETCH_CONFIG } from "@/src/lib/predictive-prefetch/types";
import type { PrefetchConfig, PrefetchItem, PrefetchMetrics, PredictionResult, FlowSession } from "@/src/lib/predictive-prefetch/types";

interface UsePredictivePrefetchOptions {
  config?: Partial<PrefetchConfig>;
  prefetchFn?: (route: string) => void;
  enabled?: boolean;
}

interface UsePredictivePrefetchReturn {
  predictions: PredictionResult | null;
  prefetchItems: PrefetchItem[];
  metrics: PrefetchMetrics;
  session: FlowSession | null;
  isReady: boolean;
  error: string | null;
  reset: () => void;
  manager: PrefetchManager | null;
}

export function usePredictivePrefetch(
  options: UsePredictivePrefetchOptions = {},
): UsePredictivePrefetchReturn {
  const { config, prefetchFn, enabled = true } = options;
  const pathname = usePathname();
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<PredictionResult | null>(null);
  const [prefetchItems, setPrefetchItems] = useState<PrefetchItem[]>([]);
  const [metrics, setMetrics] = useState<PrefetchMetrics>({
    totalPredictions: 0,
    successfulPrefetches: 0,
    failedPrefetches: 0,
    cacheHits: 0,
    cacheMisses: 0,
    visitedPredictions: 0,
    predictionAccuracy: 0,
    averageConfidence: 0,
    workerSupported: typeof Worker !== "undefined",
  });
  const [session, setSession] = useState<FlowSession | null>(null);

  const managerRef = useRef<PrefetchManager | null>(null);
  const previousPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      managerRef.current?.destroy();
      managerRef.current = null;
      setIsReady(false);
      return;
    }

    try {
      if (!managerRef.current) {
        const defaultPrefetchFn = prefetchFn || (() => {});
        const manager = new PrefetchManager(defaultPrefetchFn, config);
        managerRef.current = manager;

        manager.subscribe((event) => {
          if (event.type === "prediction") {
            const pred = manager.getLastPrediction();
            if (pred) setPredictions(pred);
          }
          setPrefetchItems(manager.getPrefetchItems());
          setMetrics(manager.getMetrics());
          setSession(manager.getSession());
        });

        setIsReady(true);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize prefetch manager");
      setIsReady(false);
    }

    return () => {
      if (!enabled) return;
    };
  }, [enabled, config, prefetchFn]);

  useEffect(() => {
    if (!managerRef.current || !enabled) return;

    try {
      const prev = previousPathRef.current;

      if (prev !== null && prev !== pathname) {
        managerRef.current.recordNavigation(prev, pathname);
        managerRef.current.runPrediction().then((result) => {
          setPredictions(result);
          setPrefetchItems(managerRef.current?.getPrefetchItems() || []);
          setMetrics(managerRef.current?.getMetrics() || metrics);
        });
      } else if (prev === null) {
        managerRef.current.recordPageLoad(pathname);
      }

      managerRef.current.markRouteVisited(pathname);
      setMetrics(managerRef.current.getMetrics());
      setSession(managerRef.current.getSession());

      previousPathRef.current = pathname;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Navigation tracking failed");
    }
  }, [pathname, enabled]);

  const reset = useMemo(() => {
    return () => {
      managerRef.current?.reset();
      setPredictions(null);
      setPrefetchItems([]);
      setError(null);
    };
  }, []);

  return {
    predictions,
    prefetchItems,
    metrics,
    session,
    isReady,
    error,
    reset,
    manager: managerRef.current,
  };
}
