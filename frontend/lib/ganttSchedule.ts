/**
 * Schedule projection for the Gantt timeline (issue #873).
 *
 * Kept separate from the component so the arithmetic — which is where the
 * bugs live — is testable without rendering anything.
 */

import type { Task, TaskExecution, TaskStatus } from '@/types/task';

export type ZoomLevel = '1h' | '6h' | '24h' | '7d' | '30d';

export const ZOOM_LEVELS: { value: ZoomLevel; label: string; windowMs: number }[] = [
  { value: '1h', label: '1 hour', windowMs: 60 * 60 * 1000 },
  { value: '6h', label: '6 hours', windowMs: 6 * 60 * 60 * 1000 },
  { value: '24h', label: '24 hours', windowMs: 24 * 60 * 60 * 1000 },
  { value: '7d', label: '7 days', windowMs: 7 * 24 * 60 * 60 * 1000 },
  { value: '30d', label: '30 days', windowMs: 30 * 24 * 60 * 60 * 1000 },
];

/**
 * Cap on projected blocks per task.
 *
 * A task running every 30 seconds over a 30-day window projects ~86,000
 * executions. Rendering those is both useless — they are sub-pixel at that
 * zoom — and enough DOM to lock the tab. Past the cap the row is marked
 * `truncated` so the UI can say so rather than silently lying about density.
 */
export const MAX_BLOCKS_PER_TASK = 300;

export interface ScheduleBlock {
  taskId: string;
  /** Milliseconds since epoch. */
  start: number;
  /** Whether this block already happened. */
  isHistorical: boolean;
  /** Outcome for historical blocks; projections have none yet. */
  outcome?: 'success' | 'failed' | 'pending';
}

export interface TaskRow {
  task: Task;
  blocks: ScheduleBlock[];
  /** True when projection hit MAX_BLOCKS_PER_TASK and stopped early. */
  truncated: boolean;
}

/** Tailwind classes per status, matching the palette the issue specifies. */
export const STATUS_COLORS: Record<TaskStatus, { block: string; label: string; text: string }> = {
  active: { block: 'bg-green-500', label: 'Active', text: 'text-green-400' },
  pending: { block: 'bg-blue-500', label: 'Pending', text: 'text-blue-400' },
  failed: { block: 'bg-red-500', label: 'Failed', text: 'text-red-400' },
  paused: { block: 'bg-gray-500', label: 'Paused', text: 'text-gray-400' },
  // Not in the issue's list, but the type has five variants and an unhandled
  // one would render as an invisible block.
  completed: { block: 'bg-slate-600', label: 'Completed', text: 'text-slate-400' },
};

/**
 * Project a task's execution times across `[windowStart, windowEnd]`.
 *
 * Paused tasks project nothing: a paused automation has no upcoming runs, and
 * drawing them would overstate scheduled load. Its history still renders.
 */
export function projectExecutions(
  task: Task,
  windowStart: number,
  windowEnd: number,
): { starts: number[]; truncated: boolean } {
  const intervalMs = task.interval * 1000;

  // A non-positive interval would make the loop below never advance. Treat it
  // as unschedulable rather than hanging the render.
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return { starts: [], truncated: false };
  }
  if (task.status === 'paused' || task.status === 'completed') {
    return { starts: [], truncated: false };
  }

  const anchor = task.nextExecutionTime?.getTime() ?? task.createdAt.getTime();
  if (!Number.isFinite(anchor)) return { starts: [], truncated: false };

  // Step forward from the anchor to the first occurrence inside the window,
  // arithmetically rather than by looping — an anchor months in the past would
  // otherwise cost millions of iterations before producing anything visible.
  let first = anchor;
  if (anchor < windowStart) {
    const missed = Math.ceil((windowStart - anchor) / intervalMs);
    first = anchor + missed * intervalMs;
  }

  const starts: number[] = [];
  for (let t = first; t <= windowEnd; t += intervalMs) {
    if (starts.length >= MAX_BLOCKS_PER_TASK) {
      return { starts, truncated: true };
    }
    starts.push(t);
  }
  return { starts, truncated: false };
}

/**
 * Build the rendered rows for a set of tasks.
 *
 * Historical executions come from real records; anything after `now` is a
 * projection. The two are distinguished so the UI can render certainty
 * differently from prediction.
 */
export function buildTimelineRows(
  tasks: Task[],
  executions: TaskExecution[],
  windowStart: number,
  windowEnd: number,
  now: number = Date.now(),
): TaskRow[] {
  const historyByTask = new Map<string, TaskExecution[]>();
  for (const e of executions) {
    const at = e.executedAt.getTime();
    if (at < windowStart || at > windowEnd) continue;
    historyByTask.set(e.taskId, [...(historyByTask.get(e.taskId) ?? []), e]);
  }

  return tasks.map((task) => {
    const blocks: ScheduleBlock[] = (historyByTask.get(task.id) ?? []).map((e) => ({
      taskId: task.id,
      start: e.executedAt.getTime(),
      isHistorical: true,
      outcome: e.status,
    }));

    // Project only forward of now; the past is covered by real records, and
    // overlaying a projection on top would double-count executions that
    // actually happened.
    const projectFrom = Math.max(windowStart, now);
    if (projectFrom <= windowEnd) {
      const { starts, truncated } = projectExecutions(task, projectFrom, windowEnd);
      for (const start of starts) {
        blocks.push({ taskId: task.id, start, isHistorical: false });
      }
      blocks.sort((a, b) => a.start - b.start);
      return { task, blocks, truncated };
    }

    blocks.sort((a, b) => a.start - b.start);
    return { task, blocks, truncated: false };
  });
}

/** Position of a timestamp within the window, as a 0–100 percentage. */
export function positionPercent(at: number, windowStart: number, windowEnd: number): number {
  const span = windowEnd - windowStart;
  if (span <= 0) return 0;
  return ((at - windowStart) / span) * 100;
}

/** Evenly spaced tick marks for the time axis. */
export function buildTicks(windowStart: number, windowEnd: number, count = 6): number[] {
  const span = windowEnd - windowStart;
  if (span <= 0 || count < 2) return [windowStart];
  const step = span / (count - 1);
  return Array.from({ length: count }, (_, i) => windowStart + i * step);
}
