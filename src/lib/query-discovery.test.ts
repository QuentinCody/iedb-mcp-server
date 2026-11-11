import {afterEach, expect, it, vi} from "vitest";
import {createApiProxyTool} from "@bio-mcp/shared/tools/api-proxy";
import {createIedbApiFetch} from "./api-adapter";
import {iedbCatalog} from "../spec/catalog";

const api = createIedbApiFetch();
const json = (data: unknown, status = 200, headers = {}) => new Response(JSON.stringify(data), {status, headers: {"Content-Type": "application/json", ...headers}});
afterEach(() => vi.unstubAllGlobals());

// Paths/ID fields follow the published IQ-API schema; record values are synthetic.
it.each([
  ["/epitope/123", "/epitope_export", "structure_id"],
  ["/reference/456", "/reference_export", "reference_id"],
])("maps %s to the documented table and exact identifier filter", async (path, table, field) => {
  const id = path.split("/").pop()!;
  const native = [{[field]: Number(id), reference__pmid: "00042", unknown: [null, "0.00"], text: "α"}];
  const fetcher = vi.fn().mockResolvedValue(json(native, 206)); vi.stubGlobal("fetch", fetcher);
  expect(await api({method: "GET", path})).toEqual({status: 206, data: native});
  const url = new URL(String(fetcher.mock.calls[0][0]));
  expect(url.origin + url.pathname).toBe(`https://query-api.iedb.org${table}`);
  expect(Object.fromEntries(url.searchParams)).toEqual({[field]: `eq.${id}`, limit: "100", offset: "0"});
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("keeps empty ID results as native empty arrays", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json([])));
  expect(await api({method: "GET", path: "/epitope/123"})).toEqual({status: 200, data: []});
});

it.each([[{structure_id: 999}], [{structure_id: null}], [{structure_id: [123]}], [{reference_id: 123}], [null]])("rejects a mismatched/missing detail identity: %j", async native => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(native)));
  await expect(api({method: "GET", path: "/epitope/123"})).rejects.toMatchObject({status: 502, data: {provider_response: native}});
});

it.each(["/mhc_search", "/mhc_ligand_search"])("routes %s to the current MHC table without changing filter expressions", async path => {
  const native = [{elution_id: 42, mhc_ids: ["001"], assay: {qualifier: "<", value: "0.0100"}}];
  const fetcher = vi.fn().mockResolvedValue(json(native)); vi.stubGlobal("fetch", fetcher);
  const params = {and: "(elution_id.eq.42,reference_ids.cs.{1})", order: "elution_id.asc", select: "*", limit: 10, offset: 20};
  expect(await api({method: "GET", path, params})).toEqual({status: 200, data: native});
  const url = new URL(String(fetcher.mock.calls[0][0]));
  expect(url.pathname).toBe("/mhc_search");
  expect(Object.fromEntries(url.searchParams)).toEqual(Object.fromEntries(Object.entries(params).map(([k,v]) => [k,String(v)])));
});

it("preserves export filters and column selections without guessing a legacy column mapping", async () => {
  const fetcher = vi.fn().mockResolvedValue(json([{reference__pmid: "00042"}])); vi.stubGlobal("fetch", fetcher);
  expect(await api({method: "GET", path: "/reference_export", params: {reference__pmid: "eq.00042", select: "reference__pmid", limit: 1}})).toMatchObject({data: [{reference__pmid: "00042"}]});
  expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("reference__pmid")).toBe("eq.00042");
});

it("keeps full published schema definitions and references with distinct retrieval context", async () => {
  const native = {swagger: "2.0", info: {version: "0.1"}, paths: {"/epitope_export": {get: {parameters: [{$ref: "#/parameters/structure_id"}]}}}, definitions: {epitope_export: {type: "object"}}, parameters: {structure_id: {type: "integer"}}};
  const fetcher = vi.fn().mockResolvedValue(json(native)); vi.stubGlobal("fetch", fetcher);
  expect(await api({method: "GET", path: "/query/schema"})).toMatchObject({data: {data: native, _mcp: {
    resource_kind: "query_schema", immutable_snapshot: false, source_url: "https://query-api.iedb.org/docs/swagger/iedb_api.json", response_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  }}});
  expect(fetcher.mock.calls[0][1]).toMatchObject({redirect: "manual"});
});

it("retains native metric names/dates/count strings and partial-content metadata without inferring a release", async () => {
  const native = [{table_name: "synthetic", count: "00042", created: "2026-09-30 15:00", updated: null}];
  const fetcher = vi.fn().mockResolvedValue(json(native, 206, {"Content-Range": "0-0/*"})); vi.stubGlobal("fetch", fetcher);
  expect(await api({method: "GET", path: "/query/metrics", params: {limit: 1}})).toMatchObject({status: 206, data: {data: native, _mcp: {
    resource_kind: "query_metrics", complete: false, immutable_snapshot: false, content_range: "0-0/*", source_url: "https://query-api.iedb.org/api_metrics?limit=1&offset=0",
  }}});
});

