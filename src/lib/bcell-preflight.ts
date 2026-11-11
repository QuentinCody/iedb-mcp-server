import {fail, readJson, record} from "./ng-http";
import {encodePipeline} from "./pipeline-input";
import {validateBcellInput} from "./bcell-input";
import type {PreflightIssue} from "./bcell-parameters";

export const BCELL_PREFLIGHT_POLICY = "2026-10-06-native-metadata";

/** Local operation: at most two public metadata GETs, never a provider POST. */
export async function bcellPreflight(body: unknown) {
  const encoded = encodePipeline(body);
  const pipeline = JSON.parse(encoded) as {stages: Record<string, unknown>[]; run_stage_range: number[]};
  const selected = pipeline.stages.slice(pipeline.run_stage_range[0] - 1, pipeline.run_stage_range[1]);
  const issues: PreflightIssue[] = [];
  const { metadata, hash } = await validateBcellStages(selected, issues, encoded);
  return {status: 200, data: {pipeline, parameter_metadata: metadata, validation: {
    policy_version: BCELL_PREFLIGHT_POLICY, local_checks_passed: !issues.some(issue => issue.kind === "error"),
    errors: issues.filter(issue => issue.kind === "error"), unassessed: issues.filter(issue => issue.kind === "unassessed"),
    checked_stage_numbers: selected.map(stage => stage.stage_number), unselected_stage_numbers: pipeline.stages.filter(stage => !selected.includes(stage)).map(stage => stage.stage_number),
    unassessed_pipeline_fields: Object.keys(pipeline).filter(key => !["pipeline_id", "run_stage_range", "stages"].includes(key)),
    provider_acceptance_verified: false, complete_submission_schema: false,
  }, _mcp: {resource_kind: "pipeline_preflight", complete: false, submitted: false, provider_schema_validated: false,
    request_sha256: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join(""),
    note: "Local B-cell checks against observed metadata and the reviewed client layout. Original serialized input is retained without defaults or coercion. Unassessed fields remain explicit. This does not submit a job, prove provider acceptance, pin execution versions or validate prediction quality.",
  }}};
}

async function validateBcellStages(selected: Record<string, unknown>[], issues: PreflightIssue[], encoded: string) {
  const groups = [...new Set(selected.map(stage => stage.tool_group).filter(group => group === "bcell_structure" || group === "bcell_sequence"))] as string[];
  if (!groups.length) fail("Select at least one B-cell structure or sequence stage for this local preflight");
  const metadata = await Promise.all(groups.map(async (tool_group) => {
    const result = await readJson(new URL(`https://api-nextgen-tools.iedb.org/api/v1/${tool_group}`), {}, { requireCompleteResponse: true });
    const native = result.data;
    if (!record(native) || !Array.isArray(native.name) || !native.name.includes(tool_group) || !Array.isArray(native.predictors) || !native.predictors.length
      || native.predictors.some(row => !record(row) || typeof row.short_name !== "string" || !row.short_name || typeof row.group !== "string" || !row.group)) {
      fail("B-cell parameter metadata has an unrecognized shape", 502, { provider_response: native, ...result.provenance, submission_state_unknown: false });
    }
    return { tool_group, data: native, provenance: result.provenance };
  }));
  for (const stage of selected) {
    const add = (path: string, message: string, kind: PreflightIssue["kind"] = "error") => issues.push({ stage_number: Number(stage.stage_number), path, message, kind });
    const source = metadata.find(row => row.tool_group === stage.tool_group);
    if (source) validateBcellInput(stage, source.data, add);
    else add("tool_group", "Selected non-B-cell stage is outside this preflight", "unassessed");
  }
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encoded));
  return { metadata, hash };
}
