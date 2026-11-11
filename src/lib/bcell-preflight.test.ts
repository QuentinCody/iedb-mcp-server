import {afterEach, expect, it, vi} from "vitest";
import {createIedbApiFetch} from "./api-adapter";
import {bcellPreflightWorkflow} from "../spec/bcell-preflight";
import {iedbCatalog} from "../spec/catalog";

// Metadata-shaped fixtures; names/types/bounds follow the October 1 native capture.
const metadata = (group = "bcell_sequence") => ({name: [group], version: "fixture", parameters: [], predictors: group === "bcell_structure"
  ? [{short_name: "ellipro", group: "structure_based", optional_parameters: [{key: "max_distance", type: "int", default: 6}]}]
  : [{short_name: "bepipred-3.0", group: "ml_based", optional_parameters: [
    {key: "window_size", type: "int", value_limits: {min: 1, max: 50}, default: 9},
    {key: "pred", type: "str", choices: [{value: "vt_pred"}, {value: "mjv_pred"}]},
    {key: "add_seq_len", type: "bool", default: false}, {key: "top_cands", type: "float"},
  ]}]});
function stage() { return {stage_number: 1, stage_type: "prediction", tool_group: "bcell_sequence", input_sequence_text: ">example\nACDEFGHIKLMNPQRSTVWY", input_parameters: {predictors: [{type: "ml_based", method: "bepipred-3.0", window_size: 9, pred: "vt_pred", add_seq_len: false}]}}; }
function pipeline(stages: unknown[] = [stage()]) {return {pipeline_id: "", run_stage_range: [1, stages.length], stages};}
const api = createIedbApiFetch();
const run = async (body: unknown = pipeline()) => (await api({method: "POST", path: "/ng/pipeline/validate", body})).data as any;
function stub(value: unknown = metadata(), status = 200, headers = {}) {const fetcher = vi.fn().mockImplementation(async () => Response.json(value, {status, headers})); vi.stubGlobal("fetch", fetcher); return fetcher;}
afterEach(() => vi.unstubAllGlobals());

it("checks a draft with one GET, retains native metadata and serialized input, and never submits", async () => {
  const native = {...metadata(), extension: ["0.00", false, null]}; const fetcher = stub(native); const draft = pipeline(); const before = JSON.stringify(draft);
  const result = await run(draft);
  expect(result).toMatchObject({pipeline: draft, parameter_metadata: [{data: native, provenance: {response_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)}}], validation: {local_checks_passed: true, errors: [], unassessed: [], complete_submission_schema: false, provider_acceptance_verified: false}, _mcp: {submitted: false, complete: false, request_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)}});
  expect(JSON.stringify(draft)).toBe(before); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toBe("https://api-nextgen-tools.iedb.org/api/v1/bcell_sequence");
  expect(fetcher.mock.calls[0][1].method).toBeUndefined(); expect(fetcher.mock.calls[0][1].body).toBeUndefined();
});
it.each([
  ["window_size", 0], ["window_size", 51], ["window_size", 1.5], ["window_size", "9"],
  ["pred", "other"], ["add_seq_len", "false"], ["add_seq_len", 0], ["top_cands", "0.2"],
])("reports native parameter mismatch %s=%j without coercion", async (key, value) => {
  stub(); const draft = stage(); Object.assign(draft.input_parameters.predictors[0], {[key]: value});
  const result = await run(pipeline([draft])); expect(result.validation.local_checks_passed).toBe(false); expect(result.validation.errors).toEqual(expect.arrayContaining([expect.objectContaining({path: `input_parameters.predictors[0].${key}`})]));
  expect(result.pipeline.stages[0].input_parameters.predictors[0][key]).toBe(value);
});
it.each([1, 50])("accepts the inclusive advertised window boundary %s", async window_size => {
  stub(); const draft = stage(); draft.input_parameters.predictors[0].window_size = window_size;
  expect((await run(pipeline([draft]))).validation.local_checks_passed).toBe(true);
});
it.each(["", "XX", "ACD*", ">empty", ">empty\n>next\nACDE", "P02185"])("reports unsupported direct sequence text %j", async input_sequence_text => {
  stub(); expect((await run(pipeline([{...stage(), input_sequence_text}]))).validation.errors).toEqual(expect.arrayContaining([expect.objectContaining({path: "input_sequence_text"})]));
});
it.each([[], [{}], [{type: "wrong", method: "bepipred-3.0"}], [{type: "ml_based", method: "unknown"}]].map(predictors => ({predictors})))("checks exact method/group selection %j", async ({predictors}) => {
  stub(); expect((await run(pipeline([{...stage(), input_parameters: {predictors}}]))).validation.local_checks_passed).toBe(false);
});
it("checks newly advertised methods without a hardcoded method list or applied defaults", async () => {
  stub({name: ["bcell_sequence"], predictors: [{short_name: "future", group: "new", necessary_parameters: [{key: "required", type: "int"}, {key: "with_default", type: "bool", default: false}]}]});
  const draft = pipeline([{...stage(), input_parameters: {predictors: [{type: "new", method: "future", required: 0}]}}]);
  const result = await run(draft); expect(result.validation.local_checks_passed).toBe(true); expect(result.pipeline).toEqual(draft);
  delete (draft.stages[0] as any).input_parameters.predictors[0].required;
  expect((await run(draft)).validation.local_checks_passed).toBe(false);
});
it("retains unknown parameters and marks them unassessed", async () => {
  stub(); const draft = stage(); Object.assign(draft.input_parameters.predictors[0], {future: {value: 0}});
  const result = await run(pipeline([draft])); expect(result.validation.local_checks_passed).toBe(true); expect(result.validation.unassessed[0].path).toBe("input_parameters.predictors[0].future"); expect(result.pipeline.stages[0]).toEqual(draft);
});

