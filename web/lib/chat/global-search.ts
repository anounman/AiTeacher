import { buildConversationContext, type ContextMessage } from "./conversation-context";
import { rankConversationSearch, type ConversationSearchConversation, type ConversationSearchMessage } from "./conversation-search";

export type GlobalSearchResult =
  | { kind: "conversation" | "message"; conversationId: string; messageId?: string; title: string; snippet: string }
  | { kind: "material"; materialId: string; title: string; snippet: string; projectId: string }
  | { kind: "concept"; conceptId: string; title: string; snippet: string; projectId: string }
  | { kind: "overlay"; overlayId: string; conversationId: string; title: string; snippet: string }
  | { kind: "artifact"; artifactId: string; conversationId: string; messageId: string; title: string; snippet: string };

export type GlobalSearchInput = {
  query: string;
  activeProjectId: string | null;
  conversations: Array<ConversationSearchConversation & { projectId?: string | null }>;
  messages: Array<ConversationSearchMessage & Pick<ContextMessage, "kind">>;
  materials: Array<{ id: string; projectId: string; title: string; text: string }>;
  concepts: Array<{ id: string; projectId: string; label: string; description: string | null }>;
  overlays: Array<{ id: string; conversationId: string; selectedText: string }>;
};

type RankedResult = {
  result: GlobalSearchResult;
  rank: number;
  index: number;
};

const MAX_PER_KIND = 8;
const MAX_RESULTS = 30;
const SNIPPET_CONTEXT = 44;
const SNIPPET_LENGTH = 160;

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function snippetAroundMatch(value: string, matchIndex: number): string {
  const text = normalize(value);
  if (text.length <= SNIPPET_LENGTH) return text;

  const start = Math.max(0, matchIndex - SNIPPET_CONTEXT);
  const end = Math.min(text.length, start + SNIPPET_LENGTH);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function titleRank(title: string, query: string): number | null {
  const matchIndex = normalize(title).toLocaleLowerCase().indexOf(query);
  if (matchIndex === -1) return null;
  if (matchIndex !== 0) return 2;
  return normalize(title).length === query.length ? 0 : 1;
}

function searchableRank(title: string, snippet: string, query: string, active: boolean): { rank: number; snippet: string } | null {
  const matchedTitleRank = titleRank(title, query);
  if (matchedTitleRank !== null) {
    return { rank: matchedTitleRank * 10 + (active ? 0 : 1), snippet: normalize(title) };
  }

  const normalizedSnippet = normalize(snippet);
  const matchIndex = normalizedSnippet.toLocaleLowerCase().indexOf(query);
  if (matchIndex === -1) return null;
  return {
    rank: 30 + (active ? 0 : 1),
    snippet: snippetAroundMatch(normalizedSnippet, matchIndex),
  };
}

function bounded(results: RankedResult[]): GlobalSearchResult[] {
  const countByKind = new Map<GlobalSearchResult["kind"], number>();
  const selected: GlobalSearchResult[] = [];

  for (const entry of results.sort((left, right) => left.rank - right.rank || left.index - right.index)) {
    if (selected.length >= MAX_RESULTS) break;
    const count = countByKind.get(entry.result.kind) ?? 0;
    if (count >= MAX_PER_KIND) continue;
    countByKind.set(entry.result.kind, count + 1);
    selected.push(entry.result);
  }

  return selected;
}

export function rankGlobalSearch(input: GlobalSearchInput): GlobalSearchResult[] {
  const query = normalize(input.query).toLocaleLowerCase();
  if (!query) return [];

  const ranked: RankedResult[] = [];
  let index = 0;
  const conversationById = new Map(input.conversations.map((conversation) => [conversation.id, conversation]));
  const messageById = new Map(input.messages.map((message) => [message.id, message]));

  for (const result of rankConversationSearch(input.conversations, input.messages, query)) {
    const conversation = conversationById.get(result.conversationId);
    const active = conversation?.projectId === input.activeProjectId;
    const rank = result.match === "message"
      ? 30 + (active ? 0 : 1)
      : (titleRank(result.conversationTitle, query) ?? 2) * 10 + (active ? 0 : 1);
    ranked.push({
      result: result.match === "title"
        ? { kind: "conversation", conversationId: result.conversationId, title: result.conversationTitle, snippet: result.snippet }
        : { kind: "message", conversationId: result.conversationId, messageId: result.messageId, title: result.conversationTitle, snippet: result.snippet },
      rank,
      index: index++,
    });
  }

  for (const material of input.materials) {
    const match = searchableRank(material.title, material.text, query, material.projectId === input.activeProjectId);
    if (!match) continue;
    ranked.push({
      result: { kind: "material", materialId: material.id, projectId: material.projectId, title: normalize(material.title), snippet: match.snippet },
      rank: match.rank,
      index: index++,
    });
  }

  for (const concept of input.concepts) {
    const match = searchableRank(concept.label, concept.description ?? "", query, concept.projectId === input.activeProjectId);
    if (!match) continue;
    ranked.push({
      result: { kind: "concept", conceptId: concept.id, projectId: concept.projectId, title: normalize(concept.label), snippet: match.snippet },
      rank: match.rank,
      index: index++,
    });
  }

  for (const overlay of input.overlays) {
    const conversation = conversationById.get(overlay.conversationId);
    if (!conversation) continue;
    const match = searchableRank(conversation.title ?? "Untitled conversation", overlay.selectedText, query, conversation.projectId === input.activeProjectId);
    if (!match) continue;
    ranked.push({
      result: {
        kind: "overlay",
        overlayId: overlay.id,
        conversationId: overlay.conversationId,
        title: normalize(conversation.title ?? "Untitled conversation"),
        snippet: match.snippet,
      },
      rank: match.rank,
      index: index++,
    });
  }

  const artifacts = buildConversationContext(input.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    kind: message.kind,
  })));
  for (const artifact of artifacts.artifacts) {
    const message = messageById.get(artifact.messageId);
    if (!message) continue;
    const conversation = conversationById.get(message.conversationId);
    if (!conversation) continue;
    const match = searchableRank(artifact.label, message.content, query, conversation.projectId === input.activeProjectId);
    if (!match) continue;
    ranked.push({
      result: {
        kind: "artifact",
        artifactId: artifact.id,
        conversationId: conversation.id,
        messageId: artifact.messageId,
        title: artifact.label,
        snippet: match.snippet,
      },
      rank: match.rank,
      index: index++,
    });
  }

  return bounded(ranked);
}
