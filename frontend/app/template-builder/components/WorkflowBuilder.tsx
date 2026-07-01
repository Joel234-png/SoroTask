'use client';

import React, { useState } from 'react';
import { ActionBlockCard } from './ActionBlockCard';
import { useTemplateBuilder } from './useTemplateBuilder';
import { PREDEFINED_ACTIONS } from './actions';
import {
  ActionDefinition,
  ActionBlock,
  WorkflowStage,
  WorkflowCondition,
  WorkflowTemplate,
  createWorkflowFromBlocks,
  reorderInStage,
  createStage,
  moveBlockToStage,
} from './workflow';
import { useId } from 'react';

export function WorkflowBuilder() {
  const { blocks, addBlock, removeBlock, updateArg, updateContractAddress, reorderBlocks } =
    useTemplateBuilder();
  const [stages, setStages] = useState<WorkflowStage[]>([
    { id: 'stage-main', name: 'Main Flow', blockIds: [] },
    { id: 'stage-fallback', name: 'Fallback', blockIds: [] },
  ]);
  const [activeStageId, setActiveStageId] = useState<string>('stage-main');
  const [showConditionEditor, setShowConditionEditor] = useState<string | null>(null);
  const [condition, setCondition] = useState<WorkflowCondition>({
    field: 'amount',
    operator: 'greater_than',
    value: '0',
    targetStageId: 'stage-fallback',
  });

  const uid = useId();

  function resolveDefinition(definitionId: string): ActionDefinition | undefined {
    const pre = PREDEFINED_ACTIONS.find((a) => a.id === definitionId);
    if (pre) return pre;
    return undefined;
  }

  function handleDropDefinition(stageId: string, definitionId: string) {
    const def = resolveDefinition(definitionId);
    if (!def) return;
    const block: ActionBlock = {
      instanceId: `block-${Date.now()}`,
      definitionId: def.id,
      label: def.label,
      category: def.category,
      icon: def.icon,
      contractAddress: def.defaultContractAddress ?? '',
      functionName: def.functionName,
      inputs: def.inputs,
      args: {},
      isConfigured: false,
    };
    addBlock(block);
    setStages((prev) =>
      prev.map((stage) =>
        stage.id === stageId ? { ...stage, blockIds: [...stage.blockIds, block.instanceId] } : stage
      )
    );
  }

  function handleAddStage() {
    const name = prompt('Stage name');
    if (!name) return;
    setStages((prev) => createStage({ stages: prev, blocks, createdAt: new Date(), id: 'wf', name: '' } as WorkflowTemplate, name, activeStageId).stages);
  }

  function handleStageDrop(fromStageId: string, toStageId: string, instanceId: string) {
    if (fromStageId === toStageId) return;
    setStages((prev) =>
      moveBlockToStage(
        { stages: prev, blocks, createdAt: new Date(), id: 'wf', name: '' } as WorkflowTemplate,
        instanceId,
        fromStageId,
        toStageId,
        999
      ).stages
    );
  }

  function handleReorder(stageId: string, from: number, to: number) {
    setStages((prev) =>
      reorderInStage({ stages: prev, blocks, createdAt: new Date(), id: 'wf', name: '' } as WorkflowTemplate, stageId, from, to).stages
    );
  }

  const activeStage = stages.find((s) => s.id === activeStageId) ?? stages[0]!;
  const stageBlocks = blocks.filter((b) => activeStage.blockIds.includes(b.instanceId));

  return (
    <div className="flex h-screen bg-neutral-950 text-white">
      {/* Palette */}
      <aside className="w-64 border-r border-neutral-800 p-4 overflow-y-auto">
        <h2 className="text-sm font-semibold text-neutral-400 mb-3 uppercase tracking-wider">
          Actions
        </h2>
        <div className="space-y-2">
          {PREDEFINED_ACTIONS.map((def) => (
            <div
              key={def.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/x-definition-id', def.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 cursor-grab active:cursor-grabbing hover:border-neutral-700"
            >
              <div className="text-xs font-medium text-white">{def.label}</div>
              <div className="text-[10px] text-neutral-500 mt-1">{def.description}</div>
            </div>
          ))}
        </div>
      </aside>

      {/* Stages */}
      <nav className="w-48 border-r border-neutral-800 p-4" aria-label="Workflow stages">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">Stages</h2>
          <button
            onClick={handleAddStage}
            className="text-xs bg-neutral-800 hover:bg-neutral-700 px-2 py-1 rounded"
            aria-label="Add stage"
          >
            + Add
          </button>
        </div>
        <ul className="space-y-1">
          {stages.map((stage) => (
            <li key={stage.id}>
              <button
                onClick={() => setActiveStageId(stage.id)}
                className={[
                  'w-full text-left rounded-lg px-3 py-2 text-sm transition-colors',
                  activeStageId === stage.id
                    ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                    : 'text-neutral-400 hover:bg-neutral-800 border border-transparent',
                ].join(' ')}
              >
                {stage.name}
                <span className="ml-2 text-[10px] text-neutral-600">
                  ({stage.blockIds.length})
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Canvas */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-xl font-bold mb-4">{activeStage.name}</h1>
          <div
            role="region"
            aria-label={`${activeStage.name} canvas`}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={(e) => {
              e.preventDefault();
              const defId = e.dataTransfer.getData('text/x-definition-id');
              if (defId) handleDropDefinition(activeStage.id, defId);
            }}
            className="min-h-[400px] rounded-xl border-2 border-dashed border-neutral-800 p-4 space-y-4 transition-colors"
          >
            {stageBlocks.length === 0 && (
              <p className="text-center text-neutral-600 text-sm py-12">
                Drag actions from the palette to build this stage
              </p>
            )}
            {stageBlocks.map((block, index) => (
              <React.Fragment key={block.instanceId}>
                <ActionBlockCard
                  block={block}
                  index={index}
                  onRemove={(id) => {
                    removeBlock(id);
                    setStages((prev) =>
                      prev.map((stage) =>
                        stage.id === activeStage.id
                          ? { ...stage, blockIds: stage.blockIds.filter((bid) => bid !== id) }
                          : stage
                      )
                    );
                  }}
                  onArgChange={(id, name, value) => updateArg(id, name, value)}
                  onContractChange={(id, addr) => updateContractAddress(id, addr)}
                  onDragStart={(idx) => {}}
                  onDrop={(toIndex) => handleReorder(activeStage.id, index, toIndex)}
                  onAddCondition={() => setShowConditionEditor(block.instanceId)}
                />
                {index < stageBlocks.length - 1 && (
                  <div className="flex justify-center" aria-hidden="true">
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="w-px h-4 bg-neutral-700" />
                      <div className="text-neutral-600 text-xs">↓</div>
                      <div className="w-px h-4 bg-neutral-700" />
                    </div>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>

          {showConditionEditor && (
            <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <h3 className="text-sm font-semibold text-white mb-3">Condition</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`${uid}-field`} className="text-xs text-neutral-400">Field</label>
                  <input
                    id={`${uid}-field`}
                    value={condition.field}
                    onChange={(e) => setCondition({ ...condition, field: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label htmlFor={`${uid}-op`} className="text-xs text-neutral-400">Operator</label>
                  <select
                    id={`${uid}-op`}
                    value={condition.operator}
                    onChange={(e) => setCondition({ ...condition, operator: e.target.value as WorkflowCondition['operator'] })}
                    className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white"
                  >
                    <option value="equals">equals</option>
                    <option value="not_equals">not equals</option>
                    <option value="greater_than">greater than</option>
                    <option value="less_than">less than</option>
                    <option value="contains">contains</option>
                  </select>
                </div>
                <div>
                  <label htmlFor={`${uid}-val`} className="text-xs text-neutral-400">Value</label>
                  <input
                    id={`${uid}-val`}
                    value={condition.value}
                    onChange={(e) => setCondition({ ...condition, value: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label htmlFor={`${uid}-target`} className="text-xs text-neutral-400">Target stage</label>
                  <select
                    id={`${uid}-target`}
                    value={condition.targetStageId}
                    onChange={(e) => setCondition({ ...condition, targetStageId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white"
                  >
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => setShowConditionEditor(null)}
                  className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setShowConditionEditor(null)}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500"
                >
                  Save condition
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
