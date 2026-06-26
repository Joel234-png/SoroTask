export function StatCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-slate-700 bg-slate-800/50 p-6">
      <div className="mb-3 h-4 w-24 rounded bg-slate-700" />
      <div className="h-8 w-32 rounded bg-slate-700" />
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-slate-700 bg-slate-800/50 p-6">
      <div className="mb-4 h-4 w-32 rounded bg-slate-700" />
      <div className="h-40 rounded bg-slate-700/70" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-3 rounded-2xl border border-slate-700 bg-slate-800/50 p-6">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-10 rounded bg-slate-700/70" />
      ))}
    </div>
  );
}
