import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { iedbCatalog } from "../spec/catalog";
import { createIedbApiFetch } from "../lib/api-adapter";

interface CodeModeEnv {
    IEDB_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
): void {
    const apiFetch = createIedbApiFetch();

    const searchTool = createSearchTool({
        prefix: "iedb",
        catalog: iedbCatalog,
    });
    searchTool.register(server as unknown as { tool: (...args: unknown[]) => void });

    const executeTool = createExecuteTool({
        prefix: "iedb",
        catalog: iedbCatalog,
        apiFetch,
        doNamespace: env.IEDB_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(server as unknown as { tool: (...args: unknown[]) => void });
}
