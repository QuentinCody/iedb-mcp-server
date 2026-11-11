import {afterEach, expect, it, vi} from "vitest";
import {createIedbApiFetch} from "../lib/api-adapter";
import {resultInventoryWorkflow} from "./result-inventory";

const run = new Function("api", `return (async () => {${resultInventoryWorkflow.code}})();`);
afterEach(() => vi.unstubAllGlobals());

it("inventories native prediction tables through the adapter without returning their rows", async () => {
  const columns = [{name: "chain", source: "core"}, {name: "score", source: "discotope"}];
  const rows = [["A", "0.90"], ["B", null]];
  const native = {status: "done", stage_messages: {warnings: ["retain confidence context"]}, data: {
    errors: [], input_data: {structure_type: "solved"}, results: [
      {type: "residue_table", table_columns: columns, table_data: rows, warnings: ["method warning"]},
      {type: "peptide_table", table_columns: columns, table_data: []},
    ],
  }};
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(native)));
  vi.stubGlobal("fetch", fetcher);
  const adapter = createIedbApiFetch();
  const result = await run({get: async (path: string) => (await adapter({method: "GET", path})).data});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(result.native_context).toEqual({...native, data: {errors: [], input_data: {structure_type: "solved"}}});
  expect(result.provenance).toMatchObject({complete: true, response_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)});
  expect(result.tables).toEqual([
    {table_index: 0, metadata: {type: "residue_table", table_columns: columns, warnings: ["method warning"]}, row_count: 2, rows_omitted: true},
    {table_index: 1, metadata: {type: "peptide_table", table_columns: columns}, row_count: 0, rows_omitted: true},
  ]);
  expect(JSON.stringify(result)).not.toContain('"table_data"');
});

it.each([
  {__staged: true, data_access_id: "saved", schema: {tables: []}},
  {__api_error: true, error: "provider unavailable"},
  {__stage_error: true, error: "storage unavailable"},
  {data: {status: "running"}, _mcp: {complete: false}},
])("preserves staged, failed or unavailable result envelopes without extra requests: %j", async result => {
  const get = vi.fn().mockResolvedValue(result);
  expect(await run({get})).toBe(result);
  expect(get).toHaveBeenCalledTimes(1);
});

it("keeps unknown table values and incomplete status instead of inventing empty results", async () => {
  const tables = [null, {type: "future_table", table_data: "unknown", future: true}];
  const result = {data: {status: "running", data: {results: tables, errors: ["partial"]}}, _mcp: {complete: false}};
  const inventory = await run({get: async () => result});
  expect(inventory.provenance).toEqual({complete: false});
  expect(inventory.tables).toEqual(tables.map((native_value, table_index) => ({native_value, table_index, row_count: null, rows_omitted: false})));
  expect(inventory.native_context.data.errors).toEqual(["partial"]);
  expect(result.data.data.results).toEqual(tables);
});
