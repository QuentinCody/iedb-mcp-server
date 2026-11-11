import {afterEach, expect, it, vi} from "vitest";
import {createApiProxyTool} from "@bio-mcp/shared/tools/api-proxy";
import {createIedbApiFetch} from "./api-adapter";
import {iedbCatalog} from "../spec/catalog";
import {nextgenWorkflows} from "../spec/nextgen";

const routes = ["bcell_structure", "bcell_sequence", "mhci", "mhcii", "cluster", "pepmatch", "pepx", "pepcomp", "mutgen", "phbr"];
const api = createIedbApiFetch();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers: {"Content-Type": "application/json"}});
afterEach(() => vi.unstubAllGlobals());

it.each(routes)("discovers %s metadata with one GET and no prediction submission", async name => {
  // Synthetic metadata verifies native field preservation, not a live schema snapshot.
  const native = {name: [name], version: "fixture", parameters: ["input_sequence_text"], necessary_parameters: [{key: "input", default: null}], optional_parameters: [{key: "option", choice: [false, 0, "0"], default: false}], predictors: [{short_name: "provider-method", group: "binding", source: "binding.provider-method", has_ic50: false}], warnings: ["fixture"], future_field: {retain: true}};
  const fetcher = vi.fn().mockResolvedValue(json(native)); vi.stubGlobal("fetch", fetcher);
  const result = await api({method: "GET", path: `/ng/${name}`});
  expect(result).toMatchObject({status: 200, data: {data: native, _mcp: {resource_kind: "parameter_metadata", tool_group: name, complete: false, provider_schema_validated: false, response_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)}}});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toBe(`https://api-nextgen-tools.iedb.org/api/v1/${name}`);
  expect(fetcher.mock.calls[0][1]).toMatchObject({method: "GET", redirect: "manual"});
  expect(fetcher.mock.calls[0][1].body).toBeUndefined();
});

it.each([
  {method: "POST", path: "/ng/bcell_structure", body: {}},
  {method: "GET", path: "/ng/bcell_structure", body: {}},
  {method: "GET", path: "/ng/mhci", params: {method: "provider-method"}},
  {method: "GET", path: "/ng/bcell_structure?format=json"},
  {method: "GET", path: "/ng/../mhci"},
  {method: "GET", path: "/ng/__proto__"},
])("rejects non-discovery requests before fetching %#", async request => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(api(request)).rejects.toMatchObject({status: 400});
  expect(fetcher).not.toHaveBeenCalled();
});

it("never treats metadata as completed prediction tables", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({status: "done", data: {results: []}, errors: ["provider warning classified as error"]})));
  expect((await api({method: "GET", path: "/ng/mhcii"})).data).toMatchObject({_mcp: {complete: false, has_errors: true}});
});

it.each([null, [], "invalid"])("rejects non-object metadata %#", async data => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(data)));
  await expect(api({method: "GET", path: "/ng/bcell_sequence"})).rejects.toMatchObject({status: 502});
});

it("returns an unavailable metadata error instead of silently using stale method defaults", async () => {
  const fetcher = vi.fn().mockResolvedValue(json({detail: "unavailable"}, 503)); vi.stubGlobal("fetch", fetcher);
  await expect(api({method: "GET", path: "/ng/bcell_structure"})).rejects.toMatchObject({status: 503, data: {submission_state_unknown: false}});
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("makes all parameter routes discoverable and executes the read-only B-cell recipe", async () => {
  expect(iedbCatalog.endpoints.filter(endpoint => endpoint.category === "nextgen-parameters").map(endpoint => endpoint.path)).toEqual(routes.map(name => `/ng/${name}`));
  expect(iedbCatalog.endpointCount).toBe(iedbCatalog.endpoints.length);
  const recipe = nextgenWorkflows.find(workflow => workflow.title === "Inspect B-cell structure parameters before preparing a prediction");
  expect(recipe).toBeDefined();
  const get = vi.fn().mockResolvedValue({__staged: true, data_access_id: "metadata"});
  const run = new Function("api", `return (async () => {${recipe?.code}})();`);
  expect(await run({get})).toEqual({__staged: true, data_access_id: "metadata"});
  expect(get).toHaveBeenCalledExactlyOnceWith("/ng/bcell_structure");
});

it("auto-stages complete method definitions and retrieval context", async () => {
  const native = {name: ["bcell_structure"], version: "fixture", predictors: [{short_name: "fixture-method", description: "α".repeat(20000), choices: [0, false, null]}]};
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(native)));
  const stored: unknown[] = [];
  const namespace = {idFromName: (name: string) => name, get: () => ({fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") {
      stored.push((await request.json() as {data: unknown}).data);
      return json({success: true, tables_created: ["payloads"], total_rows: 1});
    }
    return json({success: true, schema: {tables: {payloads: {columns: [{name: "root_json"}]}}}});
  }})} as unknown as DurableObjectNamespace;
  const proxy = createApiProxyTool({apiFetch: api, catalog: iedbCatalog, doNamespace: namespace, stagingPrefix: "iedb", maxInlineBytes: 30 * 1024});
  const result = await proxy.handler({method: "GET", path: "/ng/bcell_structure"}, {sql: () => []});
  expect(result).toMatchObject({__staged: true, data_access_id: expect.any(String), _staging: expect.any(Object)});
  expect(JSON.parse(stored[0] as string)).toMatchObject({data: native, _mcp: {resource_kind: "parameter_metadata", source_url: "https://api-nextgen-tools.iedb.org/api/v1/bcell_structure", complete: false}});
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(100000);
});
