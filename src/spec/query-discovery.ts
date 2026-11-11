import type {ApiEndpoint, ParamDef, WorkflowRecipe} from "@bio-mcp/shared/codemode/catalog";

const paging: ParamDef[] = [
  {name: "limit", type: "number", required: false, description: "Page size 1–1000; default 100."},
  {name: "offset", type: "number", required: false, description: "Nonnegative safe-integer row offset; default 0. A page is not a complete dataset."},
  {name: "select", type: "string", required: false, description: "PostgREST column selection. Consult the published schema or exported UI query."},
  {name: "order", type: "string", required: false, description: "Native PostgREST order expression; choose an explicit order when paging mutable tables."},
];

export const queryDiscoveryEndpoints: ApiEndpoint[] = [
  {method: "GET", path: "/query/schema", category: "query-discovery", featured: true,
    summary: "Read the published IQ-API OpenAPI schema with native definitions and retrieval provenance",
    description: "Adapter helper for the provider's /docs/swagger/iedb_api.json. No parameters. Preserves info, paths, definitions and references. Search-table schemas may omit column/filter definitions; this does not prove that a filter is unsupported. This is not a prediction-job schema or data-release identifier. Large schemas retain existing Code Mode staging.",
    example: "return await api.get('/query/schema');"},
  {method: "GET", path: "/query/metrics", category: "query-discovery", featured: true,
    summary: "Read a bounded page of IQ-API table counts and creation/update metadata",
    description: "Adapter helper for /api_metrics. Native rows, Content-Range and response hash remain under data/_mcp. Preserve provider field names and date strings; no synchronized or immutable release is inferred. Not prediction-service/model version metadata. Page size alone cannot establish completeness.",
    queryParams: paging, example: "return await api.get('/query/metrics', {limit: 100, offset: 0});"},
  {method: "GET", path: "/epitope_export", category: "epitope", summary: "Read native epitope export rows, including structural and source context",
    queryParams: [{name: "structure_id", type: "string", required: false, description: "PostgREST filter on the IEDB epitope ID, e.g. eq.1. Retained as an operator expression."}, ...paging],
    description: "Native array response. The published schema describes export columns and filter references; use /query/schema for the full contract. Preserve modifications, coordinates and source identifiers without inferring a single record per page.",
    example: "return await api.get('/epitope_export', {structure_id: 'eq.1', limit: 10});"},
  {method: "GET", path: "/reference_export", category: "reference", summary: "Read native publication/submission export rows with source identifiers",
    queryParams: [{name: "reference_id", type: "string", required: false, description: "PostgREST IEDB reference-ID filter, e.g. eq.1."}, {name: "reference__pmid", type: "string", required: false, description: "PostgREST PubMed ID filter; this is not the IEDB reference ID."}, ...paging],
    description: "Native array response, retaining publication, submission and evolving-data reference distinctions. Discover reference__authors/title/date and other fields from /query/schema; no date normalization or inferred publication type.",
    example: "return await api.get('/reference_export', {reference_id: 'eq.1', limit: 10});"},
  {method: "GET", path: "/mhc_search", category: "assay", summary: "Search the documented IQ-API MHC ligand assay table",
    queryParams: paging,
    description: "Native array response. Use provider-exported UI queries for assay filters; the published search-table schema does not enumerate all filter fields. /mhc_ligand_search remains an adapter compatibility alias to this route.",
    example: "return await api.get('/mhc_search', {limit: 10});"},
];

export const queryMetadataWorkflow: WorkflowRecipe = {
  title: "Inspect IQ-API data update context before replaying a saved query",
  keywords: ["IQ-API", "api_metrics", "release", "update", "provenance", "query"],
  description: "Read one metadata page; retain original table counts and update dates alongside a subsequent /query-link result. They describe mutable tables and do not freeze the query or report prediction-model versions. Staged results remain intact for iedb_get_schema/iedb_query_data.",
  code: 'return await api.get("/query/metrics", {limit: 100, offset: 0});',
};
