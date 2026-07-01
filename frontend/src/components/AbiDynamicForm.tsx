"use client";

import React, { useCallback, useMemo, useState } from "react";
import {
  buildInitialFormState,
  updateField,
  validateAll,
  serializeArgs,
  type AbiFunction,
  type FormFieldValue,
} from "@/src/lib/abi-form";

interface AbiDynamicFormProps {
  fn: AbiFunction;
  onSubmit: (fnName: string, args: Record<string, FormFieldValue>) => void;
  isSubmitting?: boolean;
}

export function AbiDynamicForm({ fn, onSubmit, isSubmitting = false }: AbiDynamicFormProps) {
  const initial = useMemo(() => buildInitialFormState(fn), [fn]);
  const [formState, setFormState] = useState(initial);

  const handleChange = useCallback(
    (name: string, value: FormFieldValue) => {
      setFormState((prev) => updateField(prev, name, value));
    },
    [],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const validated = validateAll(formState);
      setFormState(validated);
      if (!validated.isValid) return;
      onSubmit(fn.name, serializeArgs(validated));
    },
    [fn.name, formState, onSubmit],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label={`${fn.name} form`}>
      {fn.doc && <p className="text-sm text-neutral-400">{fn.doc}</p>}

      {fn.inputs.length === 0 && (
        <p className="text-sm text-neutral-500 italic">No inputs required.</p>
      )}

      {fn.inputs.map((param) => {
        const field = formState.fields[param.name];
        if (!field) return null;
        const fieldId = `abi-${fn.name}-${param.name}`;

        return (
          <div key={param.name} className="flex flex-col gap-1">
            <label htmlFor={fieldId} className="text-sm font-medium text-neutral-300">
              {param.name}
              {!param.optional && <span className="text-red-400 ml-1" aria-hidden="true">*</span>}
              <span className="ml-2 text-xs text-neutral-500 font-mono">{param.type}</span>
            </label>

            {param.type === "bool" ? (
              <input
                id={fieldId}
                type="checkbox"
                checked={field.value as boolean}
                onChange={(e) => handleChange(param.name, e.target.checked)}
                className="w-4 h-4 accent-blue-500"
                aria-describedby={field.error ? `${fieldId}-error` : undefined}
              />
            ) : (
              <input
                id={fieldId}
                type={["u32", "i32", "u64", "i64", "u128", "i128"].includes(param.type) ? "text" : "text"}
                inputMode={["u32", "u64", "u128"].includes(param.type) ? "numeric" : undefined}
                value={field.value as string}
                onChange={(e) => handleChange(param.name, e.target.value)}
                placeholder={param.type === "address" ? "G... or C..." : param.type}
                aria-required={!param.optional}
                aria-invalid={!!field.error}
                aria-describedby={field.error ? `${fieldId}-error` : undefined}
                className={`bg-neutral-800 border rounded px-3 py-2 text-sm text-neutral-100 w-full focus:outline-none focus:ring-2 focus:ring-blue-500 ${field.error ? "border-red-500" : "border-neutral-700"}`}
              />
            )}

            {field.error && (
              <p id={`${fieldId}-error`} role="alert" className="text-xs text-red-400">
                {field.error}
              </p>
            )}
          </div>
        );
      })}

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSubmitting ? "Executing…" : `Call ${fn.name}`}
      </button>
    </form>
  );
}
