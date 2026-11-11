import type {ApiEndpoint, WorkflowRecipe} from "@bio-mcp/shared/codemode/catalog";

export const bcellPreflightEndpoint: ApiEndpoint = {
  method: "POST", path: "/ng/pipeline/validate", category: "nextgen-preflight",
  summary: "Validate a B-cell pipeline draft locally against current parameter metadata; never submit a job",
  body: {contentType: "application/json", description: "The same new-pipeline JSON envelope as /ng/pipeline. At least one selected B-cell structure/sequence stage; 1–10 stages, at most 256 KiB. Validation reads at most two public metadata endpoints with GET. It does not POST to the provider."},
  responseShape: "{pipeline, parameter_metadata, validation: {local_checks_passed, errors, unassessed, checked_stage_numbers, complete_submission_schema: false, provider_acceptance_verified: false}, _mcp: {submitted: false, complete: false, request_sha256, ...}}",
  usageHint: "This is an adapter-local operation, not an upstream endpoint. Inspect errors AND unassessed fields. It checks native method/type pairs, advertised parameter types/choices/limits and documented direct input layout without coercion/defaults. Structure identity, PDB syntax, chain membership, saved input references, other tool groups and provider job acceptance remain unassessed. Metadata and draft hashes do not pin execution versions. Pass a reviewed draft to /ng/pipeline separately only when a prediction is wanted.",
};

export const bcellPreflightWorkflow: WorkflowRecipe = {
  title: "Check a B-cell draft against current metadata without submitting a prediction",
  keywords: ["bcell", "validate", "preflight", "sequence", "structure", "window_size", "no job"],
  description: "Validate one direct B-cell sequence draft using current BepiPred method metadata. Returns native metadata, errors and unassessed fields; preserves original parameters and never submits a prediction. A passing local check is not provider acceptance or a prediction-quality assessment.",
  code: `return await api.post("/ng/pipeline/validate", {
  pipeline_id: "", run_stage_range: [1, 1], stages: [{
    stage_number: 1, stage_type: "prediction", tool_group: "bcell_sequence",
    input_sequence_text: ">example\\nACDEFGHIKLMNPQRSTVWY",
    input_parameters: {predictors: [{type: "ml_based", method: "bepipred-3.0", window_size: 9, pred: "vt_pred", add_seq_len: false}]}
  }]
});`,
};
