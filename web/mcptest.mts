import { loadMcpTools } from "@/lib/mcp/client";
const t0 = Date.now();
const { tools, unavailable } = await loadMcpTools();
console.log("ms:", Date.now() - t0);
console.log("tools:", Object.keys(tools));
console.log("unavailable:", unavailable);
