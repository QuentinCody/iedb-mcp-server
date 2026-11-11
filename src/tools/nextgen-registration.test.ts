import {afterEach, expect, it, vi} from "vitest";
import {McpServer} from "@bio-mcp/shared/mcp";
import {createApiProxyTool} from "@bio-mcp/shared/tools/api-proxy";
import {registerCodeMode} from "./code-mode";
import {registerGetSchema} from "./get-schema";
import {registerQueryData} from "./query-data";
import {iedbCatalog} from "../spec/catalog";
import {createIedbApiFetch} from "../lib/api-adapter";
const json = (data: unknown) => new Response(JSON.stringify(data), {headers: {"Content-Type": "application/json"}});
afterEach(() => vi.unstubAllGlobals());
it("registers both aliases and both response fields", async () => {
  const server = new McpServer({name: "fixture", version: "1"});
  registerCodeMode(server, {CODE_MODE_LOADER: {get: () => ({})}} as unknown as Parameters<typeof registerCodeMode>[1]);
  registerGetSchema(server, {}); registerQueryData(server, {});
  const tools = (server as unknown as {_registeredTools: Record<string, {handler: (args: unknown, extra: unknown) => Promise<unknown>}>})._registeredTools;
  for (const suffix of ["search", "execute", "query_data", "get_schema"]) {
    expect(tools[`iedb_${suffix}`]).toBeDefined(); expect(tools[`mcp_iedb_${suffix}`]).toBeDefined();
  }
  expect(await tools.iedb_search.handler({query: "nextgen", max_results: 5}, {})).toMatchObject({content: expect.any(Array), structuredContent: {success: true}});
  expect(await tools.mcp_iedb_query_data.handler({data_access_id: "iedb_fixture", sql: "SELECT 1"}, {})).toMatchObject({isError: true, content: expect.any(Array), structuredContent: expect.any(Object)});
});
it("stages complete prediction tables and source/column metadata", async () => {
  const native = {id: "result1", status: "done", data: {warnings: ["Synthetic warning"], errors: [], input_data: {method: "synthetic"}, results: [{type: "residue_table", table_columns: [{name: "chain", source: "core"}, {name: "score", source: "synthetic"}], table_data: Array.from({length: 3000}, (_, i) => ["A", i, "0.90", null])}]}};
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(native)));
  const stored: unknown[] = [];
  const namespace = {idFromName: (name: string) => name, get: () => ({fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") { stored.push((await request.json() as {data: unknown}).data); return json({success: true, tables_created: ["data"], total_rows: 3000, input_rows: 3000, table_row_counts: {data: 3000}}); }
    return json({success: true, schema: {tables: {data: {columns: [{name: "chain"}]}}}});
  }})} as unknown as DurableObjectNamespace;
  const proxy = createApiProxyTool({apiFetch: createIedbApiFetch(), catalog: iedbCatalog, doNamespace: namespace, stagingPrefix: "iedb", maxInlineBytes: 30 * 1024});
  const result = await proxy.handler({method: "GET", path: "/ng/results/result1"}, {sql: () => []});
  expect(result).toMatchObject({__staged: true, data_access_id: expect.any(String)});
  expect(JSON.parse(stored[0] as string)).toMatchObject({data: native, _mcp: {complete: true, has_errors: false, response_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)}});
  expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(100000);
});
it("surfaces malformed submissions as incomplete API errors without a provider call", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const proxy = createApiProxyTool({apiFetch: createIedbApiFetch(), catalog: iedbCatalog, stagingPrefix: "iedb"});
  expect(await proxy.handler({method: "POST", path: "/ng/pipeline", body: {}}, {sql: () => []})).toMatchObject({__api_error: true, incomplete: true, status: 400});
  expect(fetcher).not.toHaveBeenCalled();
});
