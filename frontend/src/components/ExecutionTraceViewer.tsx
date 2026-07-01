'use client';

import React from 'react';
import {
  ExecutionTrace,
  ExecutionStepRecord,
  ExecutionStepType,
  EXECUTION_STEP_LABELS,
  getStepResultColor,
  getStepResultTextColor,
  getStepResultBgColor,
  getOutcomeColor,
  getOutcomeBgColor,
  getErrorDetailMessage,
} from '@/src/types/taskExecution';

export interface ExecutionTraceViewerProps {
  trace: ExecutionTrace | null;
  isLoading?: boolean;
}

function StepRow({ record, index, isLast }: { record: ExecutionStepRecord; index: number; isLast: boolean }) {
  const stepLabel = EXECUTION_STEP_LABELS[record.step as ExecutionStepType] || `Step ${record.step}`;
  const errorDetail = record.result === 'Failed' ? getErrorDetailMessage(record.step as ExecutionStepType, record.detail) : null;

  return (
    <div className="relative flex items-start gap-4">
      {/* Connector line */}
      {!isLast && (
        <div className="absolute left-[15px] top-8 bottom-0 w-0.5 bg-neutral-700" />
      )}

      {/* Step indicator dot */}
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${getStepResultColor(record.result)}`}>
        <span className="text-white text-xs font-bold">{index + 1}</span>
      </div>

      {/* Step content */}
      <div className={`flex-1 rounded-lg border p-3 mb-3 ${getStepResultBgColor(record.result)}`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-neutral-100">{stepLabel}</span>
          <span className={`text-xs font-bold uppercase ${getStepResultTextColor(record.result)}`}>
            {record.result}
          </span>
        </div>

        {errorDetail && (
          <div className="mt-2 text-xs text-red-300 bg-red-900/30 rounded px-2 py-1">
            {errorDetail} (code: {record.detail})
          </div>
        )}

        {record.detail !== 0 && !errorDetail && (
          <div className="mt-1 text-xs text-neutral-400">
            Detail: {record.detail}
          </div>
        )}
      </div>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const color = getOutcomeColor(outcome);
  const bgColor = getOutcomeBgColor(outcome);
  return (
    <span className={`px-3 py-1 rounded-full text-sm font-bold ${color} ${bgColor}`}>
      {outcome}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="bg-neutral-900 rounded-lg border border-neutral-800 p-8 text-center">
      <div className="text-4xl mb-3">🔍</div>
      <p className="text-neutral-400">No execution trace available</p>
      <p className="text-xs text-neutral-600 mt-2">
        Traces are captured when a task has been executed at least once.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="bg-neutral-900 rounded-lg border border-neutral-800 p-6">
      <div className="animate-pulse space-y-4">
        <div className="h-6 bg-neutral-800 rounded w-1/3" />
        <div className="h-16 bg-neutral-800 rounded" />
        <div className="h-16 bg-neutral-800 rounded" />
        <div className="h-16 bg-neutral-800 rounded" />
      </div>
    </div>
  );
}

/**
 * ExecutionTraceViewer - Visual debugging interface that shows the
 * step-by-step execution path of a task. Each step is color-coded:
 * green (Passed), red (Failed), gray (Skipped). The exact point of
 * failure is highlighted with error detail.
 */
export const ExecutionTraceViewer: React.FC<ExecutionTraceViewerProps> = ({
  trace,
  isLoading = false,
}) => {
  if (isLoading) return <LoadingState />;
  if (!trace) return <EmptyState />;

  const steps: ExecutionStepRecord[] = trace.steps || [];
  const failedStep = steps.find((s) => s.result === 'Failed');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-neutral-900 rounded-lg border border-neutral-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-neutral-100">Execution Trace</h3>
          <OutcomeBadge outcome={trace.final_outcome} />
        </div>

        <div className="grid grid-cols-3 gap-4 text-xs">
          <div>
            <span className="text-neutral-500">Keeper</span>
            <p className="text-neutral-300 font-mono mt-0.5 truncate" title={trace.keeper}>
              {trace.keeper.slice(0, 16)}...
            </p>
          </div>
          <div>
            <span className="text-neutral-500">Steps</span>
            <p className="text-neutral-300 font-mono mt-0.5">{steps.length}</p>
          </div>
          <div>
            <span className="text-neutral-500">Timestamp</span>
            <p className="text-neutral-300 font-mono mt-0.5">{trace.timestamp}</p>
          </div>
        </div>

        {/* Failure summary banner */}
        {failedStep && (
          <div className="mt-3 bg-red-900/30 border border-red-800 rounded px-3 py-2">
            <p className="text-sm font-semibold text-red-300">Execution Failed</p>
            <p className="text-xs text-red-200 mt-0.5">
              Failed at step &quot;{EXECUTION_STEP_LABELS[failedStep.step as ExecutionStepType] || `Step ${failedStep.step}`}&quot;
              {getErrorDetailMessage(failedStep.step as ExecutionStepType, failedStep.detail)
                ? `: ${getErrorDetailMessage(failedStep.step as ExecutionStepType, failedStep.detail)}`
                : ''}
            </p>
          </div>
        )}
      </div>

      {/* Step timeline */}
      {steps.length > 0 && (
        <div className="bg-neutral-900 rounded-lg border border-neutral-800 p-4">
          <h4 className="text-sm font-semibold text-neutral-200 mb-4">Step Timeline</h4>
          <div className="space-y-0">
            {steps.map((record, i) => (
              <StepRow
                key={`${record.step}-${i}`}
                record={record}
                index={i}
                isLast={i === steps.length - 1}
              />
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="bg-neutral-900 rounded-lg border border-neutral-800 p-3">
        <div className="flex gap-4 text-xs text-neutral-400">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span>Passed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span>Failed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-gray-500" />
            <span>Skipped</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExecutionTraceViewer;
