import type {ApiFetchFn} from "@bio-mcp/shared/codemode/catalog";
import {fail, readJson, record} from "./ng-http";
import {parameterTools} from "./parameter-tools";
import {predictionState} from "./result-state";
import {encodePipeline} from "./pipeline-input";
import {bcellPreflight} from "./bcell-preflight";
const BASE = "https://api-nextgen-tools.iedb.org/api/v1";
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
export const nextgenFetch: ApiFetchFn = async request => {
  if (request.params && Object.keys(request.params).length) fail("Next-Generation routes do not accept query parameters here");
  const path = request.path.slice(3);
  if (path === "/pipeline/validate") {
    if (request.method !== "POST") fail("Local pipeline validation accepts POST with a draft; no prediction is submitted");
    return bcellPreflight(request.body);
  }
  const parameters = parameterTools.some(([name]) => path === `/${name}`);
  const version = path === "/version_info";
  const submit = request.method === "POST" && path === "/pipeline";
  let body: string | undefined;
  if (submit) body = encodePipeline(request.body);
  else {
    if (request.method !== "GET" || request.body !== undefined) fail("Use POST /ng/pipeline to submit or GET to inspect an existing job");
    const parts = path.split("/");
    if (!parameters && !version && (parts.length !== 3 || !["pipeline", "stage", "results", "pipeline_spec", "get_object"].includes(parts[1]) || !identifier.test(parts[2]))) fail("Use version_info, a documented parameter route or a returned pipeline, stage, result, pipeline_spec or input-object identifier");
  }
  const result = await readJson(new URL(`${BASE}${path}`), {method: request.method, ...(body ? {body} : {})}, {requireCompleteResponse: true});
  if (version) return {status: result.status, data: {data: result.data, _mcp: {
    ...result.provenance, resource_kind: "service_version", complete: false,
    provider_schema_validated: false, prediction_version_pinned: false,
    note: "Observed service version metadata. Preserve native component names and values; this does not pin the version used by an existing job, its predictor models, or the IQ-API database release.",
  }}};
  if (path.startsWith("/get_object/")) return {status: result.status, data: {data: result.data, _mcp: {
    ...result.provenance, resource_kind: "input_object", object_id: path.slice("/get_object/".length),
    complete: false, status: null, has_errors: null, provider_schema_validated: false,
    prediction_is_experimental_evidence: false,
    note: "Saved provider input object, not a prediction result. Retain its identifier, native value and hash alongside the referring pipeline/stage. Do not infer structure format, chain selection, method version or successful prediction from the object alone.",
  }}};
  return buildPredictionResult(result, submit, parameters, path, request, body);
};

async function buildPredictionResult(result: { data: unknown; status: number; provenance: { source_url: string; retrieved_at: string; response_sha256: string; http_status: number; decoded_bytes: number; content_type: string | null; content_range: string | null; retry_after: string | null; }; }, submit: boolean, parameters: boolean, path: string, request: { method: string; path: string; params?: Record<string, unknown>; body?: unknown; }, body: string | undefined) {
  if (!record(result.data)) fail("IEDB Next-Generation returned a non-object envelope", 502, {submission_state_unknown: submit});
  const native = result.data;
  const { status, hasErrors, hasResultTables } = predictionState(native);
  if (submit && !hasErrors && (typeof native.pipeline_id !== "string" || !identifier.test(native.pipeline_id) || typeof native.result_id !== "string" || !identifier.test(native.result_id))) fail("IEDB submission response lacks usable job identifiers; do not automatically resubmit", 502, { submission_state_unknown: true, provider_response: native });
  // Keep all tables, columns, numeric strings, errors and warnings in their native positions.
  return {
    status: result.status, data: {
      data: native, _mcp: {
        ...result.provenance, status, has_errors: hasErrors,
        resource_kind: parameters ? "parameter_metadata" : "prediction",
        tool_group: parameters ? path.slice(1) : undefined,
        complete: request.path.startsWith("/ng/results/") && status === "done" && !hasErrors && hasResultTables,
        submission_accepted: submit ? !hasErrors : undefined,
        result_path: submit && typeof native.result_id === "string" && identifier.test(native.result_id) ? `/ng/results/${native.result_id}` : undefined,
        pipeline_path: submit && typeof native.pipeline_id === "string" && identifier.test(native.pipeline_id) ? `/ng/pipeline/${native.pipeline_id}` : undefined,
        request_sha256: body ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))), b => b.toString(16).padStart(2, "0")).join("") : undefined,
        provider_schema_validated: false, prediction_is_experimental_evidence: false,
        note: parameters
          ? "Current provider parameter metadata, not prediction results or a complete pipeline submission schema. Preserve native names, versions, defaults, choices and predictor groups. Discovery does not validate a submitted payload or create a job."
          : "The provider determines whether native pipeline parameters are accepted. Poll returned IDs in separate calls; do not resubmit after a transport failure. Predictions are distinct from curated assay evidence; retain chain/residue identifiers, structure quality, method versions, warnings and table metadata.",
      }
    }
  };
}
