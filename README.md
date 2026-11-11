# IEDB MCP Server

This is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. It lets MCP clients (Claude Desktop, Claude Code, Continue, etc.) query the upstream IEDB API in natural language. It is part of the [Bio MCP](../../README.md) monorepo.

## Connect

The server is deployed and ready at:

```
https://iedb-mcp-server.quentincody.workers.dev/mcp
```

Add it to your MCP client (Claude Desktop → Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "iedb": {
      "command": "npx",
      "args": ["mcp-remote", "https://iedb-mcp-server.quentincody.workers.dev/mcp"]
    }
  }
}
```

For local development the server runs at `http://localhost:8840/mcp` (start it with `./scripts/dev-servers.sh iedb`):

```json
{
  "mcpServers": {
    "iedb-local": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:8840/mcp"]
    }
  }
}
```

## Tools

- `iedb_search` — discover available API operations (Code Mode catalog and workflow search)
- `iedb_execute` — **Code Mode**: write JavaScript in a V8 isolate (`api.get()` / `api.post()` / `searchSpec()`) instead of issuing tool calls one by one
- `iedb_query_data` — run SQL over large responses auto-staged into a per-session SQLite database
- `iedb_get_schema` — inspect the inferred schema of a staged dataset

All four tool families also have `mcp_` aliases. The older standalone prediction-tool source files are not registered; access legacy predictions through Code Mode.

Large responses (>30KB) are auto-staged into a queryable SQLite database; the tools return a `data_access_id` you can query with SQL.

Every tool returns both a human-readable `content` summary and a structured `structuredContent` payload.

## Query API schema and routing

