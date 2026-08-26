'use client';

import React from 'react';
import type { WizardStep, ResolutionAction } from '../types';

interface WizardStepCardProps {
  step: WizardStep;
  stepNumber: number;
  totalSteps: number;
  onApply: (patch?: ResolutionAction['patch']) => void;
  onSkip: () => void;
}

const CATEGORY_ICON: Record<string, string> = {
  INSUFFICIENT_GAS: '⛽',
  INSUFFICIENT_BALANCE: '💰',
  INSUFFICIENT_FEE: '💸',
  BAD_AUTH: '🔐',
  WALLET_LOCKED: '🔒',
  WALLET_REJECTED: '🚫',
  WALLET_NOT_INSTALLED: '🦊',
  WRONG_NETWORK: '🌐',
  INVALID_ARGS: '✏️',
  SIMULATION_FAILED: '🧪',
  CONTRACT_REVERT: '↩️',
  STATE_EXPIRED: '⏰',
  BAD_SEQUENCE: '🔄',
  NETWORK_ERROR: '📡',
  TIMEOUT: '⏱️',
  RATE_LIMITED: '🐢',
  SERVER_ERROR: '🖥️',
};

export function WizardStepCard({
  step,
  stepNumber,
  totalSteps,
  onApply,
  onSkip,
}: WizardStepCardProps) {
  const icon = CATEGORY_ICON[step.category] ?? '🔧';
  // Use the first action's patch for the primary Apply button
  const primaryAction = step.actions[0];

  return (
    <div
      data-testid={`wizard-step-${step.id}`}
      role="region"
      aria-label={`Step ${stepNumber} of ${totalSteps}: ${step.title}`}
      className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 space-y-4"
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="text-2xl mt-0.5" aria-hidden="true">{icon}</span>
        <div>
          <p className="text-[11px] text-neutral-500 font-mono mb-0.5">
            {step.category} · step {stepNumber}/{totalSteps}
          </p>
          <h2 className="text-base font-semibold text-neutral-100">{step.title}</h2>
          <p className="text-sm text-neutral-400 mt-1 leading-relaxed">{step.explanation}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        {step.actions.map((action) => (
          <div
            key={action.type}
            className="flex items-start gap-3 bg-neutral-800/60 rounded-lg px-4 py-3"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-neutral-200">{action.label}</p>
              <p className="text-xs text-neutral-500 mt-0.5">{action.description}</p>
              {action.patch && (
                <p className="text-[11px] font-mono text-blue-400 mt-1">
                  {action.patch.field} → {action.patch.value}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Footer buttons */}
      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={() => onApply(primaryAction?.patch)}
          aria-label={`Apply fix: ${primaryAction?.label ?? step.title}`}
          className="flex-1 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          Apply Fix
        </button>
        <button
          type="button"
          onClick={onSkip}
          aria-label="Skip this step"
          className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-400 hover:text-neutral-200 border border-neutral-700 hover:border-neutral-500 transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
