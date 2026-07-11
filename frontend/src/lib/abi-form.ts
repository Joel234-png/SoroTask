export type SorobanScType =
  | "u32"
  | "i32"
  | "u64"
  | "i64"
  | "u128"
  | "i128"
  | "bool"
  | "string"
  | "bytes"
  | "address"
  | "void";

export interface AbiParam {
  name: string;
  type: SorobanScType;
  optional?: boolean;
}

export interface AbiFunction {
  name: string;
  inputs: AbiParam[];
  outputs: AbiParam[];
  doc?: string;
}

export interface ContractAbi {
  contractId: string;
  functions: AbiFunction[];
}

export type FormFieldValue = string | boolean;

export interface AbiFormField {
  param: AbiParam;
  value: FormFieldValue;
  error: string | null;
}

export interface AbiFormState {
  fields: Record<string, AbiFormField>;
  isValid: boolean;
}

function validateValue(value: FormFieldValue, param: AbiParam): string | null {
  if (param.optional && value === "") return null;

  if (param.type === "bool") return null;

  const str = String(value).trim();
  if (!str) return `${param.name} is required`;

  if (param.type === "address") {
    if (!/^[GC][A-Z2-7]{55}$/.test(str)) return "Invalid Stellar address";
    return null;
  }

  if (["u32", "u64", "u128"].includes(param.type)) {
    if (!/^\d+$/.test(str)) return "Must be a non-negative integer";
    return null;
  }

  if (["i32", "i64", "i128"].includes(param.type)) {
    if (!/^-?\d+$/.test(str)) return "Must be an integer";
    return null;
  }

  return null;
}

export function buildInitialFormState(fn: AbiFunction): AbiFormState {
  const fields: Record<string, AbiFormField> = {};
  for (const param of fn.inputs) {
    fields[param.name] = {
      param,
      value: param.type === "bool" ? false : "",
      error: null,
    };
  }
  return { fields, isValid: fn.inputs.length === 0 };
}

export function updateField(
  state: AbiFormState,
  name: string,
  value: FormFieldValue,
): AbiFormState {
  const field = state.fields[name];
  if (!field) return state;

  const error = validateValue(value, field.param);
  const updated = { ...state.fields, [name]: { ...field, value, error } };
  const isValid = Object.values(updated).every((f) => f.error === null && (f.param.optional || f.value !== ""));

  return { fields: updated, isValid };
}

export function validateAll(state: AbiFormState): AbiFormState {
  const fields: Record<string, AbiFormField> = {};
  for (const [name, field] of Object.entries(state.fields)) {
    const error = validateValue(field.value, field.param);
    fields[name] = { ...field, error };
  }
  const isValid = Object.values(fields).every((f) => f.error === null);
  return { fields, isValid };
}

export function serializeArgs(state: AbiFormState): Record<string, FormFieldValue> {
  const args: Record<string, FormFieldValue> = {};
  for (const [name, field] of Object.entries(state.fields)) {
    args[name] = field.value;
  }
  return args;
}
