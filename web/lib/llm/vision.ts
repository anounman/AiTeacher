// Heuristic: does this model id name a vision/multimodal model?
// Ollama ids carry a tag (e.g. `llama3.2-vision:11b`); configured models may be
// untagged (e.g. `gemma3`). We match on substrings/keywords that the common
// Ollama vision model families contain. This is a heuristic, not a capability
// probe — it is the basis of the hard gate that disables image input when the
// active model is not vision-capable.
const VISION_KEYWORDS =
  /(vision|llava|moondream|minicpm-v|gemma3|qwen.*vl|qwen2-vl|qwen2\.5-vl|pixtral|internvl|phi-3-vision|phi-3\.5-vision|llama3\.2-vision|-vl\b|\bvl\b)/i;

export function isVisionModel(model: string | undefined | null): boolean {
  if (!model) return false;
  return VISION_KEYWORDS.test(model);
}