import type {ApiEndpoint, WorkflowRecipe} from "@bio-mcp/shared/codemode/catalog";
import {parameterTools} from "../lib/parameter-tools";
import {bcellStructureWorkflow} from "./bcell-structure";
import {bcellPreflightEndpoint, bcellPreflightWorkflow} from "./bcell-preflight";
export const nextgenEndpoints: ApiEndpoint[] = [
  bcellPreflightEndpoint,
  {method: "GET", path: "/ng/version_info", category: "nextgen-metadata", summary: "Inspect current Next-Generation service version metadata", responseShape: "{data: <native JSON>, _mcp: {resource_kind: 'service_version', source_url, response_sha256, prediction_version_pinned: false, ...}}", usageHint: "Read-only, without query parameters or body. Preserve native component/version fields; current service metadata does not identify historical job versions, predictor models or the IQ-API database release."},
  {method: "GET", path: "/ng/get_object/{id}", category: "nextgen-inputs", summary: "Read a saved input object referenced by a pipeline or stage", pathParams: [{name: "id", type: "string", required: true, description: "Exact returned input object ID (for example input_parameters_id or input_sequence_text_id), never a URL."}],
    responseShape: "{data: <complete native JSON value>, _mcp: {resource_kind: 'input_object', object_id, complete: false, source_url, response_sha256, ...}}",
    usageHint: "Read only a returned ID. Preserve native strings, arrays, metadata and provenance with the referring stage. An input object is not a prediction result, a validated structure schema or evidence of job success. No URLs inside the object are followed."},
  ...parameterTools.map(([name, label]) => ({method: "GET" as const, path: `/ng/${name}`, category: "nextgen-parameters",
    summary: `Discover current parameters and methods: ${label}`,
    responseShape: "{data: <native provider metadata>, _mcp: {resource_kind: 'parameter_metadata', tool_group, source_url, response_sha256, ...}}",
    usageHint: "Read-only discovery; accepts no query parameters or body. Retain native parameters, necessary_parameters, optional_parameters, predictors, defaults, choices and versions when supplied. These vary by tool and do not define a complete pipeline payload. This call does not submit a prediction."})),
  {method: "POST", path: "/ng/pipeline", category: "nextgen", summary: "Submit a new asynchronous Next-Generation prediction pipeline once using native JSON", body: {contentType: "application/json", description: "Native pipeline object: pipeline_id='', run_stage_range and 1–10 stages with consecutive stage_number and tool_group. Maximum 256 KiB. B-cell structure client uses stage-level structure_id OR input_pdb_text, plus input_parameters containing structure_type (solved/alphafold), pdb_chain and predictors [{type:'structure_based',method:'discotope'|'ellipro'}]. Optional predictor max_distance is ElliPro's clustering distance in Angstroms (default 6). This client contract is source-reviewed, not live job acceptance. Email notification and updating an existing pipeline are unsupported."}, responseShape: "{data: <native submission response>, _mcp: {submission_accepted, result_path, pipeline_path, request_sha256, ...}}", usageHint: "POST creates a job. Do not automatically retry/resubmit after timeout: acceptance may be unknown. Persist returned IDs then use separate GET calls. Provider warnings/errors remain in data. For a reviewable B-cell draft, use the preparation recipe; metadata's structure_chain name differs from the web client's pdb_chain submission field."},
  ...["pipeline", "stage", "results", "pipeline_spec"].map(resource => ({method: "GET" as const, path: `/ng/${resource}/{id}`, category: "nextgen", summary: `Read native Next-Generation ${resource} by returned ID`, pathParams: [{name: "id", type: "string" as const, required: true, description: "Exact provider-returned ID, not an arbitrary result URL"}], responseShape: "{data: <native JSON>, _mcp: {status, complete, has_errors, ...}}", usageHint: "One read only. Results can be pending; only status=done with a non-input table containing table_columns/table_data arrays and no reported errors sets complete. Empty result lists and input-only tables remain incomplete. Retain all table_columns/table_data and warnings. Structure predictions require chain/residue coordinates, method and structure confidence context; scores are not curated experimental evidence."})),
  {method: "GET", path: "/query-link", category: "reproducibility", summary: "Read one bounded page from an exported IQ-API search link", queryParams: [{name: "url", type: "string", required: true, description: "HTTPS query-api.iedb.org table URL exported from the database Assays tab; preserves duplicate filters and ordering. limit defaults to 100, max 1000."}], usageHint: "Exported links describe mutable queries, not immutable data snapshots. Retain requested/effective URLs, source hash and update context."},
  {method: "GET", path: "/api_metrics", category: "metadata", summary: "Query available IQ-API tables, record counts and creation/update dates"},
];
export const nextgenWorkflows: WorkflowRecipe[] = [
  {title: "Submit one documented Next-Generation prediction job", keywords: ["async", "pipeline", "prediction", "mhci", "nextgen"], description: "Provider's single-stage MHC-I example. Submit once and retain returned job IDs; poll separately. For B-cell structures, use the separate client-derived preparation recipe; live job acceptance remains unverified.", code: `return await api.post("/ng/pipeline", {
  pipeline_id: "", run_stage_range: [1, 1], stages: [{
    stage_number: 1, tool_group: "mhci", input_sequence_text: "IVLIVITGI",
    input_parameters: {alleles: "H2-Kb", peptide_length_range: [9, 9], predictors: [{type: "binding", method: "netmhcpan_el"}]}
  }]
});`},
  {title: "Resume a Next-Generation B-cell or T-cell prediction", keywords: ["bcell", "structure", "DiscoTope", "ElliPro", "status", "results", "async"], description: "Replace the result ID with one returned by submission or pipeline inspection. Read status once; if incomplete, retain the ID and poll later without resubmitting. Native tables retain column/source/method and chain/residue metadata, warnings and errors.", code: `const resultId = "REPLACE_WITH_RETURNED_RESULT_ID";
const result = await api.get("/ng/results/" + resultId);
return {result_id: resultId, result, complete: result._mcp?.complete === true && !result.__api_error && !result.__staged && !result.__stage_error};`},
  {title: "Replay an exported IQ-API query with retrieval context", keywords: ["query-link", "export", "reproducibility", "assay", "metrics"], description: "Replace the example table URL with an Assays-tab export. This preserves query semantics within a bounded page; api_metrics is update context, not a snapshot pin.", code: `const metrics = await api.get("/api_metrics", {limit: 100});
const page = await api.get("/query-link", {url: "https://query-api.iedb.org/tcell_search?limit=10"});
return {metrics, page, immutable_snapshot: false, complete: false};`},
  {title: "Inspect B-cell structure parameters before preparing a prediction", keywords: ["bcell", "structure", "DiscoTope", "ElliPro", "parameters", "discovery"],
    description: "Fetch current provider metadata without creating a job. Inspect its native methods, defaults and input requirements. If staged, use the returned data_access_id with api.query or iedb_query_data. Do not infer a complete pipeline submission schema from parameter discovery alone.",
    code: `return await api.get("/ng/bcell_structure");`},
  {title: "Retain saved inputs with their prediction stage", keywords: ["input", "object", "provenance", "stage", "sequence", "parameters"],
    description: "Replace the stage ID with a returned ID. Retrieve up to three documented input objects by ID without following provider URLs or submitting a job. If stage details are staged, inspect them with SQL first. Retain native objects and their hashes; missing references do not establish complete input provenance.",
    code: `const stageId = "REPLACE_WITH_RETURNED_STAGE_ID";
const stage = await api.get("/ng/stage/" + stageId);
if (stage.__api_error || stage.__staged || stage.__stage_error) return {stage_id: stageId, stage};
const inputData = stage.data?.input_data ?? {};
const inputs = [];
for (const field of ["input_parameters_id", "input_sequence_text_id", "input_datasets_id"]) {
  const id = inputData[field];
  if (typeof id === "string" && id) inputs.push({field, id, object: await api.get("/ng/get_object/" + id)});
}
return {stage_id: stageId, stage, inputs, complete_input_provenance: false};`},
  bcellStructureWorkflow,
  bcellPreflightWorkflow,
];