it.each([
  {path: "/epitope/0"}, {path: "/epitope/01"}, {path: "/reference/9007199254740992"},
  {path: "/epitope/1/extra"}, {path: "/epitope/1", params: {structure_id: "eq.2"}},
  {path: "/query/unknown"}, {path: "/query/schema", params: {release: "v2"}},
  {path: "/query/metrics", params: {limit: 0}}, {path: "/query/metrics", params: {limit: 1001}},
  {path: "/query/metrics", params: {offset: -1}}, {path: "/query/metrics", params: {offset: 1.5}},
  {path: "/query/metrics", params: {offset: Number.MAX_SAFE_INTEGER + 1}},
  {path: "/reference_export", params: {reference_id: {eq: 1}}},
  {path: "/mhc_search", params: {limit: null}}, {path: "/mhc_search", params: {select: "x".repeat(16000)}},
])("rejects invalid local requests before fetch: %j", async request => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(api({method: "GET", ...request})).rejects.toMatchObject({status: request.path === "/query/unknown" ? 404 : 400});
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["/query/schema", "/query/metrics", "/epitope/1", "/reference_export", "/mhc_ligand_search"])("keeps %s read-only", async path => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  for (const request of [{method: "POST" as const, path, body: {}}, {method: "GET" as const, path, body: {}}]) {
    await expect(api(request)).rejects.toMatchObject({status: 400});
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([["/query/schema", []], ["/query/schema", {paths: {}}], ["/query/metrics", {error: "unexpected"}], ["/mhc_search", [{id: 1}, {id: 2}]]])("rejects malformed/oversized row responses for %s", async (path, native) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(native)));
  await expect(api({method: "GET", path: path as string, ...(path === "/mhc_search" ? {params: {limit: 1}} : {})})).rejects.toMatchObject({status: 502});
});

function proxy(stored: unknown[]) {
  const namespace = {idFromName: (name: string) => name, get: () => ({fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") {
      const value = (await request.json() as {data: unknown}).data;
      stored.push(typeof value === "string" ? JSON.parse(value) : value);
      return json({success: true, tables_created: ["data"], total_rows: 1, input_rows: 1, table_row_counts: {data: 1}});
    }
    return json({success: true, schema: {tables: {data: {columns: [{name: "data"}]}}}});
  }})} as unknown as DurableObjectNamespace;
  return createApiProxyTool({apiFetch: api, catalog: iedbCatalog, doNamespace: namespace, stagingPrefix: "iedb", maxInlineBytes: 30 * 1024});
}

it("stages complete schema evidence through Code Mode", async () => {
  const native = {swagger: "2.0", paths: {}, definitions: {record: {description: "α".repeat(22000)}}};
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(native)));
  const stored: unknown[] = []; const result = await proxy(stored).handler({method: "GET", path: "/query/schema"}, {sql: () => []});
  expect(result).toMatchObject({__staged: true, _staging: expect.any(Object)});
  expect(stored[0]).toMatchObject({data: native, _mcp: {resource_kind: "query_schema"}});
  expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(100000);
});

it("preserves and stages large native PostgREST errors without retries", async () => {
  const native = {code: "PGRST100", message: "α".repeat(22000), details: "Synthetic error"};
  const fetcher = vi.fn().mockResolvedValue(json(native, 400)); vi.stubGlobal("fetch", fetcher);
  const stored: unknown[] = []; const result = await proxy(stored).handler({method: "GET", path: "/reference_export"}, {sql: () => []});
  expect(result).toMatchObject({__api_error: true, status: 400, data: {__staged: true}});
  expect(stored[0]).toMatchObject({provider_response: native, native_text: JSON.stringify(native), native_body_complete: true});
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("keeps current paths discoverable and labels adapter-only or unverified routes", () => {
  for (const path of ["/query/schema", "/query/metrics", "/epitope_export", "/reference_export", "/mhc_search"]) expect(iedbCatalog.endpoints.filter(endpoint => endpoint.path === path)).toHaveLength(1);
  for (const path of ["/mhc_ligand_search", "/organism_search", "/disease_search"]) expect(iedbCatalog.endpoints.find(endpoint => endpoint.path === path)?.deprecated).toBe(true);
  expect(iedbCatalog.endpointCount).toBe(iedbCatalog.endpoints.length);
});

it("resolves the documented detail path parameter through the actual Code Mode proxy", async () => {
  const native = [{structure_id: 123, epitope__name: "synthetic"}];
  const fetcher = vi.fn().mockResolvedValue(json(native)); vi.stubGlobal("fetch", fetcher);
  const result = await proxy([]).handler({method: "GET", path: "/epitope/{epitope_id}", params: {epitope_id: 123}}, {sql: () => []});
  expect(result).toEqual(native);
  expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("structure_id")).toBe("eq.123");
});
