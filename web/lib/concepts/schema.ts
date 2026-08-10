import { z } from "zod";

// The 6 study-flavored relations the LLM is allowed to emit. semantically_
// similar_to is intentionally NOT here — it's computed in a post-pass from
// concept-embedding cosine, never produced by the model.
export const LLM_RELATIONS = [
  "prerequisite_of",
  "part_of",
  "example_of",
  "contrasts_with",
  "applies_to",
  "generalizes",
] as const;
export type ConceptLLMRelation = (typeof LLM_RELATIONS)[number];

// Confidence trail (adapted from the graphify skill). EXTRACTED = directly
// stated; INFERRED = reasoned; AMBIGUOUS = weak/uncertain.
export const EDGE_CONFIDENCE = ["EXTRACTED", "INFERRED", "AMBIGUOUS"] as const;
export type EdgeConfidence = (typeof EDGE_CONFIDENCE)[number];

const conceptNodeSchema = z.object({
  label: z
    .string()
    .min(1)
    .describe("Canonical concept name: a singular noun phrase in Title Case, no trailing punctuation. e.g. 'Eigenvalue', 'Gradient Descent'."),
  description: z
    .string()
    .describe("One concise neutral sentence defining the concept as it's used in this text. No filler ('this is a concept that...')."),
  evidence: z
    .string()
    .optional()
    .describe("A short verbatim quote or phrase from the text that grounds this concept, if one is identifiable. Omit if none."),
});

const conceptEdgeSchema = z.object({
  source: z
    .string()
    .min(1)
    .describe("The label of the source concept — must exactly match a label in this output's `concepts` array."),
  target: z
    .string()
    .min(1)
    .describe("The label of the target concept — must exactly match a label in this output's `concepts` array."),
  relation: z
    .enum(LLM_RELATIONS)
    .describe("Relation from source to target. prerequisite_of: source is needed to understand target. part_of: source is a component/aspect of target. example_of: source is an instance of target. contrasts_with: source and target differ/oppose. applies_to: source is an application of target. generalizes: source is the broader/general case of target."),
  confidence: z
    .enum(EDGE_CONFIDENCE)
    .describe("EXTRACTED if the relation is directly stated in the text. INFERRED if reasoned from context. AMBIGUOUS if weak or uncertain. Never omit this tag."),
  confidence_score: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence score in [0,1]. EXTRACTED = 1.0 (or up to 1.0 with strong evidence). INFERRED = 0.4–0.95. AMBIGUOUS = 0.1–0.3. Never default to 0.5."),
  evidence: z
    .string()
    .optional()
    .describe("A short verbatim quote from the text supporting this relation (required for EXTRACTED, helpful for INFERRED). Omit if none."),
});

export const conceptExtractionSchema = z.object({
  concepts: z
    .array(conceptNodeSchema)
    .describe("The distinct concepts present in this text. Canonical singular-noun labels; merge near-synonyms into one entry. Aim for the real concepts, not every noun."),
  edges: z
    .array(conceptEdgeSchema)
    .describe("Relations between the concepts above. source and target must each match a label in `concepts`. Omit edges you can't ground."),
});

export type ConceptExtractionOutput = z.infer<typeof conceptExtractionSchema>;