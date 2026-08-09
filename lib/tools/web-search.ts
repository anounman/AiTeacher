import { tool } from "ai";
import { z } from "zod";

// Tavily web search. Returns null when no API key is configured, so the
// chat route can branch on `makeWebSearchTool(cfg.tavilyApiKey)` and simply
// skip wiring tools when web search is disabled.
export function makeWebSearchTool(apiKey: string) {
  if (!apiKey) return null;
  return tool({
    description:
      "Search the web for up-to-date information. Use when the question needs current facts or info outside the user's materials. Returns titled snippets with URLs.",
    inputSchema: z.object({ query: z.string().describe("The search query") }),
    execute: async ({ query }) => {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: 5,
          include_answer: true,
        }),
      });
      if (!res.ok) return { error: `search failed (${res.status})`, results: [] };
      const data = (await res.json()) as {
        answer?: string | null;
        results?: { title: string; url: string; content: string }[];
      };
      return {
        answer: data.answer ?? null,
        results: (data.results ?? []).map((r) => ({
          title: r.title,
          url: r.url,
          content: r.content,
        })),
      };
    },
  });
}