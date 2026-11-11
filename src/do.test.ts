import {expect, it, vi} from "vitest";
import {detectArrays} from "@bio-mcp/shared/staging/schema-inference";
vi.mock("@bio-mcp/shared/staging/rest-staging-do", () => ({RestStagingDO: class {}}));
import {IedbDataDO} from "./do";

// SAFETY: call the pure projection hooks without constructing a Worker DO.
const proto = IedbDataDO.prototype as unknown as {
  getTabularData: (data: unknown) => unknown;
  getSchemaHints: (data: unknown) => {tableName?: string} | undefined;
};

it("unwraps a wrapper-staged MCP envelope to its epitope rows", () => {
  const rows = [{epitope_id: 1, linear_sequence: "SIINFEKL", organism_name: "x"}, {epitope_id: 2, linear_sequence: "GILGFVFTL", organism_name: "y"}];
  const envelope = {content: [{type: "text", text: "summary"}], structuredContent: {success: true, data: rows, _meta: {}}};
  const arrays = detectArrays(proto.getTabularData(envelope));
  expect(arrays).toHaveLength(1);
  expect(arrays[0].rows).toHaveLength(2);
  expect(arrays[0].rows[0]).toMatchObject({linear_sequence: "SIINFEKL"});
  expect(proto.getSchemaHints(envelope)?.tableName).toBe("epitopes");
});

it("leaves a raw payload unchanged", () => {
  const raw = [{allele: "HLA-A*02:01", ic50: 12.5}];
  expect(proto.getTabularData(raw)).toBe(raw);
  expect(proto.getSchemaHints(raw)?.tableName).toBe("mhc_predictions");
});
