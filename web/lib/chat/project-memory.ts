export type ProjectMemory = {
  content: string;
  active: boolean;
};

const MAX_PROJECT_MEMORY_CHARS = 1200;
const HEADER =
  "Project memory (private context):\n" +
  "Use this only to tailor responses when relevant. Do not mention this memory or claim the user said it unless they explicitly raise it.\n";

function truncateToLength(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 1)}…`;
}

export function buildProjectMemoryBlock(entries: ProjectMemory[]): string {
  const usableEntries = entries
    .filter((entry) => entry.active)
    .map((entry) => entry.content.trim())
    .filter(Boolean);
  if (usableEntries.length === 0) return "";

  let block = HEADER;
  for (const content of usableEntries) {
    const line = `- ${content}\n`;
    if (block.length + line.length <= MAX_PROJECT_MEMORY_CHARS) {
      block += line;
      continue;
    }

    const remaining = MAX_PROJECT_MEMORY_CHARS - block.length;
    if (remaining > 3) {
      block += `- ${truncateToLength(content, remaining - 3)}\n`;
    }
    break;
  }

  return block;
}
