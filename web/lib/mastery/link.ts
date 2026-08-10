// Best-effort card ↔ concept auto-linking, triggered after a card is graded.
// Embeds the card front, cosine-matches it against the project's concept
// embeddings, and upserts the top ≤3 concepts with score ≥ 0.55 into
// card_concepts. Never throws — embedding/link failures are swallowed so a
// grade never fails because of linking (it retries on the next grade).

import { getCard, getDeck } from "@/lib/db/decks";
import { getConversation } from "@/lib/db";
import { listConceptEmbeddingsForProject } from "@/lib/db/concepts";
import { embedText, decodeEmbedding, cosine } from "@/lib/embed";
import { upsertCardConcept } from "@/lib/db/mastery";

const LINK_THRESHOLD = 0.55;
const MAX_LINKS = 3;

// card → deck.conversation_id → conversation.project_id. Returns null if any
// link is missing (the card then contributes to no concept).
function projectForCard(cardId: string): string | null {
  const card = getCard(cardId);
  if (!card) return null;
  const deck = getDeck(card.deck_id);
  if (!deck?.conversation_id) return null;
  const conv = getConversation(deck.conversation_id);
  return conv?.project_id ?? null;
}

export async function linkCardToConcepts(cardId: string): Promise<void> {
  try {
    const projectId = projectForCard(cardId);
    if (!projectId) return;
    const card = getCard(cardId);
    if (!card) return;

    const concepts = listConceptEmbeddingsForProject(projectId);
    if (concepts.length === 0) return;

    const qVec = await embedText(card.front);
    const q = new Float32Array(qVec);

    const scored = concepts
      .map((c) => ({ id: c.id, sim: cosine(q, decodeEmbedding(c.embedding)) }))
      .filter((c) => Number.isFinite(c.sim) && c.sim >= LINK_THRESHOLD)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, MAX_LINKS);

    for (const c of scored) upsertCardConcept(cardId, c.id, c.sim);
  } catch {
    // Swallow: linking is best-effort. The next grade retries.
  }
}