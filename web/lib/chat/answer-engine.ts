import "server-only";

import { stepCountIs, streamText } from "ai";
import { getModelConfig, getProvider, getVisionLanguageModel } from "@/lib/llm/provider";
import { isVisionModel } from "@/lib/llm/vision";
import { documentSystemPrompt, systemPromptFor } from "@/lib/prompts";
import { makeWebSearchTool } from "@/lib/tools/web-search";
import { listActiveProjectMemory, listConceptsForProject, getProject } from "@/lib/db";
import { buildProjectMemoryBlock } from "@/lib/chat/project-memory";
import { buildStudyPersonaBlock } from "@/lib/prompts/study";
import type { Attachment, Conversation, SourceEntry } from "@/lib/db/schema";
import { conceptMasteryForProject } from "@/lib/db/mastery";
import { buildMasteryBlock } from "@/lib/mastery/model";
import { retrieve } from "@/lib/retrieval";
import { classifyDiagramType, classifyRecentUserDiagramType } from "@/lib/chat/diagram-intent";
import { notationSystemBlock, resolveNotation } from "@/lib/chat/notation";
import type { ChatStreamEvent } from "@/lib/chat/sse";

type ChatRole = "user" | "assistant" | "system";

export type AnswerMessage = {
  role: ChatRole;
  content: string;
  attachments?: Attachment[] | null;
};

export type AnswerInput = {
  conversation: Conversation;
  messages: AnswerMessage[];
  document?: boolean;
  web?: boolean;
  retrievalQuery?: string;
  abortSignal: AbortSignal;
};

export type AnswerCompletion = {
  text: string;
  outputTokens: number | undefined;
  sources: SourceEntry[];
};

export type AnswerEmitter = (event: Exclude<ChatStreamEvent, { type: "done" }>) => void;

function isComplexTurn(userText: string, document?: boolean): boolean {
  return (
    document ||
    /flashcard|quiz|test me|deck|cheat sheet|draft|outline|summarize/i.test(userText) ||
    userText.length > 400
  );
}

function imageTextBlock(attachment: Extract<Attachment, { type: "image" }>): string {
  const text = attachment.text && attachment.text.length > 0 ? attachment.text : "(no text detected)";
  return `\n\n[Image: ${attachment.name}]\n${text}`;
}

function toModelContent(
  content: string,
  attachments: Attachment[] | undefined,
  vision: boolean,
): string | Array<{ type: "text"; text: string } | { type: "image"; image: string }> {
  if (!attachments || attachments.length === 0) return content;
  const files = attachments.filter((attachment): attachment is Extract<Attachment, { type: "file" }> => attachment.type === "file");
  const images = attachments.filter((attachment): attachment is Extract<Attachment, { type: "image" }> => attachment.type === "image");
  const fileBlock = files.map((file) => `\n\n[Attached file: ${file.name}]\n${file.text}`).join("");

  if (!vision) return (content || "") + fileBlock + images.map(imageTextBlock).join("");

  return [
    { type: "text", text: (content || "") + fileBlock },
    ...images.map((attachment) => ({ type: "image" as const, image: attachment.dataUrl })),
  ];
}

const RECENT_IMAGE_TURNS = 3;

function attachmentsForTurn(
  message: AnswerMessage,
  index: number,
  lastUserIndex: number | undefined,
  keepImageIndexes: Set<number>,
): Attachment[] | undefined {
  const attachments = message.attachments ?? undefined;
  if (!attachments || attachments.length === 0) return undefined;
  if (index === lastUserIndex) return attachments;
  if (!keepImageIndexes.has(index)) return undefined;
  const images = attachments.filter((attachment): attachment is Extract<Attachment, { type: "image" }> => attachment.type === "image");
  return images.length ? images : undefined;
}

