import {fail, record} from "./ng-http";

function noNotifications(value: unknown, depth = 0): void {
  if (depth > 30) fail("Pipeline JSON is nested too deeply");
  if (Array.isArray(value)) { for (const item of value) noNotifications(item, depth + 1); }
  else if (record(value)) for (const [key, item] of Object.entries(value)) {
    if (key.toLowerCase() === "email" && item !== "" && item !== null) fail("Email notification is not supported by this prediction adapter");
    noNotifications(item, depth + 1);
  }
}

/** The same envelope and byte bound apply to a dry run and an actual submission. */
export function encodePipeline(body: unknown): string {
  if (!record(body) || !Array.isArray(body.stages) || !body.stages.length || body.stages.length > 10) fail("Use a native pipeline object with 1–10 stages");
  const stages = body.stages;
  if (body.pipeline_id !== "") fail("New submissions require pipeline_id='' to avoid altering existing pipelines");
  if (!Array.isArray(body.run_stage_range) || body.run_stage_range.length !== 2 || body.run_stage_range.some(n => !Number.isInteger(n) || n < 1 || n > stages.length) || body.run_stage_range[0] > body.run_stage_range[1]) fail("run_stage_range must select existing stages");
  stages.forEach((stage, index) => {
    if (!record(stage) || stage.stage_number !== index + 1 || typeof stage.tool_group !== "string" || !/^[a-z][a-z0-9_]{0,49}$/.test(stage.tool_group)) fail("Stages require consecutive stage_number and native tool_group");
  });
  noNotifications(body);
  let encoded: string;
  try { encoded = JSON.stringify(body); } catch { fail("Pipeline must be JSON serializable"); }
  if (new TextEncoder().encode(encoded).length > 256 * 1024) fail("Pipeline body exceeds 256 KiB");
  return encoded;
}
