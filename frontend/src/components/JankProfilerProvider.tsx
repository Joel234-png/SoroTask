"use client";

import { useJankProfiler } from "@/src/hooks/useJankProfiler";
import { usePathname } from "next/navigation";

type JankProfilerProviderProps = {
  children: React.ReactNode;
  enabled?: boolean;
};

export function JankProfilerProvider({
  children,
  enabled = process.env.NEXT_PUBLIC_JANK_PROFILER_ENABLED !== "0",
}: JankProfilerProviderProps) {
  const pathname = usePathname();

  useJankProfiler({
    route: pathname ?? "/",
    autoStart: enabled,
    sampleRate: Number(process.env.NEXT_PUBLIC_JANK_SAMPLE_RATE ?? "1"),
  });

  return <>{children}</>;
}
