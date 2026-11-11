import {record} from "./ng-http";
import {validatePredictors, type AddIssue} from "./bcell-parameters";

const text = (value: unknown) => typeof value === "string" && value.trim().length > 0;

function sequence(value: unknown, add: AddIssue) {
  if (!text(value)) { add("input_sequence_text", "Provide nonempty plain or FASTA sequence text"); return; }
  let residues = 0; let header = false;
  for (const line of (value as string).split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.startsWith(">")) {
      if (header && !residues) add("input_sequence_text", "FASTA record has no residues");
      header = true; residues = 0; continue;
    }
    const letters = line.replace(/\s/g, "");
    if (!/^[ACDEFGHIKLMNPQRSTVWY]+$/i.test(letters)) { add("input_sequence_text", "B-cell sequence input requires the 20 standard amino-acid letters; resolve identifiers before validation"); return; }
    residues += letters.length;
  }
  if (!residues) add("input_sequence_text", "Sequence record has no residues");
}

/** Client-derived placement checks; structure parsing and saved-input resolution are not performed. */
export function validateBcellInput(stage: Record<string, unknown>, metadata: Record<string, unknown>, add: AddIssue) {
  const structure = stage.tool_group === "bcell_structure";
  if (stage.stage_type !== undefined && stage.stage_type !== "prediction") add("stage_type", "Only direct prediction stages are assessed", "unassessed");
  const stageKeys = ["stage_number", "stage_type", "tool_group", "name", "input_parameters", "input_parameters_id",
    ...(structure ? ["structure_id", "input_pdb_text", "input_pdb_text_id"] : ["input_sequence_text", "input_sequence_text_id"])];
  for (const key of Object.keys(stage)) if (!stageKeys.includes(key)) add(key, "Stage field is not assessed by this validator", "unassessed");
  const input = stage.input_parameters;
  if (!record(input)) { add("input_parameters", "Direct-input validation requires an input_parameters object; saved input references are not resolved", stage.input_parameters_id === undefined ? "error" : "unassessed"); return; }
  if (stage.input_parameters_id !== undefined) add("input_parameters_id", "Saved parameter references are not resolved; precedence is unassessed", "unassessed");
  validatePredictors(input.predictors, metadata, add);
  if (structure) {
    for (const key of ["structure_id", "input_pdb_text"]) if (stage[key] !== undefined && !text(stage[key])) add(key, "Direct structure inputs must be nonempty strings");
    if (stage.input_pdb_text_id !== undefined) add("input_pdb_text_id", "Saved structure references are not resolved", "unassessed");
    const keys = ["structure_id", "input_pdb_text"].filter(key => text(stage[key]));
    if (keys.length !== 1 && stage.input_pdb_text_id === undefined) add("structure_id", "Provide exactly one nonempty stage-level structure_id or input_pdb_text");
    if (keys.length > 1) add("input_pdb_text", "Structure identifier and structure text are alternative inputs");
    if (!["solved", "alphafold"].includes(String(input.structure_type))) add("input_parameters.structure_type", "Client-derived contract requires solved or alphafold");
    if (input.pdb_chain !== undefined && !text(input.pdb_chain)) add("input_parameters.pdb_chain", "Only nonempty text chain selectors are assessed", "unassessed");
    if (keys.length) add(keys[0], "Structure existence, file syntax, chain membership and model confidence require provider/structure validation", "unassessed");
  } else if (stage.input_sequence_text_id !== undefined) add("input_sequence_text_id", "Saved sequence references are not resolved", "unassessed");
  else sequence(stage.input_sequence_text, add);
  const known = structure ? ["predictors", "structure_type", "pdb_chain"] : ["predictors"];
  for (const key of Object.keys(input)) if (!known.includes(key)) {
    if (["structure_id", "input_pdb_text", "input_sequence_text"].includes(key)) add(`input_parameters.${key}`, "The provider client places this input on the stage");
    else add(`input_parameters.${key}`, key === "structure_chain" ? "Metadata lists structure_chain, but the reviewed client submits pdb_chain; this field is not renamed" : "Stage parameter is not assessed by this validator", "unassessed");
  }
}
