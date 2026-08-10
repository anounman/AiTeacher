import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { jsonSchema, tool, type Tool } from "ai";
import { getAllSettings, setSetting } from "@/lib/db";

// MCP connections: the app as an MCP *client*, so a lesson can reach into the
// user's other tools — above all Conscious (github.com/anounman/Conscious),
// whose recall/ocr_at give the tutor the student's real screen history.
// Config lives in the settings KV; connections are lazy, cached, and a dead
// server never breaks a chat turn — its tools just don't appear.

export interface McpServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "http";
  /** stdio: executable + args (runs on this machine, same trust as the app). */
  command?: string;
  args?: string[];
  /** http: streamable-HTTP endpoint (SSE fallback attempted automatically). */
  url?: string;
  enabled: boolean;
}

const SETTINGS_KEY = "mcp.servers";

export function getMcpServers(): McpServerConfig[] {
  try {
    const raw = getAllSettings()[SETTINGS_KEY];
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is McpServerConfig =>
        !!s && typeof s === "object" && typeof (s as McpServerConfig).name === "string",
    );
  } catch {
    return [];
  }
}

export function setMcpServers(servers: McpServerConfig[]): void {
  setSetting(SETTINGS_KEY, JSON.stringify(servers.slice(0, 12)));
}

// One live client per config signature, surviving Next dev HMR. A changed
// config gets a fresh connection; the old one is closed best-effort.
type CacheEntry = { key: string; client: Promise<Client> };
const globalForMcp = globalThis as unknown as { __mcpClients?: Map<string, CacheEntry> };
const cache = (globalForMcp.__mcpClients ??= new Map());

function configKey(s: McpServerConfig): string {
  return JSON.stringify([s.transport, s.command, s.args, s.url]);
}

async function connect(s: McpServerConfig): Promise<Client> {
  const client = new Client({ name: "aiteacher", version: "1.0.0" });
  if (s.transport === "stdio") {
    if (!s.command) throw new Error("stdio server needs a command");
    await client.connect(new StdioClientTransport({ command: s.command, args: s.args ?? [] }));
    return client;
  }
  if (!s.url) throw new Error("http server needs a url");
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(s.url)));
    return client;
  } catch {
    // Older servers speak SSE only.
    const sse = new Client({ name: "aiteacher", version: "1.0.0" });
    await sse.connect(new SSEClientTransport(new URL(s.url)));
    return sse;
  }
}

function getClient(s: McpServerConfig): Promise<Client> {
  const key = configKey(s);
  const hit = cache.get(s.id);
  if (hit && hit.key === key) return hit.client;
  if (hit) void hit.client.then((c: Client) => c.close()).catch(() => {});
  const client = connect(s);
  cache.set(s.id, { key, client });
  client.catch(() => cache.delete(s.id));
  return client;
}

function toolName(server: string, name: string): string {
  return `${server}_${name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

/**
 * AI SDK tools for every enabled MCP server, namespaced `<server>_<tool>`.
 * Unreachable servers contribute nothing (listed in `unavailable`), so a
 * turn's latency ceiling for a dead server is the connect timeout, once.
 */
export async function loadMcpTools(): Promise<{
  tools: Record<string, Tool>;
  unavailable: string[];
}> {
  const tools: Record<string, Tool> = {};
  const unavailable: string[] = [];
  const enabled = getMcpServers().filter((s) => s.enabled);
  await Promise.all(
    enabled.map(async (server) => {
      try {
        const client = await withTimeout(getClient(server), 6_000);
        const listed = await withTimeout(client.listTools(), 6_000);
        for (const t of listed.tools) {
          tools[toolName(server.name, t.name)] = tool({
            description: `[${server.name}] ${t.description ?? t.name}`,
            inputSchema: jsonSchema((t.inputSchema ?? { type: "object" }) as never),
            execute: async (input: unknown) => {
              const result = await withTimeout(
                client.callTool({ name: t.name, arguments: (input ?? {}) as Record<string, unknown> }),
                30_000,
              );
              const content = Array.isArray(result.content) ? result.content : [];
              const text = content
                .map((c: { type?: string; text?: string }) => (c.type === "text" ? c.text ?? "" : `[${c.type}]`))
                .join("\n");
              return text || JSON.stringify(result.structuredContent ?? {});
            },
          });
        }
      } catch {
        cache.delete(server.id);
        unavailable.push(server.name);
      }
    }),
  );
  return { tools, unavailable };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}
