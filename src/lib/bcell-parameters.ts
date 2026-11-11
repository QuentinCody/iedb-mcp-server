import {record} from "./ng-http";

export interface PreflightIssue {stage_number: number; path: string; message: string; kind: "error" | "unassessed"}
export type AddIssue = (path: string, message: string, kind?: PreflightIssue["kind"]) => void;
const owns = (object: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(object, key);

function parameter(value: unknown, definition: Record<string, unknown>, path: string, add: AddIssue) {
  const type = definition.type;
  const known = ["int", "float", "str", "bool"].includes(String(type));
  if (!known) { add(path, "Provider parameter type is not assessed by this validator", "unassessed"); return; }
  const typed = type === "int" ? Number.isSafeInteger(value) : type === "float" ? typeof value === "number" && Number.isFinite(value)
    : type === "str" ? typeof value === "string" : typeof value === "boolean";
  if (!typed) { add(path, `Expected native ${String(type)}; values are not coerced`); return; }
  if (definition.choices !== undefined) {
    if (!Array.isArray(definition.choices) || !definition.choices.length) add(path, "Provider choices are not usable", "unassessed");
    else {
      const values = definition.choices.map(choice => record(choice) && owns(choice, "value") ? choice.value : choice);
      if (values.some(choice => choice !== null && typeof choice === "object")) add(path, "Provider choice shape is not assessed", "unassessed");
      else if (!values.includes(value)) add(path, "Value is absent from the provider's current choices");
    }
  }
  if (definition.value_limits !== undefined) {
    const limits = definition.value_limits;
    if (!record(limits) || typeof value !== "number") add(path, "Provider limits are not assessed", "unassessed");
    else for (const name of ["min", "max"] as const) {
      const bound = limits[name];
      if (bound === undefined) continue;
      if (typeof bound !== "number" || !Number.isFinite(bound)) add(path, `Provider ${name} bound is not numeric`, "unassessed");
      else if (name === "min" ? value < bound : value > bound) add(path, `Value violates provider ${name} ${bound}`);
    }
  }
}

/** Validate only fields actually described by the retained metadata. Never apply defaults. */
export function validatePredictors(input: unknown, metadata: Record<string, unknown>, add: AddIssue) {
  if (!Array.isArray(input) || !input.length) { add("input_parameters.predictors", "Select at least one predictor"); return; }
  const available = metadata.predictors as Record<string, unknown>[];
  const methods = new Map<string, Record<string, unknown>[]>();
  for (const row of available) {
    const key = JSON.stringify([row.short_name, row.group]);
    methods.set(key, [...(methods.get(key) ?? []), row]);
  }
  input.forEach((predictor, index) => {
    const path = `input_parameters.predictors[${index}]`;
    if (!record(predictor) || typeof predictor.method !== "string" || typeof predictor.type !== "string") { add(path, "Predictor requires native method and type strings"); return; }
    const choices = methods.get(JSON.stringify([predictor.method, predictor.type])) ?? [];
    if (choices.length !== 1) { add(path, "Method/type is absent or ambiguous in current provider metadata"); return; }
    const method = choices[0]; const definitions = new Map<string, Record<string, unknown>>();
    for (const group of ["necessary_parameters", "optional_parameters"]) {
      const rows = method[group];
      if (rows === undefined) continue;
      if (!Array.isArray(rows)) { add(path, "Provider parameter definitions are malformed", "unassessed"); continue; }
      for (const row of rows) {
        if (!record(row) || typeof row.key !== "string" || !row.key || definitions.has(row.key)) { add(path, "Provider parameter keys are missing or duplicated", "unassessed"); continue; }
        definitions.set(row.key, row);
        if (owns(predictor, row.key)) parameter(predictor[row.key], row, `${path}.${row.key}`, add);
        else if (group === "necessary_parameters" && !owns(row, "default")) add(`${path}.${row.key}`, "Required provider parameter is missing");
      }
    }
    for (const key of Object.keys(predictor)) if (!["type", "method"].includes(key) && !definitions.has(key)) add(`${path}.${key}`, "Parameter is not described by the retained metadata", "unassessed");
  });
}
