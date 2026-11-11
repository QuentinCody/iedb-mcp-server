import {afterEach, expect, it, vi} from "vitest";
import {createIedbApiFetch} from "./api-adapter";
import {iedbCatalog} from "../spec/catalog";
import {nextgenWorkflows} from "../spec/nextgen";
const json = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), {status, headers: {"Content-Type": "application/json", ...headers}});
const submit = {pipeline_id: "", run_stage_range: [1, 1], stages: [{stage_number: 1, tool_group: "mhci", input_sequence_text: "IVLIVITGI", input_parameters: {alleles: "H2-Kb", peptide_length_range: [9, 9], predictors: [{type: "binding", method: "netmhcpan_el"}]}}]};
// Minimal transcription of IDs/URI from the provider documentation, not a captured live job.
const accepted = {pipeline_id: "a1f2ab78-33b8-4a38-b484-d392bae43a39", result_id: "1673373361.4166636-Xq9AyoYI", results_uri: "https://api-nextgen-tools.iedb.org/api/v1/results/1673373361.4166636-Xq9AyoYI", warnings: []};
const api = createIedbApiFetch();
const post = (body: unknown = submit) => api({method: "POST", path: "/ng/pipeline", body});
const get = (path: string, params?: Record<string, unknown>) => api({method: "GET", path, params});
function stub(value: unknown, status = 200) { const f = vi.fn().mockResolvedValue(json(value, status)); vi.stubGlobal("fetch", f); return f; }
afterEach(() => vi.unstubAllGlobals());
it("submits native JSON once to production, preserving nested parameters and warnings", async () => {
  const native = {...accepted, warnings: ["Synthetic partial-method warning"], future: {retain: true}};
  const fetcher = stub(native, 202); const result = await post();
  expect(result).toMatchObject({status: 202, data: {data: native, _mcp: {submission_accepted: true, complete: false, result_path: `/ng/results/${accepted.result_id}`, request_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)}}});
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(String(url)).toBe("https://api-nextgen-tools.iedb.org/api/v1/pipeline");
  expect(JSON.parse(init.body)).toEqual(submit); expect(init).toMatchObject({method: "POST", redirect: "manual", signal: expect.any(AbortSignal)});
});
it("preserves full column schemas, data, strings, missing values and method/structure context", async () => {
  // Synthetic table contract example; does not establish live B-cell field spellings.
  const native = {id: accepted.result_id, status: "done", data: {errors: [], warnings: ["Synthetic"], input_data: {structure_type: "alphafold"}, results: [{type: "residue_table", table_columns: [{name: "chain", source: "core"}, {name: "score", source: "discotope"}], table_data: [["A", "0.90"], ["B", null]]}]}};
  stub(native); expect((await get(`/ng/results/${accepted.result_id}`)).data).toMatchObject({data: native, _mcp: {complete: true, has_errors: false, prediction_is_experimental_evidence: false, provider_schema_validated: false}});
});
it.each(["pending", "running", "failed", "cancelled", "new-provider-state"])("keeps %s incomplete even when partial tables exist", async status => {
  stub({status, data: {results: [{type: "input_sequence_table", table_data: [[1, "IVLIVITGI"]]}]}});
  expect((await get("/ng/results/result1")).data).toMatchObject({_mcp: {status, complete: false}});
});
it("does not call a done response complete when tables are missing or errors exist", async () => {
  stub({status: "done", data: {}}); expect((await get("/ng/results/result1")).data).toMatchObject({_mcp: {complete: false}});
  stub({status: "done", data: {results: [], errors: ["failed stage"]}}); expect((await get("/ng/results/result1")).data).toMatchObject({_mcp: {complete: false, has_errors: true}});
});
it("retains rejected submission evidence without claiming acceptance", async () => {
  const native = {errors: ["Invalid provider method"], warnings: []}; stub(native);
  expect((await post()).data).toMatchObject({data: native, _mcp: {submission_accepted: false, has_errors: true, complete: false}});
});
it("ignores returned foreign URLs and derives polling paths only from valid IDs", async () => {
  const fetcher = stub({...accepted, results_uri: "https://untrusted.example/result"});
  expect((await post()).data).toMatchObject({_mcp: {result_path: `/ng/results/${accepted.result_id}`}}); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("reports unknown submission state without retry on transport failure", async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error("network")); vi.stubGlobal("fetch", fetcher);
  await expect(post()).rejects.toMatchObject({status: 502, data: {incomplete: true, submission_state_unknown: true}}); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not claim rejection when an accepted response cannot be parsed", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("broken")));
  await expect(post()).rejects.toMatchObject({data: {submission_state_unknown: true}});
});
it.each([{}, {...accepted, result_id: "../../other"}])("rejects missing/unsafe submission identifiers %#", async native => {
  stub(native); await expect(post()).rejects.toMatchObject({status: 502, data: {submission_state_unknown: true}});
});
it.each([null, {...submit, pipeline_id: accepted.pipeline_id}, {...submit, run_stage_range: [2, 1]}, {...submit, stages: []}, {...submit, stages: [{stage_number: 2, tool_group: "mhci"}]}, {...submit, email: "notify@example.com"}])("rejects invalid submission before network %#", async body => {
  const fetcher = stub(accepted); await expect(post(body)).rejects.toMatchObject({status: 400}); expect(fetcher).not.toHaveBeenCalled();
});
it("bounds UTF-8 input bytes", async () => {
  const fetcher = stub(accepted); await expect(post({...submit, extra: "α".repeat(140000)})).rejects.toThrow("256 KiB"); expect(fetcher).not.toHaveBeenCalled();
});
it.each(["/ng/results/../pipeline", "/ng/results/https://elsewhere.example/a", "/ng/results/id?foo=x", "/ng/results/%2e%2e", "/ng/unknown_tool", "/ng/pipeline"])("rejects undocumented or unsafe GET path %s", async path => {
  const fetcher = stub({}); await expect(get(path)).rejects.toMatchObject({status: 400}); expect(fetcher).not.toHaveBeenCalled();
});
it.each(["pipeline", "stage", "pipeline_spec"])("reads native %s without treating it as completed result tables", async type => {
  const native = {status: "done", stages: [], stage_messages: {warnings: ["synthetic"]}}; stub(native);
  expect((await get(`/ng/${type}/id1`)).data).toMatchObject({data: native, _mcp: {complete: false}});
});
it.each([429, 503])("retains HTTP %s and retry metadata without retries", async status => {
  const fetcher = vi.fn().mockResolvedValue(json({}, status, {"Retry-After": "30"})); vi.stubGlobal("fetch", fetcher);
  await expect(post()).rejects.toMatchObject({status, data: {retry_after: "30", submission_state_unknown: true}}); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("bounds response size without dropping tables silently", async () => {
  stub({status: "done", data: "α".repeat(2200000)}); await expect(get("/ng/results/result1")).rejects.toThrow("4 MiB");
});
it("keeps legacy form prediction and raw IQ-API response shapes", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("position\tscore\n1\t0.5\n", {headers: {"Content-Type": "text/plain"}})).mockResolvedValueOnce(json([{structure_id: 1}])); vi.stubGlobal("fetch", fetcher);
  expect(await api({method: "POST", path: "/tools/bcell/", body: {method: "Emini", sequence_text: "IVLIVITGI"}})).toEqual({status: 200, data: [{position: 1, score: 0.5}]});
  expect(fetcher.mock.calls[0][1].body).toContain("sequence_text=IVLIVITGI");
  expect(await get("/epitope_search", {limit: 1})).toEqual({status: 200, data: [{structure_id: 1}]});
});
it("catalog count and the submission/resume split stay discoverable", () => {
  expect(iedbCatalog.endpointCount).toBe(iedbCatalog.endpoints.length);
  expect(nextgenWorkflows[1].code).not.toContain("api.post");
});
it.each([{__api_error: true}, {__staged: true}, {_mcp: {complete: false}}, {_mcp: {complete: true}}])("resume recipe only reports a complete inline result %#", async result => {
  const run = new Function("api", `return (async () => {${nextgenWorkflows[1].code}})();`);
  const value = await run({get: async () => result});
  expect(value.complete).toBe("_mcp" in result && result._mcp?.complete === true);
});

