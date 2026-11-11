import { afterEach, expect, it, vi } from "vitest";
import { bcellStructureWorkflow } from "./bcell-structure";
import { iedbCatalog } from "./catalog";
import { createIedbApiFetch } from "../lib/api-adapter";

// Transcribed observed metadata fields; HTTP acceptance is tested separately.
const metadata = { data: { name: ["bcell_structure"], parameters: ["structure_id", "input_pdb_text", "structure_type", "structure_chain", "predictors"], predictors: [
  { short_name: "discotope", group: "structure_based" },
  { short_name: "ellipro", group: "structure_based", optional_parameters: [{ key: "max_distance", default: 6 }] },
] }, _mcp: { resource_kind: "parameter_metadata", complete: false, response_sha256: "fixture" } };
const pipeline = { pipeline_id: "", run_stage_range: [1, 1], stages: [{
  stage_number: 1, stage_type: "prediction", tool_group: "bcell_structure", structure_id: "5LYM",
  input_parameters: { structure_type: "solved", pdb_chain: "A", predictors: [
    { type: "structure_based", method: "discotope" },
    { type: "structure_based", method: "ellipro", max_distance: 6 },
  ] },
}] };
const run = (api: unknown) => new Function("api", `return (async () => {${bcellStructureWorkflow.code}})();`)(api);
afterEach(() => vi.unstubAllGlobals());

it("discovers a client-shaped draft with current metadata and no submission", async () => {
  expect(iedbCatalog.workflows).toContainEqual(bcellStructureWorkflow);
  const get = vi.fn().mockResolvedValue(metadata);
  const post = vi.fn();
  expect(await run({ get, post })).toEqual({ pipeline, metadata, submitted: false, provider_acceptance_verified: false });
  expect(get).toHaveBeenCalledExactlyOnceWith("/ng/bcell_structure");
  expect(post).not.toHaveBeenCalled();
  expect(pipeline.stages[0].input_parameters).not.toHaveProperty("structure_chain");
  expect(pipeline.stages[0].input_parameters).not.toHaveProperty("structure_id");
});

it.each([null, { __api_error: true, status: 503 }, { __staged: true, data_access_id: "metadata" }, { __stage_error: true }])("returns unavailable or staged metadata intact %#", async value => {
  const post = vi.fn();
  expect(await run({ get: async () => value, post })).toBe(value);
  expect(post).not.toHaveBeenCalled();
});

it.each([undefined, [], [null], [{ short_name: "discotope", group: "structure_based" }], [
  { short_name: "discotope", group: "other" }, { short_name: "ellipro", group: "structure_based" },
]])("does not produce an apparently supported draft when method metadata differs %#", async predictors => {
  const post = vi.fn();
  await expect(run({ get: async () => ({ data: { predictors } }), post })).rejects.toThrow("absent from current provider metadata");
  expect(post).not.toHaveBeenCalled();
});

it.each(["id", "text"])("preserves the native B-cell %s payload through existing POST transport", async kind => {
  const stage = { ...pipeline.stages[0] } as Record<string, unknown>;
  if (kind === "text") {
    delete stage.structure_id;
    stage.input_pdb_text = "HEADER    SYNTHETIC FIXTURE\nATOM      1  CA  ALA A   1\nEND\n";
    stage.input_parameters = { ...pipeline.stages[0].input_parameters, structure_type: "alphafold", pdb_chain: "B" };
  }
  const body = { ...pipeline, stages: [stage] };
  const fetcher = vi.fn().mockResolvedValue(Response.json({ pipeline_id: "fixture-pipeline", result_id: "fixture-result", warnings: [] }));
  vi.stubGlobal("fetch", fetcher);
  const result = await createIedbApiFetch()({ method: "POST", path: "/ng/pipeline", body });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toBe("https://api-nextgen-tools.iedb.org/api/v1/pipeline");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(body);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "manual" });
  expect(result.data).toMatchObject({ _mcp: { complete: false, submission_accepted: true, provider_schema_validated: false, request_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) } });
});
