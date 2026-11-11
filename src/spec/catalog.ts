import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";
import {nextgenEndpoints, nextgenWorkflows} from "./nextgen";
import {queryDiscoveryEndpoints, queryMetadataWorkflow} from "./query-discovery";
import {resultInventoryWorkflow} from "./result-inventory";

export const iedbCatalog: ApiCatalog = {
    name: "IEDB Query API",
    baseUrl: "https://query-api.iedb.org",
    version: "0.1",
    auth: "none",
    endpointCount: 10 + nextgenEndpoints.length + queryDiscoveryEndpoints.length,
    workflows: [...nextgenWorkflows, resultInventoryWorkflow, queryMetadataWorkflow],
    notes:
        "- /query/schema returns the published IQ-API schema (observed info.version 0.1); /query/metrics preserves per-table counts/update context, not an immutable release.\n" +
        "- /epitope/{id} and /reference/{id} are local filtered-export helpers returning native arrays; /mhc_ligand_search maps to /mhc_search.\n" +
        "- PostgREST-style query API: use query params for filtering\n" +
        "- Supports operators: eq, neq, gt, gte, lt, lte, like, ilike, in, is\n" +
        "- Example filter: ?linear_sequence=eq.SLYNTVATL\n" +
        "- Pagination: use limit and offset query params\n" +
        "- Native IQ-API table responses are arrays; /ng/*, /query/* and /query-link return data plus _mcp context\n" +
        "- /ng/pipeline uses JSON on the Next-Generation API; submit once and poll returned result IDs separately\n" +
        "- For MHC binding/processing predictions, use the Tools API via api.post() — responses are auto-parsed from TSV to JSON",
    endpoints: [
        ...nextgenEndpoints,
        ...queryDiscoveryEndpoints,
        // === Epitopes ===
        {
            method: "GET",
            path: "/epitope_search",
            summary: "Search epitopes by sequence, organism, disease, or MHC restriction",
            category: "epitope",
            queryParams: [
                { name: "linear_sequence", type: "string", required: false, description: "Filter by peptide sequence (supports eq, like operators)" },
                { name: "source_organism_iri", type: "string", required: false, description: "Source organism IRI (e.g. http://purl.obolibrary.org/obo/NCBITaxon_11676 for HIV-1)" },
                { name: "disease_iri", type: "string", required: false, description: "Disease IRI" },
                { name: "mhc_allele_name", type: "string", required: false, description: "MHC allele name (e.g. HLA-A*02:01)" },
                { name: "limit", type: "number", required: false, description: "Max results to return" },
                { name: "offset", type: "number", required: false, description: "Number of results to skip" },
            ],
        },
        {
            method: "GET",
            path: "/epitope/{epitope_id}",
            summary: "Adapter helper: read /epitope_export filtered by structure_id; returns a native array page",
            description: "Accepts a positive safe-integer ID and no query parameters. Every returned row must match the ID. Does not collapse an empty array into a fabricated record. Use the native export route for columns and paging.",
            category: "epitope",
            pathParams: [
                { name: "epitope_id", type: "number", required: true, description: "IEDB epitope ID" },
            ],
        },
        // === T-cell Assays ===
        {
            method: "GET",
            path: "/tcell_search",
            summary: "Search T-cell assay results — cytokine release, killing, proliferation",
            category: "assay",
            queryParams: [
                { name: "linear_sequence", type: "string", required: false, description: "Epitope sequence" },
                { name: "mhc_allele_name", type: "string", required: false, description: "MHC restriction" },
                { name: "assay_type", type: "string", required: false, description: "Assay type (e.g. 'IFNg release')" },
                { name: "source_organism_iri", type: "string", required: false, description: "Source organism" },
                { name: "host_organism_iri", type: "string", required: false, description: "Host organism" },
                { name: "limit", type: "number", required: false, description: "Max results" },
                { name: "offset", type: "number", required: false, description: "Skip results" },
            ],
        },
        // === B-cell Assays ===
        {
            method: "GET",
            path: "/bcell_search",
            summary: "Search B-cell/antibody assay results",
            category: "assay",
            queryParams: [
                { name: "linear_sequence", type: "string", required: false, description: "Epitope sequence" },
                { name: "assay_type", type: "string", required: false, description: "Assay type" },
                { name: "source_organism_iri", type: "string", required: false, description: "Source organism" },
                { name: "limit", type: "number", required: false, description: "Max results" },
                { name: "offset", type: "number", required: false, description: "Skip results" },
            ],
        },
        // === MHC Ligand Assays ===
        {
            method: "GET",
            path: "/mhc_ligand_search",
            deprecated: true,
            description: "Compatibility alias to documented /mhc_search. Existing filter expressions are forwarded unchanged; use exported UI queries or current documentation to verify column names.",
            summary: "Compatibility alias for MHC ligand assay search; prefer /mhc_search",
            category: "assay",
            queryParams: [
                { name: "linear_sequence", type: "string", required: false, description: "Peptide sequence" },
                { name: "mhc_allele_name", type: "string", required: false, description: "MHC allele" },
                { name: "assay_type", type: "string", required: false, description: "Assay type (e.g. 'dissociation constant KD')" },
                { name: "source_organism_iri", type: "string", required: false, description: "Source organism" },
                { name: "limit", type: "number", required: false, description: "Max results" },
                { name: "offset", type: "number", required: false, description: "Skip results" },
            ],
        },
        // === References ===
        {
            method: "GET",
            path: "/reference_search",
            summary: "Search IEDB references (publications curated for epitope data)",
            category: "reference",
            queryParams: [
                { name: "author", type: "string", required: false, description: "Author name" },
                { name: "title", type: "string", required: false, description: "Publication title (supports like operator)" },
                { name: "pubmed_id", type: "string", required: false, description: "PubMed ID" },
                { name: "limit", type: "number", required: false, description: "Max results" },
                { name: "offset", type: "number", required: false, description: "Skip results" },
            ],
        },
        {
            method: "GET",
            path: "/reference/{reference_id}",
            summary: "Adapter helper: read /reference_export filtered by reference_id; returns a native array page",
            description: "Uses an IEDB reference ID, not a PubMed ID. Accepts no query parameters and verifies returned identifiers. Use /reference_export for columns and paging.",
            category: "reference",
            pathParams: [
                { name: "reference_id", type: "number", required: true, description: "IEDB reference ID" },
            ],
        },
        // === Antigens ===
        {
            method: "GET",
            path: "/antigen_search",
            summary: "Search source antigens (proteins from which epitopes are derived)",
            category: "antigen",
            queryParams: [
                { name: "antigen_name", type: "string", required: false, description: "Antigen name (supports like operator)" },
                { name: "source_organism_iri", type: "string", required: false, description: "Source organism" },
                { name: "limit", type: "number", required: false, description: "Max results" },
                { name: "offset", type: "number", required: false, description: "Skip results" },
            ],
        },
        // === Organisms ===
        {
            method: "GET",
            path: "/organism_search",
            deprecated: true,
            description: "Not established by the current published IQ-API schema. Prefer source-organism fields in /epitope_export or a provider-exported /query-link; this legacy route remains unverified.",
            summary: "Search organisms with epitope data in IEDB",
            category: "organism",
            queryParams: [
                { name: "organism_name", type: "string", required: false, description: "Organism name (supports like operator)" },
                { name: "limit", type: "number", required: false, description: "Max results" },
                { name: "offset", type: "number", required: false, description: "Skip results" },
            ],
        },
        // === Disease ===
        {
            method: "GET",
            path: "/disease_search",
            deprecated: true,
            description: "Not established by the current published IQ-API schema. Use a provider-exported disease-filtered /query-link; this legacy route remains unverified.",
            summary: "Search diseases with epitope data in IEDB",
            category: "disease",
            queryParams: [
                { name: "disease_name", type: "string", required: false, description: "Disease name (supports like)" },
                { name: "limit", type: "number", required: false, description: "Max results" },
                { name: "offset", type: "number", required: false, description: "Skip results" },
            ],
        },
    ],
};