it("recognizes native stage_messages errors without dropping them", async () => {
  const native = {stage_status: "done", stage_messages: {errors: ["synthetic stage error"], warnings: []}};
  stub(native); expect((await get("/ng/stage/stage1")).data).toMatchObject({data: native, _mcp: {has_errors: true, complete: false}});
});

it.each([[], [null], [{type: "input_sequence_table", table_columns: [{name: "sequence"}], table_data: [["IVLIVITGI"]]}], [{type: "peptide_table", table_data: []}], [{type: "peptide_table", table_columns: [], table_data: []}], [{type: "peptide_table", table_columns: [{name: "peptide"}], table_data: null}]].map(results => ({results})))("keeps empty, input-only or malformed done tables incomplete: %j", async ({results}) => {
  const native = {status: "done", data: {results, errors: []}}; stub(native);
  expect((await get("/ng/results/result1")).data).toMatchObject({data: native, _mcp: {complete: false, has_errors: false}});
});

it("allows a completed output table with zero rows without inventing predictions", async () => {
  const native = {status: "done", data: {results: [{type: "peptide_table", table_columns: [{name: "peptide"}], table_data: []}], errors: []}}; stub(native);
  expect((await get("/ng/results/result1")).data).toMatchObject({data: native, _mcp: {complete: true}});
});
