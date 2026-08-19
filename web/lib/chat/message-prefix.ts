export type PrefixMessage = {
  id: string;
  role: "user" | "assistant" | "system";
};

export function prefixThroughAssistantMessage<T extends PrefixMessage>(
  messages: T[],
  sourceMessageId: string,
): T[] | null {
  const sourceIndex = messages.findIndex(
    (message) => message.id === sourceMessageId && message.role === "assistant",
  );
  return sourceIndex === -1 ? null : messages.slice(0, sourceIndex + 1);
}
