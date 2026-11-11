import {record} from "./ng-http";

/** A done status alone is insufficient: input tables can precede prediction tables. */
export function predictionState(native: Record<string, unknown>) {
  const nested = record(native.data) ? native.data : {};
  const messages = record(native.stage_messages) ? native.stage_messages : {};
  const hasErrors = [native.errors, nested.errors, messages.errors].some(value => value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0));
  const status = typeof native.status === "string" ? native.status : typeof native.stage_status === "string" ? native.stage_status : null;
  const hasResultTables = Array.isArray(nested.results) && nested.results.some(table => record(table)
    && typeof table.type === "string" && table.type.length > 0 && !table.type.startsWith("input_")
    && Array.isArray(table.table_columns) && table.table_columns.length > 0 && Array.isArray(table.table_data));
  return {status, hasErrors, hasResultTables};
}
