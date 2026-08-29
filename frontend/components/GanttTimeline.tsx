'use client';

/**
 * GanttTimeline — task execution schedule as a zoomable timeline (issue #873).
 *
 * Grid and list views cannot show overlap or schedule density; this lays every
 * task's executions on a shared time axis so both are visible at a glance.
 *
 * Schedule arithmetic lives in lib/ganttSchedule.ts so it can be tested
 * without rendering.
 */

import React, { useMemo, useState } from 'react';
import type { Task, TaskExecution } from '@/types/task';
import {
  ZOOM_LEVELS,
  STATUS_COLORS,
  buildTimelineRows,
  buildTicks,
  positionPercent,
  type ZoomLevel,
} from '@/lib/ganttSchedule';

interface GanttTimelineProps {
  tasks: Task[];
  /** Historical runs. Anything after `now` is projected from each interval. */
  executions?: TaskExecution[];
  initialZoom?: ZoomLevel;
  onTaskSelect?: (task: Task) => void;
}

/** Axis label formatting, tightened as the window narrows. */
function formatTick(at: number, zoom: ZoomLevel): string {
  const d = new Date(at);
  if (zoom === '1h' || zoom === '6h') {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  if (zoom === '24h') {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function GanttTimeline({
  tasks,
  executions = [],
  initialZoom = '24h',
  onTaskSelect,
}: GanttTimelineProps) {
  const [zoom, setZoom] = useState<ZoomLevel>(initialZoom);

  // Pinned per render pass rather than read inside the loop, so every row is
  // positioned against the same instant — otherwise blocks drift relative to
  // each other and to the "now" marker.
  const now = useMemo(() => Date.now(), [zoom, tasks, executions]);

  const windowMs = ZOOM_LEVELS.find((z) => z.value === zoom)?.windowMs ?? 86_400_000;

  // A quarter of the window behind now, so recent history is visible without
  // the upcoming schedule — the reason to open this view — being squeezed.
  const windowStart = now - windowMs * 0.25;
  const windowEnd = windowStart + windowMs;

  const rows = useMemo(
    () => buildTimelineRows(tasks, executions, windowStart, windowEnd, now),
    [tasks, executions, windowStart, windowEnd, now],
  );

  const ticks = useMemo(() => buildTicks(windowStart, windowEnd), [windowStart, windowEnd]);
  const nowPercent = positionPercent(now, windowStart, windowEnd);

  return (
    <section
      className="rounded-xl border border-slate-700 bg-slate-900 p-4"
      aria-label="Task execution timeline"
    >
      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-100">Execution timeline</h2>

        <div className="flex items-center gap-1" role="group" aria-label="Timeline zoom level">
          {ZOOM_LEVELS.map((level) => (
            <button
              key={level.value}
              type="button"
              onClick={() => setZoom(level.value)}
              aria-pressed={zoom === level.value}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                zoom === level.value
                  ? 'bg-slate-700 text-slate-50'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {level.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mb-4 flex flex-wrap gap-3">
        {(['active', 'pending', 'failed', 'paused'] as const).map((status) => (
          <span key={status} className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className={`h-2.5 w-2.5 rounded-sm ${STATUS_COLORS[status].block}`} />
            {STATUS_COLORS[status].label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-slate-400" />
          Projected
        </span>
      </div>

      {/* Axis */}
      <div className="relative mb-1 ml-44 h-5 border-b border-slate-700">
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute -translate-x-1/2 text-[10px] text-slate-500"
            style={{ left: `${positionPercent(t, windowStart, windowEnd)}%` }}
          >
            {formatTick(t, zoom)}
          </span>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">No tasks to display.</p>
      ) : (
        <div className="relative">
          {/* "Now" marker, drawn across all rows so overlap is readable
              against the present rather than against each row's own history. */}
          <div
            className="pointer-events-none absolute bottom-0 top-0 z-10 ml-44 w-px bg-amber-400/70"
            style={{ left: `calc(${nowPercent}% )` }}
            aria-hidden="true"
          />

          <ul className="space-y-1">
            {rows.map(({ task, blocks, truncated }) => {
              const colors = STATUS_COLORS[task.status];
              return (
                <li key={task.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onTaskSelect?.(task)}
                    disabled={!onTaskSelect}
                    title={`${task.functionName} · ${task.contractAddress}`}
                    className="w-44 shrink-0 truncate rounded px-2 py-1 text-left text-xs text-slate-300 transition-colors enabled:hover:bg-slate-800 enabled:hover:text-slate-100 disabled:cursor-default"
                  >
                    <span className={colors.text}>●</span> {task.functionName}
                  </button>

                  <div
                    className="relative h-6 flex-1 rounded bg-slate-800/60"
                    role="img"
                    aria-label={`${task.functionName}: ${blocks.length} execution${
                      blocks.length === 1 ? '' : 's'
                    } in view, status ${colors.label}${truncated ? ', list truncated' : ''}`}
                  >
                    {blocks.map((b) => (
                      <span
                        key={`${b.taskId}-${b.start}`}
                        // Projections are outlined rather than filled so a
                        // predicted run is never mistaken for one that ran.
                        className={`absolute top-1 h-4 w-1.5 -translate-x-1/2 rounded-sm ${
                          b.isHistorical
                            ? b.outcome === 'failed'
                              ? STATUS_COLORS.failed.block
                              : colors.block
                            : `border border-dashed ${colors.block.replace('bg-', 'border-')} bg-transparent`
                        }`}
                        style={{ left: `${positionPercent(b.start, windowStart, windowEnd)}%` }}
                        title={`${new Date(b.start).toLocaleString()}${
                          b.isHistorical ? ` · ${b.outcome ?? 'ran'}` : ' · projected'
                        }`}
                      />
                    ))}

                    {truncated && (
                      <span className="absolute right-1 top-1 rounded bg-slate-700 px-1 text-[10px] text-slate-300">
                        capped
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="mt-3 text-[11px] text-slate-500">
        Solid blocks are recorded executions; dashed blocks are projected from each
        task&apos;s interval. Paused tasks project no upcoming runs. Rows marked
        <span className="mx-1 rounded bg-slate-700 px-1 text-slate-300">capped</span>
        have more executions in this window than can be usefully drawn.
      </p>
    </section>
  );
}

export default GanttTimeline;
