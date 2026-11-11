import type { WorkflowRecipe } from "@bio-mcp/shared/codemode/catalog";

/** Provider main.js onRun/convertBCellStructureForm, reviewed 2026-10-01. */
export const bcellStructureWorkflow: WorkflowRecipe = {
  title: "Prepare a B-cell structure pipeline without submitting a job",
  keywords: ["bcell", "structure", "DiscoTope", "ElliPro", "pdb_chain", "PDB", "prepare"],
  description: "Build the provider web client's single-stage payload for solved PDB 5LYM chain A. Edit structure ID, chain and methods for the intended antigen. Reads current method metadata and returns a draft only. The client sends pdb_chain in input_parameters, despite metadata listing structure_chain. A client-derived payload is not live job acceptance. Preserve structure provenance and model confidence separately.",
  code: `const metadata = await api.get("/ng/bcell_structure");
if (!metadata || metadata.__api_error || metadata.__staged || metadata.__stage_error) return metadata;
const available = metadata.data?.predictors;
const predictors = [
  {type: "structure_based", method: "discotope"},
  {type: "structure_based", method: "ellipro", max_distance: 6}
];
if (!Array.isArray(available) || predictors.some(p => !available.some(m => m && m.short_name === p.method && m.group === p.type))) {
  throw new Error("Requested structure methods are absent from current provider metadata");
}
const pipeline = {
  pipeline_id: "", run_stage_range: [1, 1], stages: [{
    stage_number: 1, stage_type: "prediction", tool_group: "bcell_structure",
    structure_id: "5LYM",
    input_parameters: {structure_type: "solved", pdb_chain: "A", predictors}
  }]
};
return {pipeline, metadata, submitted: false, provider_acceptance_verified: false};`,
};
