import {afterEach, expect, it, vi} from "vitest";
import {createApiProxyTool} from "@bio-mcp/shared/tools/api-proxy";
import {createIedbApiFetch} from "./api-adapter";
import {iedbCatalog} from "../spec/catalog";
import {nextgenWorkflows} from "../spec/nextgen";

const api = createIedbApiFetch();
afterEach(() => vi.unstubAllGlobals());

it.each(["IVLIVITGI\n", ["A", null, "0.90"], null, 0, false, {status: "done", errors: ["input field"], data: {results: []}, future: "retained"}].map(native => ({native})))("retains the native input JSON value without classifying it as prediction status: %j", async ({native}) => {
  const raw = JSON.stringify(native);
  const fetcher = vi.fn().mockResolvedValue(new Response(raw)); vi.stubGlobal("fetch", fetcher);
  const result = await api({method: "GET", path: "/ng/get_object/1675139470.6785612-fl0lKlEj"});
  expect(result).toMatchObject({status: 200, data: {data: native, _mcp: {object_id: "1675139470.6785612-fl0lKlEj", resource_kind: "input_object", complete: false, status: null, has_errors: null}}});
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))), b => b.toString(16).padStart(2, "0")).join("");
  expect(result.data).toHaveProperty("_mcp.response_sha256", digest);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toBe("https://api-nextgen-tools.iedb.org/api/v1/get_object/1675139470.6785612-fl0lKlEj");
  expect(fetcher.mock.calls[0][1]).toMatchObject({method: "GET", redirect: "manual"});
});

it.each([
  {method: "POST", path: "/ng/get_object/id1", body: {}},
  {method: "GET", path: "/ng/get_object/id1", body: {}},
  {method: "GET", path: "/ng/get_object/id1", params: {url: "https://example.org"}},
  {method: "GET", path: "/ng/get_object/../pipeline"},
  {method: "GET", path: "/ng/get_object/id1?format=json"},
  {method: "GET", path: "/ng/get_object/https://example.org"},
])("rejects invalid object requests without a fetch: %j", async request => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(api(request)).rejects.toMatchObject({status: 400});
  expect(fetcher).not.toHaveBeenCalled();
});

it("retains missing-object failure without suggesting a submission occurred", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("missing", {status: 404})));
  await expect(api({method: "GET", path: "/ng/get_object/expired"})).rejects.toMatchObject({status: 404, data: {submission_state_unknown: false}});
});

it("stages complete saved input text and its source hash through the actual Code Mode proxy", async () => {
  const native = {id: "input1", type: "input_sequence_text", data: ">fixture\n" + "ACDEFGHIKLMNPQRSTVWY\n".repeat(6000)};
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(native)));
  const stored: unknown[] = [];
  const namespace = {idFromName: (name: string) => name, get: () => ({fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") { stored.push((await request.json() as {data: unknown}).data); return Response.json({success: true, tables_created: ["payloads"], total_rows: 1}); }
    return Response.json({success: true, schema: {tables: {payloads: {columns: [{name: "payload_json"}]}}}});
  }})};
  const proxy = createApiProxyTool({apiFetch: api, catalog: iedbCatalog, doNamespace: namespace, stagingPrefix: "iedb", maxInlineBytes: 30 * 1024});
  const result = await proxy.handler({method: "GET", path: "/ng/get_object/{id}", params: {id: "input1"}}, {sql: () => []});
  expect(result).toMatchObject({__staged: true, _staging: expect.any(Object)});
  expect(stored.map(value => typeof value === "string" ? JSON.parse(value) : value)).toContainEqual({data: native, _mcp: expect.objectContaining({resource_kind: "input_object", complete: false, response_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)})});
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(100000);
});

const recipe = nextgenWorkflows.find(workflow => workflow.title === "Retain saved inputs with their prediction stage")!;
const run = (get: unknown) => new Function("api", `return (async () => {${recipe.code}})();`)({get});

it("retrieves only documented stage input IDs, preserving the referring stage", async () => {
  const stage = {data: {input_data: {input_parameters_id: "parameters1", input_sequence_text_id: "sequence1", input_datasets_id: "datasets1", input_parameters_uri: "https://untrusted.example", extra_id: "not-selected"}}};
  const get = vi.fn().mockResolvedValueOnce(stage).mockResolvedValue({data: "native"});
  const result = await run(get);
  expect(result).toMatchObject({stage, complete_input_provenance: false, inputs: [{field: "input_parameters_id", id: "parameters1", object: {data: "native"}}, {field: "input_sequence_text_id", id: "sequence1"}, {field: "input_datasets_id", id: "datasets1"}]});
  expect(get.mock.calls.slice(1).map(call => call[0])).toEqual(["/ng/get_object/parameters1", "/ng/get_object/sequence1", "/ng/get_object/datasets1"]);
});

it.each([{__staged: true}, {__api_error: true}, {__stage_error: true}, {data: {}}])("does not guess input IDs from unavailable stage details: %j", async stage => {
  const get = vi.fn().mockResolvedValue(stage);
  expect(await run(get)).toMatchObject({stage});
  expect(get).toHaveBeenCalledTimes(1);
});
