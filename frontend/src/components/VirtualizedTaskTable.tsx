'use client';

import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export interface Task {
  id: string;
  title: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  assignee: string;
  createdAt: string;
}

interface VirtualizedTaskTableProps {
  tasks: Task[];
  onTaskClick?: (taskId: string) => void;
}

const STATUS_BADGE_CLASSES: Record<Task['status'], string> = {
  PENDING: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  IN_PROGRESS: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  COMPLETED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  CANCELLED: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
};

export const VirtualizedTaskTable: React.FC<VirtualizedTaskTableProps> = ({
  tasks,
  onTaskClick,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);

  // Configure TanStack React Virtual for fixed/estimate row height
  const rowVirtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52, // Expected row height in pixels
    overscan: 5, // Extra rows rendered above/below viewport for smooth scrolling
  });

  return (
    <div className="w-full border border-slate-800 rounded-lg overflow-hidden bg-slate-900 shadow-xl">
      {/* Table Header */}
      <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-slate-950 border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider select-none">
        <div className="col-span-4">Task Title</div>
        <div className="col-span-2">Status</div>
        <div className="col-span-2">Priority</div>
        <div className="col-span-2">Assignee</div>
        <div className="col-span-2 text-right">Created</div>
      </div>

      {/* Scrollable Virtualized Container */}
      <div
        ref={parentRef}
        className="h-[600px] overflow-y-auto contain-strict relative scrollbar-thin scrollbar-thumb-slate-700"
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const task = tasks[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                onClick={() => onTaskClick?.(task.id)}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="grid grid-cols-12 gap-4 px-6 py-3 items-center border-b border-slate-800/60 hover:bg-slate-800/50 transition-colors cursor-pointer text-sm text-slate-200"
              >
                <div className="col-span-4 font-medium truncate text-slate-100">
                  {task.title}
                </div>
                <div className="col-span-2">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                      STATUS_BADGE_CLASSES[task.status]
                    }`}
                  >
                    {task.status}
                  </span>
                </div>
                <div className="col-span-2 text-slate-300 text-xs font-mono">
                  {task.priority}
                </div>
                <div className="col-span-2 text-slate-400 truncate text-xs">
                  {task.assignee}
                </div>
                <div className="col-span-2 text-right text-slate-500 text-xs font-mono">
                  {new Date(task.createdAt).toLocaleDateString()}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};