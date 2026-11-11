import type {WorkflowRecipe} from "@bio-mcp/shared/codemode/catalog";

export const resultInventoryWorkflow: WorkflowRecipe = {
  title: "Inspect prediction table schemas and row counts before selecting data",
  keywords: ["results", "tables", "columns", "bcell", "structure", "DiscoTope", "ElliPro"],
  description: "Read an existing result once and omit inline table rows from the returned inventory. Keep native column definitions, method metadata, warnings, errors and retrieval provenance. For staged results, retain the returned handle and inspect its schema with iedb_get_schema before querying rows with SQL. An inventory does not establish prediction completion. For structure predictions, retain chain/residue identifiers; solved-structure pLDDT=100 is a provider convention, and a zero method score in a linear-epitope table can mean that method did not predict the epitope.",
  code: `const resultId = "REPLACE_WITH_RETURNED_RESULT_ID";
const result = await api.get("/ng/results/" + resultId);
if (result.__api_error || result.__staged || result.__stage_error) return result;
const tables = result.data?.data?.results;
if (!Array.isArray(tables)) return result;
const {results, ...dataContext} = result.data.data;
return {
  result_id: resultId,
  native_context: {...result.data, data: dataContext},
  provenance: result._mcp,
  presentation: "table_inventory_without_rows",
  tables: tables.map((table, index) => {
    if (!table || typeof table !== "object" || Array.isArray(table) || !Array.isArray(table.table_data)) {
      return {table_index: index, native_value: table, row_count: null, rows_omitted: false};
    }
    const {table_data, ...metadata} = table;
    return {table_index: index, metadata, row_count: table_data.length, rows_omitted: true};
  })
};`,
};
