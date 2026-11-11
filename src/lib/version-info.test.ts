import {afterEach, expect, it, vi} from "vitest";
import {createApiProxyTool} from "@bio-mcp/shared/tools/api-proxy";
import {createIedbApiFetch} from "./api-adapter";
import {iedbCatalog} from "../spec/catalog";

const api = createIedbApiFetch();
const path = "/ng/version_info";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers: {"Content-Type": "application/json"}});
afterEach(() => vi.unstubAllGlobals());

// Synthetic shapes: the API index documents this endpoint, not a stable field schema.
it.each([{api: {version: "synthetic", git: "abc"}, components: [{name: "model", version: "01.00"}]}, [{component: "tool", version: "x"}], "version-text", null])("preserves native version metadata without interpreting it as job state: %j", async native => {
  const fetcher = vi.fn().mockResolvedValue(json(native)); vi.stubGlobal("fetch", fetcher);
  expect(await api({method: "GET", path})).toMatchObject({status: 200, data: {data: native, _mcp: {
    resource_kind: "service_version", complete: false, prediction_version_pinned: false,
    provider_schema_validated: false, source_url: "https://api-nextgen-tools.iedb.org/api/v1/version_info", response_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  }}});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1].method).toBe("GET");
});

it.each([{method: "POST" as const, path}, {method: "GET" as const, path, body: {}}, {method: "GET" as const, path, params: {version: "4.1"}}, {method: "GET" as const, path: `${path}/4.1`}])("rejects unsupported version selectors before fetch: %j", async request => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(api(request)).rejects.toMatchObject({status: 400}); expect(fetcher).not.toHaveBeenCalled();
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

it("stages full version evidence through existing Code Mode", async () => {
  const native = {components: [{version: "001", description: "α".repeat(20000)}]};
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(native)));
  const stored: unknown[] = []; const result = await proxy(stored).handler({method: "GET", path}, {sql: () => []});
  expect(result).toMatchObject({__staged: true, data_access_id: expect.any(String)});
  expect(stored[0]).toMatchObject({data: native, _mcp: {resource_kind: "service_version", prediction_version_pinned: false}});
  expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(100000);
});

it("stages complete large provider validation errors with their native body and status", async () => {
  const native = {errors: [{field: "structure", detail: "α".repeat(20000)}], future: {retain: true}};
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(native, 422)));
  const stored: unknown[] = []; const result = await proxy(stored).handler({method: "GET", path: "/ng/results/result1"}, {sql: () => []});
  expect(result).toMatchObject({__api_error: true, status: 422, data: {__staged: true, _staging: expect.any(Object)}});
  expect(stored[0]).toMatchObject({provider_response: native, native_text: JSON.stringify(native), http_status: 422, native_body_complete: true, response_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)});
  expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(100000);
});

it("catalog exposes version discovery without changing the tool roster", () => {
  expect(iedbCatalog.endpoints.filter(endpoint => endpoint.path === path)).toHaveLength(1);
  expect(iedbCatalog.endpointCount).toBe(iedbCatalog.endpoints.length);
});