export async function streamAnswer(input: AnswerInput, emit: AnswerEmitter): Promise<AnswerCompletion> {
  const { conversation, messages, document, web, abortSignal } = input;
  const cfg = getModelConfig();
  const provider = getProvider(cfg.provider);
  const modelId = conversation.model || cfg.model;
  const visionEnabled = isVisionModel(modelId);

  if (provider.validate) {
    await provider.validate({ model: modelId, baseURL: cfg.baseURL, apiKey: cfg.apiKey });
  }
  const model = provider.languageModel({ model: modelId, baseURL: cfg.baseURL, apiKey: cfg.apiKey });
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const lastUserContent = lastUser?.content ?? "";

  let masteryBlock = "";
  let projectMemoryBlock = "";
  let studyPersona = "";
  // studyEnabled is hoisted to function scope so the notation block below can
  // gate on it without re-loading the project row. False when there's no
  // project or the project has the study capability off.
  let studyEnabled = false;
  if (conversation.project_id) {
    // Memory and RAG materials are generic project capabilities (useful for a
    // coding or writing project too). The study capability (concept mastery,
    // diagram notation, the study-tutor persona) is opt-in per project.
    const project = getProject(conversation.project_id);
    studyEnabled = project?.study_enabled === true;
    projectMemoryBlock = buildProjectMemoryBlock(listActiveProjectMemory(conversation.project_id));
    if (studyEnabled) {
      studyPersona = buildStudyPersonaBlock();
      const masteryMap = conceptMasteryForProject(conversation.project_id, Date.now());
      if (masteryMap.size > 0) {
        const labelsById = new Map(listConceptsForProject(conversation.project_id).map((concept) => [concept.id, concept.label]));
        masteryBlock = buildMasteryBlock(
          [...masteryMap.entries()].map(([id, mastery]) => ({
            label: labelsById.get(id) ?? id,
            mastery: mastery.mastery,
            band: mastery.band,
          })),
        );
      }
    }
  }

  const userIndexes = messages.map((message, index) => (message.role === "user" ? index : -1)).filter((index) => index >= 0);
  const lastUserIndex = userIndexes.at(-1);
  const keepImageIndexes = new Set(userIndexes.slice(-RECENT_IMAGE_TURNS));
  const webSearch = web ? makeWebSearchTool(cfg.tavilyApiKey) : null;
  const useWeb = web === true && webSearch !== null;
  const webNote = web && !useWeb
    ? "\n\nNote: the user enabled web search for this turn, but no search provider key is configured, so the web_search tool is NOT available. If you cannot answer a current or factual question from your own knowledge, say briefly that web search isn't set up yet and they can add a Tavily API key in Settings to enable it. Do not pretend to search."
    : "";

  if (document) emit({ type: "status", phase: "drafting-document", label: "preparing your document…" });
  else if (conversation.project_id) emit({ type: "status", phase: "searching-materials", label: "searching your materials…" });
  else emit({ type: "status", phase: "thinking", label: "thinking…" });

  const retrieved = await retrieve({
    projectId: conversation.project_id ?? "",
    lastUser,
    lastUserContent: input.retrievalQuery ?? lastUserContent,
    messages,
  });
  const contextBlock = retrieved?.contextBlock ?? "";
  const sources = retrieved?.sources ?? [];
  if (sources.length > 0) {
    emit({ type: "sources", sources });
    emit({
      type: "status",
      phase: "found-sources",
      label: `found ${sources.length} relevant passage${sources.length === 1 ? "" : "s"} in your materials…`,
    });
  }

  const diagramType =
    classifyDiagramType(lastUserContent) ??
    classifyRecentUserDiagramType(messages.filter((message) => message.role === "user").map((message) => message.content));
  let notationBlock = "";
  if (diagramType && conversation.project_id && studyEnabled) {
    const resolved = await resolveNotation({
      projectId: conversation.project_id,
      diagramType,
      cfg,
      visionModel: getVisionLanguageModel(cfg),
      sources,
      abortSignal,
      onStatus: (phase, label) => emit({ type: "status", phase, label }),
    }).catch(() => null);
    if (resolved) notationBlock = notationSystemBlock(resolved.note, diagramType);
  }

  const complex = isComplexTurn(lastUserContent, document) || Boolean(notationBlock);
  const basePrompt = document ? documentSystemPrompt() : systemPromptFor(conversation.mode);
  const system =
    `Current date: ${new Date().toISOString().slice(0, 10)}.\n` +
    basePrompt +
    studyPersona +
    (projectMemoryBlock ? `\n\n${projectMemoryBlock}` : "") +
    (masteryBlock ? `\n\n${masteryBlock}` : "") +
    webNote +
    contextBlock +
    notationBlock;

  let completedText = "";
  let outputTokens: number | undefined;
  const result = streamText({
    model,
    system,
    maxOutputTokens: document ? 32768 : notationBlock ? 65536 : complex ? 8192 : 4096,
    providerOptions: { ollama: { reasoningEffort: document || complex ? "high" : "medium" } },
    messages: document && lastUser
      ? [{ role: "user" as const, content: toModelContent(lastUser.content, lastUser.attachments ?? undefined, visionEnabled) }]
      : messages.map((message, index) =>
          message.role === "user"
            ? {
                role: "user" as const,
                content: toModelContent(message.content, attachmentsForTurn(message, index, lastUserIndex, keepImageIndexes), visionEnabled),
              }
            : { role: message.role, content: message.content },
        ),
    ...(useWeb
      ? { tools: { web_search: webSearch }, stopWhen: stepCountIs(5), toolChoice: "auto" as const }
      : {}),
    abortSignal,
    onFinish: ({ text, usage }) => {
      completedText = text.replace(/\s+$/, "");
      outputTokens = usage?.outputTokens;
    },
  });

  for await (const part of result.fullStream) {
    if (part.type === "start-step" || part.type === "reasoning-start") {
      emit({ type: "status", phase: "thinking", label: "thinking…" });
    } else if (part.type === "reasoning-delta") {
      emit({ type: "reasoning", delta: part.text });
    } else if (part.type === "text-delta") {
      emit({ type: "text", delta: part.text });
    } else if (part.type === "tool-call") {
      const query = (part as { input?: { query?: string } }).input?.query;
      emit({ type: "status", phase: "searching", label: query ? `searching the web for \"${query}\"…` : "searching the web…" });
    } else if (part.type === "tool-result") {
      emit({ type: "status", phase: "thinking", label: "thinking…" });
    } else if (part.type === "error") {
      throw new Error(String(part.error));
    }
  }

  return { text: completedText, outputTokens, sources };
}
