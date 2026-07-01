"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMainThreadProfiler,
  JANK_EVENT_NAME,
  readBufferedJankReports,
  resetMainThreadProfiler,
  type JankReport,
  type ProfilerSnapshot,
} from "@/src/lib/performance";

type UseJankProfilerOptions = {
  route?: string;
  autoStart?: boolean;
  sampleRate?: number;
};

export function useJankProfiler(options: UseJankProfilerOptions = {}) {
  const { route = "/", autoStart = true, sampleRate } = options;
  const profilerRef = useRef(
    getMainThreadProfiler({ route, sampleRate }),
  );
  const [snapshot, setSnapshot] = useState<ProfilerSnapshot>(() => ({
    jankReports: [],
    frameStats: null,
    longTaskCount: 0,
    isMonitoring: false,
  }));

  const refresh = useCallback(() => {
    setSnapshot(profilerRef.current.getSnapshot());
  }, []);

  useEffect(() => {
    if (autoStart && typeof window !== "undefined") {
      profilerRef.current.start();
      refresh();
    }

    const handleJank = () => refresh();
    window.addEventListener(JANK_EVENT_NAME, handleJank);

    return () => {
      window.removeEventListener(JANK_EVENT_NAME, handleJank);
      profilerRef.current.stop();
    };
  }, [autoStart, refresh]);

  const start = useCallback(() => {
    profilerRef.current.start();
    refresh();
  }, [refresh]);

  const stop = useCallback(() => {
    profilerRef.current.stop();
    refresh();
  }, [refresh]);

  const measureInteraction = useCallback(
    async <T>(label: string, action: () => T | Promise<T>) => {
      const outcome = await profilerRef.current.measureInteraction(label, action);
      refresh();
      return outcome;
    },
    [refresh],
  );

  const getReports = useCallback((): JankReport[] => {
    return readBufferedJankReports();
  }, []);

  return {
    snapshot,
    start,
    stop,
    measureInteraction,
    getReports,
    refresh,
    reset: resetMainThreadProfiler,
  };
}