The [published IQ-API schema](https://query-api.iedb.org/docs/swagger/iedb_api.json)
identifies `/mhc_search`, `/epitope_export` and `/reference_export`. The existing
`/mhc_ligand_search` call now maps to `/mhc_search`, forwarding native filter
expressions unchanged. `/epitope/{epitope_id}` and `/reference/{reference_id}`
are adapter helpers for the export tables using `structure_id=eq.<id>` and
`reference_id=eq.<id>`. They accept positive safe-integer IDs and no query
parameters, verify every returned ID, and retain array responses, including
empty results. Use the native export routes for paging, column selection or
other PostgREST filters. IEDB reference IDs are distinct from PubMed IDs.

```javascript
return await api.get('/epitope_export', {structure_id: 'eq.1', limit: 10});
```

`GET /query/schema` returns the complete published schema under `data`, with
retrieval time, source URL and response hash under `_mcp`. Native `$ref` values,
definitions and parameters are preserved. Some search-table definitions omit
filter fields, so absence from that schema does not establish filter rejection.
The schema's observed `info.version` is `0.1`; it is not a data-release or
prediction-model version. The legacy organism/disease search catalog entries
are marked unverified; prefer documented export fields or provider-exported
`/query-link` queries.

`GET /query/metrics` wraps the existing native `/api_metrics` table with bounded
reads and source evidence. It preserves provider count/date fields verbatim,
plus `Content-Range`; no synchronized or immutable release is inferred. The
original `/api_metrics` call retains its native array contract.

```javascript
return await api.get('/query/metrics', {limit: 100, offset: 0});
```

Table reads on these new and repaired routes default to 100 rows, cap pages at 1,000,
and retain the existing 4 MiB/50-second bounded reader and Code Mode staging.
A page is not a full-table export. Native HTTP errors retain their status and
bounded bodies; ID/schema/shape failures retain the observed provider response.
No prediction or other job is submitted. **180 focused tests**, TypeScript,
lint and ten static checks pass; live Worker/provider acceptance remains pending.

## Next-Generation prediction jobs

### Check a B-cell draft without creating a job

`POST /ng/pipeline/validate` is a **local adapter operation**. It accepts the
same new-pipeline envelope as `/ng/pipeline`, then makes at most two public GETs
for the selected B-cell structure/sequence metadata. It never POSTs to IEDB.
Search for “Check a B-cell draft against current metadata without submitting a
prediction” for an executable example.

The response retains the original serialized `pipeline`, its request hash, each
native `parameter_metadata` response and its retrieval/hash evidence. Inspect
`validation.errors`, `validation.unassessed` and
`validation.unassessed_pipeline_fields` alongside `local_checks_passed`.
Passing the local checks does not establish provider acceptance; the full
submission schema and execution version remain unverified. Unselected stages
are listed separately. No defaults, field renaming or numeric coercion occurs.

Checks cover exact current method/type pairs, advertised integer/float/string/
boolean parameters, choices, numeric bounds and required fields without a
published default. Direct sequence input uses the 20 standard amino-acid
letters in plain text or FASTA. Direct structure inputs follow the reviewed
client layout: one stage-level `structure_id` or `input_pdb_text`, with
`structure_type` under `input_parameters`. The client/metadata discrepancy
between `pdb_chain` and `structure_chain` remains explicit. Structure existence,
PDB syntax, chain membership, model confidence, saved-input references and
unrecognized fields or tool groups remain unassessed.

Only a separate, intentional `/ng/pipeline` call submits a prediction. That
existing route retains its native payload behavior and envelope limits. Both
routes share the 256 KiB input bound. Next-Generation metadata/results reject
partial HTTP responses; IQ-API row pagination continues accepting its native
206 responses. Full error evidence and citation-backed large results remain
recoverable through `iedb_query_data`, including chunked `payloads` data.

October 6 validation passes 466 focused tests and 282 stateless MCP/Node SQLite
calls with 272 inline and ten staged citation proofs. Saved October 1 B-cell
metadata is replayed; large extensions and errors are synthetic. The replay
performs zero upstream POSTs. Fresh provider reads, edited Workerd and prediction
job acceptance remain unqualified. See the
[preflight review](../../docs/audits/2026-10-06-iedb-bcell-preflight-review.md).

### Submit and inspect a prediction

`POST /ng/pipeline` maps to the documented production endpoint at `https://api-nextgen-tools.iedb.org/api/v1/pipeline` and accepts native JSON. Submit once, retain the returned pipeline/result IDs, and inspect them in separate calls:

```js
return await api.post("/ng/pipeline", {
  pipeline_id: "",
  run_stage_range: [1, 1],
  stages: [{
    stage_number: 1,
    tool_group: "mhci",
    input_sequence_text: "IVLIVITGI",
    input_parameters: {
      alleles: "H2-Kb",
      peptide_length_range: [9, 9],
      predictors: [{type: "binding", method: "netmhcpan_el"}]
    }
  }]
});
```

Use `GET /ng/results/{id}`, `/ng/pipeline/{id}`, `/ng/stage/{id}` or `/ng/pipeline_spec/{id}` with returned IDs. The adapter retains the native envelope under `data`, with status, completion and source/hash context under `_mcp`. Only a `done` result containing a non-input table with nonempty `table_columns` and an array of `table_data`, without reported errors, sets `complete`. Empty result lists and input-only tables remain incomplete; a valid output table may contain zero rows. Warnings remain visible. It never follows arbitrary returned URLs or automatically resubmits. A failed submission response can leave job acceptance unknown.

### Service version and error evidence

`GET /ng/version_info` exposes the service metadata endpoint listed in the
[provider API index](https://api-nextgen-tools.iedb.org/apidocs). It takes no body
or query options. Native component names, versions and other fields remain under
`data`, with source URL, retrieval time and response hash under `_mcp`. Its
`resource_kind` is `service_version`. This is an observation of the current
service; it does not pin an existing job's runtime, model version or the separate
IQ-API database release. No particular field schema or live version is assumed.

```javascript
return await api.get("/ng/version_info");
```

Next-Generation and exported-query-link HTTP errors now retain their full bounded
native body, parsed JSON when available, HTTP status, retry timing and response
hash. Large error evidence is staged in the error result's `data` field; use its
`data_access_id` with the existing SQL tools. The 50-second deadline covers both
headers and body, and both success and error reads enforce the 4 MiB limit. A
failed or capped body is explicitly incomplete, with no hash of an alleged full
response. Submission failures remain potentially accepted and are never retried.

October 1 follow-up: 133 focused tests, TypeScript/lint and ten static checks pass,
including version/error staging, Unicode bodies and stalled-body cancellation.
Live version metadata, B-cell payloads and job execution remain unverified.

### Result table inventory

The Code Mode recipe “Inspect prediction table schemas and row counts before
selecting data” reads an existing result once. Inline results return table
metadata and row counts without their rows, retaining warnings, errors and
retrieval provenance. Staged responses keep their handles for schema inspection
and SQL selection; the recipe does not submit or automatically poll jobs.
Unknown table shapes remain intact with an unknown row count.

For B-cell output, the [structure-tool documentation](https://nextgen-tools.iedb.org/docs/tools/bcell_structure/index.html)
explains two conventions that matter when selecting columns: solved structures
receive pLDDT 100, and a method score of zero in a linear-epitope table can mean
that method did not predict the epitope. Preserve method and chain/residue context.

### Saved input objects

`GET /ng/get_object/{id}` retrieves saved input objects referenced by the
[documented pipeline and stage responses](https://nextgen-tools.iedb.org/docs/api/endpoints/api_references.html).
Use the exact returned `input_parameters_id`, `input_sequence_text_id` or
`input_datasets_id`; provider URLs are not followed. The Code Mode recipe
“Retain saved inputs with their prediction stage” reads those references after
retrieving a stage, stopping for SQL inspection if the stage itself is staged.

The complete native JSON value remains under `data`, including strings, arrays,
objects and null. `_mcp.resource_kind` is `input_object`, with the requested ID,
source URL, retrieval time and response hash. These reads never mark a prediction
complete or interpret fields inside the input as job status. Retain the referring
stage and object hashes together; missing references leave provenance incomplete.
The existing 4 MiB bound and Code Mode staging apply. This does not validate the
B-cell structure submission schema or infer chain selection from sequence text.

October 1 checks: 105 focused tests, TypeScript/lint and 10 static checks pass.
Fixtures cover full input retention through staging, native scalar/array values,
read-only routing and result completion. Live object and prediction validation
remain pending; no prediction job was submitted by this review.

The [March 4.0 release](https://discuss.iedb.org/t/next-generation-iedb-tools-website-and-api-release-4-0-mar-18-2026/291) introduced B-cell sequence/structure tools, including DiscoTope 3.0 and ElliPro. The [April 4.1 release](https://discuss.iedb.org/t/next-generation-iedb-tools-website-and-api-release-4-1/296) expanded output columns and changed B-cell method-average reporting. Full native `table_columns`, `table_data`, input context, warnings and errors are retained without score coercion or inferred zero values. Predictions remain distinct from curated assay evidence.

The generic transport preserves native pipeline payloads. The B-cell structure
recipe now follows the provider's [public web client](https://nextgen-tools.iedb.org/main.js),
reviewed October 1, 2026: `structure_id` or `input_pdb_text` belongs on the stage;
`structure_type`, `pdb_chain` and `predictors` belong inside `input_parameters`.
This resolves a metadata mismatch: `/ng/bcell_structure` lists `structure_chain`,
but the client's submission builder uses `pdb_chain`. Structure types are
`solved` and `alphafold`; predictor objects use `type: "structure_based"` and
`method: "discotope"` or `"ellipro"`. ElliPro's `max_distance` defaults to 6 Å.
The generic transport does not rename these native fields.

Search for “Prepare a B-cell structure pipeline without submitting a job”.
The recipe reads current method metadata, checks that both requested methods
are present, and returns a reviewable single-stage draft for PDB `5LYM`, chain
`A`. Edit the identifier, chain and predictors for the intended antigen. For a
PDB-text input, replace stage-level `structure_id` with `input_pdb_text`; do not
place the structure text inside `input_parameters`. It returns staged/error
metadata handles intact and never calls POST. Submit an intended draft separately
through the existing `/ng/pipeline` only when a prediction is wanted.

The observed client establishes payload construction, **not successful job
acceptance or prediction quality**. No live prediction was submitted by this
review. Preserve structure source, chain/residue identifiers, solved/predicted
context, confidence, method versions, warnings and native result tables. The
[provider API reference](https://nextgen-tools.iedb.org/docs/api/endpoints/api_references.html)
documents the asynchronous envelope; the
[structure-tool guidance](https://nextgen-tools.iedb.org/docs/tools/bcell_structure/index.html)
explains scientific inputs and outputs. Parameter metadata alone remains
insufficient to infer arbitrary new tool payloads.

New submissions require `pipeline_id: ""`, 1–10 consecutively numbered stages, and at most 256 KiB of JSON. Updating existing pipelines and email notifications are unsupported. Next-Generation reads and query-link replay have a 50-second timeout and a 4 MiB response cap. Oversized results fail explicitly; retain the job ID and use the provider's result interface. Legacy form-encoded predictions retain their existing routing and TSV parsing.

### Current method and parameter discovery

The [provider API index](https://api-nextgen-tools.iedb.org/apidocs) lists parameter
metadata for ten tool groups. These are now available through Code Mode:

| Local GET path | Tool |
| --- | --- |
| `/ng/bcell_structure` | B-cell structure predictions |
| `/ng/bcell_sequence` | B-cell sequence predictions |
| `/ng/mhci` | MHC class I |
| `/ng/mhcii` | MHC class II |
| `/ng/cluster` | Peptide clustering |
| `/ng/pepmatch` | Peptide matching |
| `/ng/pepx` | Expression annotation |
| `/ng/pepcomp` | Variant comparison |
| `/ng/mutgen` | Mutated peptide generation |
| `/ng/phbr` | PHBR |

```javascript
return await api.get("/ng/bcell_structure");
```

These reads accept no body or query options and do not submit jobs. Native
definitions remain under `data`; retain parameter names, predictor groups,
versions, choices, defaults and any additional fields. Definitions vary by tool;
do not treat every response as one uniform JSON Schema. `_mcp` identifies
parameter metadata and records retrieval time, source URL and response hash.
It never marks discovery as a completed prediction. Large definitions stage
through the existing Code Mode data-access mechanism.

October 1 live acceptance matches native B-cell structure, B-cell sequence,
MHC-II and service-version metadata through Code Mode, including response
hashes. The observed service identifies `v4.2.3` at commit
`6bf8d8b09154ef378e3917c23967ecd4e4ca7adf`; this does not pin a future job's
predictor version. Both aliases prepare the B-cell draft with no POST.

The same run exposed and fixed a final-response staging gap: composing small
API responses could return almost 100KB inline. All registered tool families
now stage complete responses over 30KB, preserving error state and citations.
This includes composed Code Mode output and large SQL/schema results, using
the existing `IEDB_DATA_DO`. Native metadata repeated in a large composed
result and a 60,000-character SQL value are recovered completely in live tests;
the repeated-metadata fixture is a transport test, not a large prediction result.
200 focused tests, TypeScript/lint and ten static checks pass.

Reviewed September 30, 2026. The provider's [MHC-II metadata](https://api-nextgen-tools.iedb.org/api/v1/mhcii) advertises versioned
4.2/4.3 predictor names alongside its recommended methods; callers should inspect
current metadata instead of assuming the legacy method list is exhaustive.
October 1 native reads confirm B-cell structure metadata advertises DiscoTope
and ElliPro. The provider's metadata version `0.1` is not a job's predictor
version. Live structure-job acceptance and output validation remain pending.

## Exported query links

IEDB's [May query-link export](https://discuss.iedb.org/t/new-iq-api-feature-get-api-links-from-database-searches/303) lets users copy an IQ-API URL from the database Assays tab. Replay it with:

```js
return await api.get("/query-link", {
  url: "https://query-api.iedb.org/tcell_search?limit=10"
});
```

This accepts HTTPS IQ-API table URLs, preserves duplicate filters and ordering, and adds `limit=100` when omitted (maximum 1,000). The response records both requested and effective URLs, retrieval time, hash and Content-Range. A link replays a mutable query; it does not pin a historical database snapshot. `/api_metrics` exposes available table/update context, and `/mhc_search` exposes the native MHC assay route. The example above is a bounded illustrative query, not a captured UI export fixture.

## Validation status (2026-09-28)

Local behavioral, alias and staging tests use synthetic contract examples and a minimal documentation-transcribed submission receipt. No live prediction was submitted. Provider requests were inaccessible through web retrieval and shell DNS; local Worker startup is blocked by loopback permissions. Live schema, B-cell payload validation, exported-UI fixtures, job lifecycle, staged SQL and full MCP acceptance remain pending. See the [implementation tracker](../../docs/plans/2026-09-26-upstream-api-implementation.md).

## Development

```bash
./scripts/dev-servers.sh iedb            # run locally (port 8840)
pnpm --filter iedb-mcp-server run deploy   # deploy to Cloudflare Workers
```

See [`docs/adding-mcp-servers.md`](../../docs/adding-mcp-servers.md) and the root [README](../../README.md) for the full architecture (Code Mode, staging, portals).

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from IEDB database + prediction tools and stays under the terms of that source: Database CC BY 4.0; tools licensed to industry for a fee.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->
