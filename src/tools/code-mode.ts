import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { iedbCatalog } from "../spec/catalog";
import { createIedbApiFetch } from "../lib/api-adapter";
import { iedbResponse } from "../lib/tool-result";

interface CodeModeEnv {
    IEDB_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
): void {
    const apiFetch = createIedbApiFetch();
    const registrar = {tool: (...args: unknown[]) => {
        const [name, ...rest] = args;
        const handler = rest.pop() as (input: unknown, extra: unknown) => ReturnType<typeof iedbResponse>;
        const respond = (input: unknown, extra: unknown) => iedbResponse(() => handler(input, extra), env, String(name), extra, input);
        const register = server.tool.bind(server) as (...values: unknown[]) => void;
        register(name, ...rest, respond); register(`mcp_${String(name)}`, ...rest, respond);
    }};

    const searchTool = createSearchTool({
        prefix: "iedb",
        catalog: iedbCatalog,
    });
    searchTool.register(registrar);

    const executeTool = createExecuteTool({
        prefix: "iedb",
        // Verifiable provenance: iedb_execute results carry a _meta.citation.
        source: { id: "iedb", name: "Immune Epitope Database (IEDB)", url: "https://www.iedb.org", license: "CC BY 4.0" },
        catalog: iedbCatalog,
        apiFetch,
        maxInlineBytes: 30 * 1024,
        stagingThreshold: 30 * 1024,
        preserveApiErrors: true,
        timeout: 90_000,
        doNamespace: env.IEDB_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(registrar);
}
