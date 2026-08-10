import { readFileSync } from "node:fs";
import { join } from "node:path";

// Teach mode: the tutor SPEAKS short segments and WRITES on a whiteboard in
// real handwriting (mathwriter engine — see mathwriter/MARKUP.md). The client
// reads prose aloud via TTS and performs board fences. Protocol parser:
// lib/teach/protocol.ts.
//
// The prompt itself lives in prompts/teach.md at the repo root, because the
// teacher service's teaching agent uses the same text. Two copies of a 14 KB
// prompt would drift within a week, and the drift would show up as a lesson
// that behaves differently depending on which process generated it.
//
// Read at module load: this module is server-only (imported by API routes),
// and a prompt that fails to load should fail loudly at boot, not per request.
const PROMPT_PATH = process.env.TEACH_PROMPT_PATH
  ?? join(process.cwd(), "..", "prompts", "teach.md");

export const TEACH_SYSTEM_PROMPT = readFileSync(PROMPT_PATH, "utf8");
