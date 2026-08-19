export type ConversationSearchConversation = {
  id: string;
  title: string | null | undefined;
};

export type ConversationSearchMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
};

export type ConversationSearchResult = {
  conversationId: string;
  conversationTitle: string;
  messageId?: string;
  match: "title" | "message";
  snippet: string;
};

type RankedResult = {
  result: ConversationSearchResult;
  rank: number;
  index: number;
};

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

export function rankConversationSearch(
  conversations: ConversationSearchConversation[],
  messages: ConversationSearchMessage[],
  query: string,
): ConversationSearchResult[] {
  const normalizedQuery = normalize(query).toLocaleLowerCase();
  if (!normalizedQuery) return [];

  const messagesByConversation = new Map<string, ConversationSearchMessage[]>();
  for (const message of messages) {
    const conversationMessages = messagesByConversation.get(message.conversationId) ?? [];
    conversationMessages.push(message);
    messagesByConversation.set(message.conversationId, conversationMessages);
  }

  const ranked: RankedResult[] = [];
  for (const [index, conversation] of conversations.entries()) {
      const title = normalize(conversation.title ?? "Untitled conversation");
      const titleMatchIndex = title.toLocaleLowerCase().indexOf(normalizedQuery);
      if (titleMatchIndex !== -1) {
        const titleRank = titleMatchIndex === 0
          ? (title.length === normalizedQuery.length ? 0 : 1)
          : 2;
        ranked.push({
          result: {
            conversationId: conversation.id,
            conversationTitle: title,
            match: "title" as const,
            snippet: title,
          },
          rank: titleRank,
          index,
        });
        continue;
      }

      const message = messagesByConversation.get(conversation.id)?.find((candidate) =>
        normalize(candidate.content).toLocaleLowerCase().includes(normalizedQuery),
      );
      if (!message) continue;

      const content = normalize(message.content);
      ranked.push({
        result: {
          conversationId: conversation.id,
          conversationTitle: title,
          messageId: message.id,
          match: "message" as const,
          snippet: snippetAroundMatch(content, content.toLocaleLowerCase().indexOf(normalizedQuery)),
        },
        rank: 3,
        index,
      });
  }

  return ranked
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.result);
}
