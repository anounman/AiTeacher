// Normalize LaTeX delimiters \(...\) and \[...\] into $...$ and $$...$$ so
// remark-math (which only speaks $/$$) can parse them. The chat model
// sometimes emits \(...\)/\[...\] despite the system prompt asking for $/$$;
// this is a renderer-side safety net so math always renders.
//
// Crucially this runs on the RAW markdown string BEFORE remark-parse, because
// remark-parse would otherwise treat \( and \[ as escape sequences and consume
// the backslashes — leaving bare ( and [ with no math delimiters at all (the
// "raw latex" symptom). Code spans/fences are protected so delimiters inside
// code are left untouched.
//
// Placeholders use private-use-area code points (U+E000/E001) that won't occur
// in normal markdown text and are written as escapes so they survive editing.
const PH_START = "";
const PH_END = "";

export function normalizeMathDelimiters(md: string): string {
  if (!md) return md;

  // Protect fenced + inline code so their contents aren't rewritten.
  const placeholders: string[] = [];
  const protect = (s: string): string => {
    const i = placeholders.push(s) - 1;
    return `${PH_START}${i}${PH_END}`;
  };
  let out = md.replace(/```[\s\S]*?```/g, protect).replace(/`[^`\n]*`/g, protect);

  // Display math first (may span newlines), then inline. Non-greedy so each
  // delimiter pair maps to one math span; $/$$ that the model already emits
  // correctly is left untouched.
  out = out.replace(/\\\[([\s\S]+?)\\\]/g, (_m, c) => `$$${c}$$`);
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_m, c) => `$${c}$`);

  // Restore code.
  out = out.replace(new RegExp(`${PH_START}(\\d+)${PH_END}`, "g"), (_m, i) => placeholders[Number(i)]);
  return out;
}