it("distinguishes missing direct parameters from unresolved saved parameters", async () => {
  stub(); const draft = {...stage(), input_parameters: null};
  expect((await run(pipeline([draft]))).validation.errors[0].path).toBe("input_parameters");
  const saved = await run(pipeline([{...draft, input_parameters_id: "saved"}]));
  expect(saved.validation.errors).toEqual([]); expect(saved.validation.unassessed[0].path).toBe("input_parameters");
});

it("reports cross-mode stage fields and unknown pipeline fields without discarding them", async () => {
  stub(); const draft = {...pipeline([{...stage(), structure_id: "5LYM"}]), extension: false};
  const result = await run(draft); expect(result.pipeline).toEqual(draft);
  expect(result.validation).toMatchObject({unassessed_pipeline_fields: ["extension"], unassessed: [expect.objectContaining({path: "structure_id"})]});
});
it("retains saved input references and unselected/non-B-cell stages without claiming their validation", async () => {
  const fetcher = stub(); const selected = {...stage(), stage_number: 2, input_sequence_text_id: "saved", input_parameters_id: "params"};
  const result = await run({...pipeline([{...stage(), tool_group: "mhci"}, selected, {...stage(), stage_number: 3, tool_group: "mhcii"}]), run_stage_range: [2, 3]});
  expect(result.validation).toMatchObject({checked_stage_numbers: [2, 3], unselected_stage_numbers: [1], unassessed: expect.arrayContaining([expect.objectContaining({path: "input_sequence_text_id"}), expect.objectContaining({path: "tool_group", stage_number: 3})])});
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("reads each unique metadata source once for a mixed ten-stage draft", async () => {
  const fetcher = vi.fn().mockImplementation(async (url: URL) => Response.json(metadata(url.pathname.split("/").pop()))); vi.stubGlobal("fetch", fetcher);
  const stages = Array.from({length: 10}, (_, i) => i % 2 ? {stage_number: i + 1, tool_group: "bcell_structure", structure_id: "5LYM", input_parameters: {structure_type: "solved", pdb_chain: "A", predictors: [{type: "structure_based", method: "ellipro", max_distance: 6}]}} : {...stage(), stage_number: i + 1});
  const result = await run(pipeline(stages)); expect(fetcher).toHaveBeenCalledTimes(2); expect(result.validation.errors).toEqual([]); expect(result.validation.unassessed).toHaveLength(5);
});
it.each([
  {structure_id: "5LYM", input_pdb_text: "ATOM..."}, {structure_id: 5}, {structure_id: ""},
])("reports invalid direct structure inputs %j", async inputs => {
  stub(metadata("bcell_structure")); const result = await run(pipeline([{stage_number: 1, tool_group: "bcell_structure", ...inputs, input_parameters: {structure_type: "solved", predictors: [{type: "structure_based", method: "ellipro"}]}}]));
  expect(result.validation.local_checks_passed).toBe(false);
});
it("flags metadata/client chain discrepancies and scientific structure checks without rewriting fields", async () => {
  stub(metadata("bcell_structure")); const draft = pipeline([{stage_number: 1, tool_group: "bcell_structure", input_pdb_text: "ATOM native input", input_parameters: {structure_type: "alphafold", structure_chain: "A", predictors: [{type: "structure_based", method: "ellipro"}]}}]);
  const result = await run(draft); expect(result.pipeline).toEqual(draft); expect(result.validation.unassessed.map((x: any) => x.path)).toEqual(["input_pdb_text", "input_parameters.structure_chain"]);
});
it.each([null, {}, {name: ["other"], predictors: []}, {name: ["bcell_sequence"], predictors: [null]}])("fails explicitly on unusable metadata %j", async native => {
  stub(native); await expect(run()).rejects.toMatchObject({status: 502, data: {provider_response: native, submission_state_unknown: false}});
});
it.each([{status: 206}, {status: 200, headers: {"Content-Range": "bytes 0-1/8"}}])("rejects partial metadata and retains source evidence %j", async ({status, headers}) => {
  stub(metadata(), status, headers); await expect(run()).rejects.toMatchObject({status: 502, data: {native_body_complete: true, provider_response: metadata(), submission_state_unknown: false}});
});
it("retains failed metadata without suggesting a job may have been submitted", async () => {
  const fetcher = stub({errors: ["unavailable"]}, 503);
  await expect(run()).rejects.toMatchObject({status: 503, data: {submission_state_unknown: false, provider_response: {errors: ["unavailable"]}}}); expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([
  {method: "GET", path: "/ng/pipeline/validate"},
  {method: "POST", path: "/ng/pipeline/validate", params: {submit: true}, body: pipeline()},
  {method: "POST", path: "/ng/pipeline/validate", body: {...pipeline(), email: "notify@example.com"}},
  {method: "POST", path: "/ng/pipeline/validate", body: pipeline([{...stage(), tool_group: "mhci"}])},
])("rejects unsupported local requests before network %j", async request => {
  const fetcher = stub(); await expect(api(request as Parameters<typeof api>[0])).rejects.toMatchObject({status: 400}); expect(fetcher).not.toHaveBeenCalled();
});
it("executes the discoverable preflight recipe without an external POST", async () => {
  const fetcher = stub(); const result = await new Function("api", `return (async () => {${bcellPreflightWorkflow.code}})();`)({post: async (path: string, body: unknown) => (await api({method: "POST", path, body})).data});
  expect(result.validation.local_checks_passed).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(iedbCatalog.endpoints.some(x => x.path === "/ng/pipeline/validate" && x.method === "POST")).toBe(true);
  expect(iedbCatalog.endpointCount).toBe(iedbCatalog.endpoints.length);
});
