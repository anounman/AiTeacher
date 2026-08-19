"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { MessageSquare, PanelRightClose, PanelRightOpen, Plus, RefreshCw, Search } from "lucide-react";
import { ConversationListPane } from "@/components/shell/ConversationListPane";
import { useSidebarSlot } from "@/components/shell/sidebar-slot";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { ModeToggle } from "@/components/ModeToggle";
import { TeachStage } from "@/components/teach/TeachStage";
import { PersonaEditor } from "@/components/PersonaEditor";
import { performer } from "@/lib/teach/performer";
import { boardInventory } from "@/lib/teach/protocol";
import { IconButton } from "@/components/ui/IconButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog, DialogTrigger, DialogContent } from "@/components/ui/Dialog";
import { useLayoutMotion, useMotion, fadeUp } from "@/lib/motion";
import { looksLikePdfExport } from "@/lib/chat/pdf-intent";
import { consumeSse } from "@/lib/chat/sse";
import { ChatOverlay } from "@/components/chat/ChatOverlay";
import { ModelSwitcher } from "@/components/chat/ModelSwitcher";
import { SelectionAskController } from "@/components/chat/SelectionAskController";
import { ConversationContextPanel } from "@/components/chat/ConversationContextPanel";
import { CommandPalette } from "@/components/chat/CommandPalette";
import { ArtifactFocusDialog } from "@/components/chat/ArtifactFocusDialog";
import { EvidenceDialog } from "@/components/chat/EvidenceDialog";
import type { SelectionSnapshot } from "@/components/chat/selection";
import { groupOverlayAnchors, type OverlayAnchor } from "@/lib/chat/overlay-threads";
import { buildConversationContext, type ConversationArtifact, type ConversationSource } from "@/lib/chat/conversation-context";
import type { GlobalSearchResult } from "@/lib/chat/global-search";
import { normalizeLabel } from "@/lib/concepts/slug";
import { suggestStudyActions, type StudyAction, type StudyActionConcept } from "@/lib/chat/study-actions";
import { useGlobalSearch } from "@/components/hooks/useGlobalSearch";
import { useArtifactVersions } from "@/components/hooks/useArtifactVersions";
import type {
  Attachment,
  Conversation,
  ConversationMode,
  Material,
  Message,
  MessageActivity,
  MessageGrounding,
  OverlayMessage,
  OverlayThread,
  Project,
  SourceEntry,
} from "@/lib/db/schema";

type MessageWithSources = Message & {
  sources?: SourceEntry[];
  activities?: MessageActivity[];
  grounding?: MessageGrounding | null;
  // Transient (in-memory only): not persisted to the DB. `upsertMessage`/
  // DB only stores `content`. Surfaced live while streaming and dropped on
  // reload.
  reasoning?: string;
  status?: string;
  // Optional human-readable label the server sends with a status event, used
  // INSTEAD of the static phase→label map so the server can show dynamic,
  // data-driven steps ("found 3 relevant passages…"). Cleared on text-delta
  // so the writing/thinking phases fall back to their static labels.
  statusLabel?: string;
};

type ChatAction = "send" | "regenerate" | "edit";

type OverlaySession = {
  thread: OverlayThread;
  messages: OverlayMessage[];
};

// Starter prompts for the empty states. The welcome hero and a brand-new
// conversation both surface these as one-click chips; the in-conversation
// set is mode-aware so Feynman mode offers "teach me" prompts instead.
const CHAT_SUGGESTIONS = [
  "Help me write a professional email",
  "Debug this function for me",
  "Summarize an article for me",
  "Explain a concept I'm learning",
];
const FEYNMAN_SUGGESTIONS = [
  "Quiz me on what I know",
  "Help me practice explaining an idea",
  "Role-play a conversation with me",
  "Challenge my understanding",
];

// Reflect the active conversation in the URL as `?c=<id>` so a hard reload
// restores it. Uses replaceState (not the Next router) to avoid re-renders /
// navigation churn — the param is purely a persistence marker, not a route.
function syncUrl(id: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("c", id);
  else url.searchParams.delete("c");
  window.history.replaceState(null, "", url);
}

// Map the DB mastery band (strong|learning|slipping|untested|unknown) onto the
// StudyActionConcept band vocabulary (new|needs-practice|review|mastered|null).
// Low-mastery ("new"/"needs-practice") drives the quiz-me suggestion; "unknown"
// (no linked cards) maps to null so it never triggers a quiz. Reused from the
// existing /api/concepts route — no model call, no new endpoint.
const BAND_TO_STUDY: Record<string, StudyActionConcept["band"]> = {
  untested: "new",
  slipping: "needs-practice",
  learning: "review",
  strong: "mastered",
  unknown: null,
};

export default function Page() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<MessageWithSources[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantStreamId, setAssistantStreamId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [convSheetOpen, setConvSheetOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextSheetOpen, setContextSheetOpen] = useState(false);
  const [focusedArtifact, setFocusedArtifact] = useState<{ content: string; kind: ConversationArtifact["kind"]; title: string } | null>(null);
  const [focusedSource, setFocusedSource] = useState<SourceEntry | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectMaterialCount, setActiveProjectMaterialCount] = useState<number | null>(null);
  // Full material list for the active project — threaded to <ChatMessage> so
  // the SourcesPanel can show ALL of the project's materials (not just the
  // ones cited in this turn) and mark which were used. Cleared on project change.
  const [activeProjectMaterials, setActiveProjectMaterials] = useState<{ id: string; title: string }[]>([]);
  // Global command palette (search state + debounced fetch + Cmd/Ctrl+K) and
  // native-artifact version overrides (load + transform/restore handlers),
  // extracted into hooks so this composition root stays legible. See
  // components/hooks/useGlobalSearch.ts and useArtifactVersions.ts.
  const search = useGlobalSearch(activeProjectId);
  const {
    overrides: artifactVersionOverrides,
    handleVersionChange: handleArtifactVersionChange,
    handleError: handleArtifactVersionError,
    resetForNewConversation: resetArtifactVersionOverrides,
  } = useArtifactVersions(conversation, messages, setError);
  const [models, setModels] = useState<Array<{ id: string; vision: boolean }>>([]);
  // True until the first conversations fetch resolves — drives the sidebar's
  // skeleton rows so the first paint doesn't look like an empty account.
  const [convLoading, setConvLoading] = useState(true);
  // A prompt handed to the composer from the welcome screen's suggestion
  // chips (create-then-prefill). Cleared once the conversation exists.
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  // Teach mode: id of the message whose lesson is (or was last) performing.
  const [teachLiveId, setTeachLiveId] = useState<string | null>(null);
  const teachInterruptedRef = useRef<string | null>(null);
  useEffect(() => {
    performer.setOnLessonDone((doneId) => {
      const back = teachInterruptedRef.current;
      if (back) {
        teachInterruptedRef.current = null;
        performer.resume();
        setTeachLiveId(back);
      }
    });
    return () => performer.setOnLessonDone(null);
  }, []);
  const [lastWeb, setLastWeb] = useState(true);
  const [overlaySession, setOverlaySession] = useState<OverlaySession | null>(null);
  const [overlayAnchors, setOverlayAnchors] = useState<Record<string, OverlayAnchor[]>>({});
  // Active-project concepts (label + mastery band) for study-action detection.
  // Fetched from the existing /api/concepts route and cleared on project change.
  const [activeProjectConcepts, setActiveProjectConcepts] = useState<StudyActionConcept[]>([]);
  // Prompt to send as the first overlay turn when a study action opens the
  // overlay. Cleared once consumed (ChatOverlay's send-once ref guards the
  // actual send); also cleared when the overlay closes.
  const [overlayInitialPrompt, setOverlayInitialPrompt] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastRunRef = useRef<Parameters<typeof runChat>[0] | null>(null);
  // Always-fresh pointer to the actions the global keydown handler needs, so a
  // listener bound once for the page lifetime still calls the latest closures
  // (newConversation/stop are re-created each render).
  const actionsRef = useRef<{
    newConversation: () => void;
    stop: () => void;
    streaming: boolean;
    closeOverlays: () => void;
  }>({ newConversation: () => {}, stop: () => {}, streaming: false, closeOverlays: () => {} });
  // Remembers the last user-chosen `web` toggle setting. Regenerate/edit
  // don't go through the composer, so they reuse this value to preserve the
  // turn's web-search preference instead of reverting to the default.
  const lastWebRef = useRef<boolean>(true);
  const m = useMotion();
  const layoutTransition = useLayoutMotion();
  const { slotEl } = useSidebarSlot();
  const conversationContext = useMemo(() => buildConversationContext(messages), [messages]);
  const contextItemCount = conversationContext.artifacts.length + conversationContext.sources.length;

  // Deterministic study actions per completed assistant message. Pure — no
  // model call. Recomputed only when messages or the active-project concepts
  // change. ChatMessage only renders chips for completed (!streaming) assistant
  // answers, so computing for in-flight messages is harmless (the UI gates it).
  const studyActionsByMessage = useMemo(() => {
    const map: Record<string, StudyAction[]> = {};
    for (const m of messages) {
      if (m.role !== "assistant" || m.kind === "document") continue;
      if (!m.content || !m.content.trim()) continue;
      map[m.id] = suggestStudyActions({
        content: m.content,
        sources: m.sources ?? [],
        concepts: activeProjectConcepts,
      });
    }
    return map;
  }, [messages, activeProjectConcepts]);

  useEffect(() => {
    const saved = window.localStorage.getItem("studygpt.context-rail.open");
    if (saved !== "true") return;
    const restore = window.setTimeout(() => setContextOpen(true), 0);
    return () => window.clearTimeout(restore);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("studygpt.context-rail.open", String(contextOpen));
  }, [contextOpen]);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (res.ok) setConversations(await res.json());
    } finally {
      setConvLoading(false);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    if (res.ok) setProjects(await res.json());
  }, []);

  const loadModels = useCallback(async () => {
    const res = await fetch("/api/models");
    if (res.ok) setModels((await res.json()).models ?? []);
  }, []);

  // Whether voice typing should record+transcribe via the OpenAI Whisper proxy
  // (server-side key) instead of the browser's built-in Web Speech API (which
  // needs Google's service and is often blocked by Arc shields / blockers).
  const [transcriptionAvailable, setTranscriptionAvailable] = useState(false);
  useEffect(() => {
    fetch("/api/transcribe")
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d: { available?: boolean }) => setTranscriptionAvailable(!!d.available))
      .catch(() => setTranscriptionAvailable(false));
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Restore the active conversation from `?c=<id>` after the conversation list
  // loads, so a hard reload lands back in the same chat instead of the empty
  // screen. Runs once (restoredRef) and yields to an already-active selection.
  const restoredRef = useRef(false);
  const initialConvId = useMemo(
    () => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("c")),
    [],
  );
  useEffect(() => {
    if (restoredRef.current || !initialConvId || !conversations.length || activeId) return;
    restoredRef.current = true;
    if (conversations.some((c) => c.id === initialConvId)) {
      // `selectConversation` is a function declaration (hoisted), so this call
      // is valid JS; the react-hooks/immutability rule flags the forward
      // reference because it can't track it. Properly resolving this (wrapping
      // in useCallback / moving the declaration) is part of the deferred
      // page.tsx decomposition (TODO.md item #7), not this batch.
      // eslint-disable-next-line react-hooks/immutability
      void selectConversation(initialConvId);
    } else {
      // Stale id (deleted in another tab) — clean the URL and stay on the
      // empty screen.
      syncUrl(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConvId, conversations, activeId]);

  // Auto-provision a ready-to-type conversation on first load. Landing on a
  // welcome screen that forces a "start a conversation" click is friction the
  // product should not have — chat is the home, so the composer must be ready
  // immediately. Runs once after the conversation list loads: if there's no
  // ?c restore and no active conversation, select the most recent existing
  // chat, or — for a brand-new user with none — create one. The ?c restore
  // effect above wins when it applies (it sets activeId first, which this
  // guard yields to). Skipped on /graph handoff (?q) so the prefill path owns
  // the mount.
  const autoProvisionRef = useRef(false);
  useEffect(() => {
    if (autoProvisionRef.current) return;
    // Wait for the conversation list fetch to resolve before deciding.
    if (convLoading) return;
    autoProvisionRef.current = true;
    if (activeId || conversation) return; // ?c restore or handoff already engaged
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("q")) return;
    if (conversations.length) {
      // eslint-disable-next-line react-hooks/immutability
      void selectConversation(conversations[0].id);
    } else {
      void newConversation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convLoading, conversations, activeId, conversation]);

  // Handoff from /graph "ask in chat": ?projectId=<pid>&q=<prompt>. Create a
  // project-scoped conversation and prefill the composer so the user reviews +
  // sends. Runs once on mount; the graph link never also sets ?c, so it does
  // not conflict with the ?c restore. Strips q/projectId from the URL after so
  // a reload doesn't re-create the conversation. (ChatInput seeds initialText
  // exactly once via its seededRef, so clearing pendingPrompt later is a no-op
  // — the textarea keeps the prompt.)
  const handoffRef = useRef(false);
  useEffect(() => {
    if (handoffRef.current || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (!q) return; // no handoff → let the ?c restore path handle mount
    handoffRef.current = true;
    const pid = params.get("projectId");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (pid) setActiveProjectId(pid);
    setPendingPrompt(q);
    void (async () => {
      try {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: pid ?? null }),
        });
        if (!res.ok) return;
        const conv: Conversation = await res.json();
        setConversations((prev) => [conv, ...prev]);
        setActiveId(conv.id);
        setConversation(conv);
        setMessages([]);
        const url = new URL(window.location.href);
        url.searchParams.set("c", conv.id);
        url.searchParams.delete("q");
        url.searchParams.delete("projectId");
        window.history.replaceState(null, "", url);
      } catch {
        /* ignore — user can start a conversation manually */
      } finally {
        setPendingPrompt(null);
      }
    })();
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadModels();
  }, [loadModels]);

  // When a project conversation is active, fetch its material count for the
  // header chip. Reset to null for standalone conversations.
  useEffect(() => {
    const pid = conversation?.project_id ?? null;
    if (!pid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveProjectMaterialCount(null);
      setActiveProjectMaterials([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects/${pid}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { project: Project; materials: Material[] } | null) => {
        if (!cancelled && d) {
          setActiveProjectMaterialCount(d.materials.length);
          setActiveProjectMaterials(d.materials.map((m) => ({ id: m.id, title: m.title })));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversation?.project_id]);

  // Load concept labels + mastery bands for the active project (no model call —
  // reuses the existing /api/concepts route). Cleared on project change / no
  // project. Used to suggest quiz-me for low-mastery mentioned concepts.
  useEffect(() => {
    const pid = conversation?.project_id ?? null;
    if (!pid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveProjectConcepts([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/concepts?projectId=${encodeURIComponent(pid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { concepts?: { label: string; band?: string }[] } | null) => {
        if (cancelled || !d?.concepts) return;
        setActiveProjectConcepts(
          d.concepts.map((c) => ({ label: c.label, band: BAND_TO_STUDY[c.band ?? "unknown"] ?? null })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversation?.project_id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, assistantStreamId]);

  function scrollToMessage(messageId: string) {
    const target = document.getElementById(`message-${messageId}`);
    if (!target) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    setHighlightedMessageId(messageId);
    window.setTimeout(() => setHighlightedMessageId((current) => current === messageId ? null : current), 1200);
    setContextSheetOpen(false);
  }

  function selectContextArtifact(artifact: ConversationArtifact, messageList = messages) {
    const message = messageList.find((candidate) => candidate.id === artifact.messageId);
    if (!message) {
      scrollToMessage(artifact.messageId);
      return;
    }
    setFocusedArtifact({ content: message.content, kind: artifact.kind, title: artifact.label });
    setContextSheetOpen(false);
  }

  function selectContextSource(source: ConversationSource) {
    scrollToMessage(source.messageId);
  }

  async function downloadContextDocument(artifact: ConversationArtifact) {
    try {
      const response = await fetch(`/api/messages/${artifact.messageId}/pdf`);
      if (!response.ok) throw new Error(response.statusText || "render failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${normalizeLabel(artifact.label) || "document"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      scrollToMessage(artifact.messageId);
    }
  }

  async function loadOverlayAnchors(conversationId: string) {
    const response = await fetch(`/api/chat/overlays?conversationId=${encodeURIComponent(conversationId)}`);
    if (!response.ok) return;
    const data = await response.json() as { threads?: OverlayThread[] };
    const anchors = (data.threads ?? []).map((thread) => ({
      id: thread.id,
      sourceMessageId: thread.source_message_id,
      selectedText: thread.selected_text,
      textOffset: thread.text_offset,
      updatedAt: thread.updated_at,
    }));
    setOverlayAnchors(groupOverlayAnchors(anchors));
  }

  async function resolveOverlay(snapshot: Pick<SelectionSnapshot, "sourceMessageId" | "selectedText" | "textOffset">) {
    if (!conversation || streaming) return;
    const response = await fetch("/api/chat/overlays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: conversation.id,
        sourceMessageId: snapshot.sourceMessageId,
        selectedText: snapshot.selectedText,
        textOffset: snapshot.textOffset,
      }),
    });
    if (!response.ok) {
      setError((await response.json().catch(() => ({}))).error || "Could not open the discussion.");
      return;
    }
    const data = await response.json() as OverlaySession;
    setOverlaySession(data);
    void loadOverlayAnchors(conversation.id);
  }

  async function selectConversation(id: string): Promise<{ conversation: Conversation; messages: MessageWithSources[] } | null> {
    setOverlaySession(null);
    setOverlayAnchors({});
    resetArtifactVersionOverrides();
    if (streaming) abortRef.current?.abort();
    setActiveId(id);
    syncUrl(id);
    setError(null);
    setConvSheetOpen(false);
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return null;
    const data = await res.json() as { conversation: Conversation; messages: MessageWithSources[] };
    setConversation(data.conversation);
    setMessages(data.messages ?? []);
    void loadOverlayAnchors(id);
    return data;
  }

  async function openStoredOverlay(overlayId: string, conversationId: string) {
    // A reopened stored overlay already has turns — it must NOT auto-send a
    // study-action prompt (ChatOverlay's turns>0 guard handles the send-skip,
    // and clearing here keeps the prop consistent).
    setOverlayInitialPrompt(null);
    const threadsResponse = await fetch(`/api/chat/overlays?conversationId=${encodeURIComponent(conversationId)}`);
    if (!threadsResponse.ok) return;
    const { threads = [] } = await threadsResponse.json() as { threads?: OverlayThread[] };
    const thread = threads.find((candidate) => candidate.id === overlayId);
    if (!thread) return;
    const response = await fetch("/api/chat/overlays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId,
        sourceMessageId: thread.source_message_id,
        selectedText: thread.selected_text,
        textOffset: thread.text_offset,
      }),
    });
    if (response.ok) setOverlaySession(await response.json() as OverlaySession);
  }

  async function selectSearchResult(result: GlobalSearchResult) {
    search.closePalette();
    if (result.kind === "material") {
      window.location.assign(`/projects?material=${encodeURIComponent(result.materialId)}`);
      return;
    }
    if (result.kind === "concept") {
      window.location.assign(`/graph?concept=${encodeURIComponent(result.conceptId)}`);
      return;
    }

    const data = await selectConversation(result.conversationId);
    if (!data) return;
    if (result.kind === "overlay") {
      await openStoredOverlay(result.overlayId, result.conversationId);
      return;
    }
    if (result.kind === "artifact") {
      const artifact = buildConversationContext(data.messages).artifacts.find((candidate) => candidate.id === result.artifactId);
      if (artifact) selectContextArtifact(artifact, data.messages);
      return;
    }
    if (result.kind === "message" && result.messageId) {
      window.setTimeout(() => scrollToMessage(result.messageId!), 50);
    }
  }

  async function newConversation() {
    setOverlaySession(null);
    setOverlayAnchors({});
    setError(null);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId }),
    });
    if (!res.ok) return; // a failed create must NOT push an error body into the list
    const conv: Conversation = await res.json();
    if (!conv?.id) return; // guard against a non-conversation body polluting the list
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    syncUrl(conv.id);
    setConversation(conv);
    setMessages([]);
  }

  // A welcome-screen suggestion chip: create a conversation and seed the
  // composer with the prompt so the user lands on a ready-to-send first turn
  // (gentle — they review and press Enter). We hand the prompt to ChatInput
  // via `pendingPrompt`/`initialText`, then clear it once the conversation
  // exists so a later re-render doesn't re-seed.
  async function welcomeChip(text: string) {
    setPendingPrompt(text);
    await newConversation();
    setPendingPrompt(null);
  }

  async function deleteConversation(id: string) {
    setOverlaySession(null);
    setOverlayAnchors({});
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      setActiveId(null);
      setConversation(null);
      setMessages([]);
      syncUrl(null);
    }
  }

  async function changeMode(mode: ConversationMode) {
    setOverlaySession(null);
    if (!conversation) return;
    const res = await fetch(`/api/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    const updated: Conversation = await res.json();
    setConversation(updated);
    setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  async function changeModel(model: string) {
    setOverlaySession(null);
    if (!conversation) return;
    const res = await fetch(`/api/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    const updated: Conversation = await res.json();
    setConversation(updated);
    setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  // Core streaming runner. `baseDisplay` is the message list to show *before*
  // the new assistant bubble (already includes any new/edited user message).
  // runChat appends the (empty) assistant bubble, streams into it, and
  // persists per `action`.
  function applyConversationUpdate(updated: Conversation) {
    setConversation(updated);
    setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  async function runChat(args: {
    action: ChatAction;
    history: MessageWithSources[];
    assistantId: string;
    baseDisplay: MessageWithSources[];
    userMessageId?: string;
    replaceAssistantId?: string;
    editMessageId?: string;
    editContent?: string;
    editAttachments?: Attachment[];
    // true for a one-shot document turn → optimistic assistant bubble is
    // tagged kind='document' and the server uses the document-authoring prompt.
    document?: boolean;
    // Web-search toggle from the composer. Regenerate/edit reuse the last
    // user-chosen value via lastWebRef so those turns preserve the setting.
    web?: boolean;
    // Teach mode: interruption context (interrupted lesson + progress +
    // marked board region) appended to the system prompt server-side.
    teachContext?: { lessonMd?: string; deliveredUpTo?: string; selection?: string; board?: string };
  }) {
    const conv = conversation;
    if (!conv) return;
    lastRunRef.current = args;
    setError(null);
    const assistantMsg: MessageWithSources = {
      id: args.assistantId,
      conversation_id: conv.id,
      role: "assistant",
      content: "",
      kind: args.document ? "document" : "chat",
      delivery_state: "complete",
      attachments: null,
      tokens: null,
      // Date.now() here is in the send-chat event handler (not render); the
      // react-hooks/purity rule misidentifies the function context. Capturing
      // the timestamp at call time is the correct behavior for a message row.
      // eslint-disable-next-line react-hooks/purity
      created_at: Date.now(),
      status: "thinking",
    };
    setMessages([...args.baseDisplay, assistantMsg]);
    setAssistantStreamId(args.assistantId);
    setTeachLiveId(args.assistantId);
    performer.resume();
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";
    // Patch the in-flight assistant message by id, merging the given fields
    // into the matching entry in setMessages. Used by the SSE handlers below.
    const patch = (fields: Partial<Pick<MessageWithSources, "content" | "reasoning" | "status" | "statusLabel" | "activities" | "grounding">>) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === args.assistantId ? { ...m, ...fields } : m)),
      );
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conv.id,
          messages: args.history.map((m) => ({ role: m.role, content: m.content, attachments: m.attachments ?? undefined })),
          action: args.action,
          userMessageId: args.userMessageId,
          assistantMessageId: args.assistantId,
          replaceAssistantId: args.replaceAssistantId,
          editMessageId: args.editMessageId,
          editContent: args.editContent,
          editAttachments: args.editAttachments,
          document: args.document,
          web: args.web,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `Request failed (${res.status})`);
      }
      if (!res.body) throw new Error("No response stream");

      let reasoningAcc = "";
      await consumeSse(
        res,
        {
          onEvent: (event) => {
            if (event.type === "text") {
              acc += event.delta;
              // Once the model starts emitting text, drop any dynamic pre-model
              // label (e.g. "found 3 relevant passages…") so the writing/thinking
              // phases render with their static labels instead of a stale one.
              patch({ content: acc, status: acc ? "writing" : "thinking", statusLabel: undefined });
            } else if (event.type === "reasoning") {
              reasoningAcc += event.delta;
              patch({ reasoning: reasoningAcc });
            } else if (event.type === "status") {
              // Prefer the server's dynamic `label` (data-driven) over the static
              // phase→label map; fall back to the map when no label is sent.
              patch({ status: event.phase, statusLabel: event.label });
            } else if (event.type === "activity") {
              setMessages((previous) =>
                previous.map((message) =>
                  message.id === args.assistantId
                    ? { ...message, activities: [...(message.activities ?? []), event.activity] }
                    : message,
                ),
              );
            } else if (event.type === "grounding") {
              patch({ grounding: event.grounding });
            }
          },
        },
        controller.signal,
      );
    } catch (err) {
      if (acc) {
        // Keep a partial reply regardless of whether the user stopped it or
        // the provider ended unexpectedly. The PATCH is idempotent and the
        // server's completed upsert wins if it already finished.
        fetch("/api/messages", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: conv.id,
            messageId: args.assistantId,
            role: "assistant",
            content: acc,
            kind: args.document ? "document" : "chat",
            deliveryState: "interrupted",
          }),
        }).catch(() => {});
        setMessages((prev) =>
          prev.map((message) =>
            message.id === args.assistantId ? { ...message, delivery_state: "interrupted" } : message,
          ),
        );
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Response interrupted");
        }
      } else if (controller.signal.aborted) {
        // Stopped before any token — drop the empty bubble.
        setMessages((prev) => prev.filter((m) => m.id !== args.assistantId));
      } else {
        const msg = err instanceof Error ? err.message : "Something went wrong";
        setError(msg);
        setMessages((prev) => prev.filter((m) => m.id !== args.assistantId));
      }
    } finally {
      // Sources fetch lives in `finally` so the Sources panel populates on
      // both normal completion AND a mid-stream abort. The server writes the
      // message_sources row before streaming starts, so it already exists.
      // Fire-and-forget: the .then merge is a no-op if the assistant message
      // was dropped (e.g. stop-before-any-token in the catch branch above).
      fetch(`/api/messages/${args.assistantId}`)
        .then((r) => r.json())
        .then((d: { sources?: SourceEntry[] }) => {
          if (d.sources?.length) {
            setMessages((prev) =>
              prev.map((m) => (m.id === args.assistantId ? { ...m, sources: d.sources } : m)),
            );
          }
        })
        .catch(() => {});
      setStreaming(false);
      setAssistantStreamId(null);
      abortRef.current = null;
      // Clear the transient status/reasoning-in-progress flag now that the
      // turn is finished (or stopped with a partial). The status line above
      // the bubble only shows while a phase is active.
      setMessages((prev) =>
        prev.map((m) => (m.id === args.assistantId ? { ...m, status: undefined } : m)),
      );
    }
  }

  async function sendMessage(text: string, attachments: Attachment[], document = false, web = true) {
    if (!conversation || streaming) return;
    setOverlaySession(null);
    // Auto-flip into document mode when the user asks for a PDF/export — so
    // "make me a PDF with the notes" produces a document card with the
    // download-PDF button instead of a plain chat reply (where the model
    // would otherwise refuse and suggest external tools). An explicit
    // toggle on already sets document=true; the detection is additive.
    const documentMode = document || looksLikePdfExport(text);
    lastWebRef.current = web;
    setLastWeb(web);

    // Teach mode: a message sent while the teacher is mid-performance is an
    // interruption — pause the performance, remember which lesson to resume,
    // and hand the model the plan + progress + any marked board region.
    let teachContext:
      | { lessonMd?: string; deliveredUpTo?: string; selection?: string; board?: string }
      | undefined;
    if (conversation.mode === "teach") {
      const sel = performer.takeSelection() ?? undefined;
      const board = boardInventory(
        messages
          .filter((m) => m.role === "assistant")
          .map((m) => m.content)
          .join("\n\n"),
      );
      if (performer.isActive() && teachLiveId) {
        performer.pause();
        teachInterruptedRef.current = teachLiveId;
        const s = performer.status();
        const teachLiveMd = messages.find((m) => m.id === teachLiveId)?.content || "";
        teachContext = {
          lessonMd: teachLiveMd,
          deliveredUpTo: `${s.cursor} of ${s.total} events (last shown: ${s.lastShown ?? "nothing yet"})`,
          selection: sel,
          board: board || undefined,
        };
      } else if (sel || board) {
        teachContext = { selection: sel, board: board || undefined };
      }
    }

    const userMsg: MessageWithSources = {
      id: crypto.randomUUID(),
      conversation_id: conversation.id,
      role: "user",
      content: text,
      kind: "chat",
      delivery_state: "complete",
      attachments: attachments.length ? attachments : null,
      tokens: null,
      // In the edit-and-resend event handler (not render); see the matching
      // note on the send path above. react-hooks/purity misidentifies context.
      // eslint-disable-next-line react-hooks/purity
      created_at: Date.now(),
    };
    const outgoing = [...messages, userMsg];
    setMessages(outgoing);

    // Optimistically title the conversation on the first turn (server does too).
    if (conversation.title === "New conversation") {
      const newTitle = text.slice(0, 50).trim() || "New conversation";
      const titled = { ...conversation, title: newTitle };
      setConversation(titled);
      setConversations((prev) => prev.map((c) => (c.id === titled.id ? titled : c)));
    }

    await runChat({
      action: "send",
      history: outgoing,
      baseDisplay: outgoing,
      assistantId: crypto.randomUUID(),
      userMessageId: userMsg.id,
      document: documentMode,
      web,
      teachContext,
    });
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function retry() {
    if (!conversation || streaming) return;
    const last = lastRunRef.current;
    if (!last) return;
    await runChat(last);
  }

  async function regenerate() {
    if (!conversation || streaming) return;
    setOverlaySession(null);
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return;
    const history = messages.filter((m) => m.id !== lastAssistant.id);
    const baseDisplay = history; // drop old assistant, new one appended by runChat
    await runChat({
      action: "regenerate",
      history,
      baseDisplay,
      assistantId: crypto.randomUUID(),
      replaceAssistantId: lastAssistant.id,
      // Regenerating a document stays a document (keeps the document prompt +
      // document card); regenerating a chat reply stays chat.
      document: lastAssistant.kind === "document",
      web: lastWebRef.current,
    });
  }

  // Regenerate the assistant reply to a SPECIFIC user prompt — the "retry from
  // here" affordance on each user message. Drops everything after that prompt
  // (the old reply + any later turns) and re-streams a fresh reply, leaving
  // the prompt itself unchanged. Implemented as an edit-with-identical-content
  // so it reuses the server's edit branch (updateMessageContent is a no-op on
  // unchanged content; deleteMessagesAfter drops the trailing messages; then it
  // re-streams from the history we send). Document vs chat is preserved from
  // the reply being replaced, so a document retry stays a document.
  async function regenerateFromPrompt(messageId: string) {
    if (!conversation || streaming) return;
    setOverlaySession(null);
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx === -1 || messages[idx].role !== "user") return;
    const prompt = messages[idx];
    const followingAssistant = messages.slice(idx + 1).find((m) => m.role === "assistant");
    const document = followingAssistant?.kind === "document";
    const history = messages.slice(0, idx + 1); // keep through the prompt, drop the rest
    await runChat({
      action: "edit",
      history,
      baseDisplay: history,
      assistantId: crypto.randomUUID(),
      editMessageId: messageId,
      editContent: prompt.content,
      // undefined (rather than []) when there are no attachments, so the
      // server skips updateMessageAttachments and leaves the prompt's
      // attachments null instead of mutating null → [].
      editAttachments: prompt.attachments ?? undefined,
      document,
      web: lastWebRef.current,
    });
  }

  async function editMessage(messageId: string, newContent: string, attachments: Attachment[]) {
    if (!conversation || streaming) return;
    setOverlaySession(null);
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const nextAttachments = attachments.length > 0 ? attachments : null;
    const edited: MessageWithSources = { ...messages[idx], content: newContent, attachments: nextAttachments };
    const history = [...messages.slice(0, idx), edited]; // drop everything after
    await runChat({
      action: "edit",
      history,
      baseDisplay: history,
      assistantId: crypto.randomUUID(),
      editMessageId: messageId,
      editContent: newContent,
      editAttachments: attachments,
      web: lastWebRef.current,
    });
  }

  // Index of the last assistant message — for the regenerate affordance.
  const lastAssistantId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].id;
    }
    return null;
  })();

  // Keep the global-shortcut action pointer fresh each render (function
  // declarations are hoisted so newConversation/stop/closeOverlays are in
  // scope here). The keydown effect below reads through actionsRef so a
  // once-bound listener always calls current closures.
  actionsRef.current.newConversation = () => void newConversation();
  actionsRef.current.stop = stop;
  actionsRef.current.streaming = streaming;
  actionsRef.current.closeOverlays = () => {
    setOverlaySession(null);
    setOverlayInitialPrompt(null);
    setFocusedArtifact(null);
    setFocusedSource(null);
    setConvSheetOpen(false);
    setContextSheetOpen(false);
  };

  // Global keyboard shortcuts, bound once for the page lifetime:
  //   ⌘/Ctrl+N  → new conversation
  //   Esc       → stop streaming; if not streaming, close any open overlay/dialog
  // ⌘N is the standard "new" shortcut in chat apps; Esc-to-stop is the
  // fastest way to halt a runaway answer without reaching for the mouse.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const a = actionsRef.current;
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "n") {
        event.preventDefault();
        a.newConversation();
        return;
      }
      if (event.key === "Escape") {
        if (a.streaming) {
          event.preventDefault();
          a.stop();
        } else {
          a.closeOverlays();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Teach mode takes over the whole viewport: an infinite paper canvas with
  // floating overlay chrome. The layout below serves chat/feynman modes.
  const isTeach = conversation?.mode === "teach";
  const teachLiveMd =
    (teachLiveId && messages.find((m) => m.id === teachLiveId)?.content) || "";
  const teachBaseMd = useMemo(
    () =>
      messages
        .filter((m) => m.role === "assistant" && m.id !== teachLiveId)
        .map((m) => m.content)
        .join("\n\n"),
    [messages, teachLiveId],
  );

  if (isTeach && conversation) {
    return (
      <TeachStage
        conversationId={conversation.id}
        baseMd={teachBaseMd}
        liveMd={teachLiveMd}
        liveKey={teachLiveId}
        streaming={streaming}
        messages={messages}
        title={conversation.title}
        projectName={projects.find((p) => p.id === conversation.project_id)?.name ?? null}
        onSend={(text) => sendMessage(text, [])}
        onStop={stop}
        error={error}
        onRetry={retry}
        onExit={() => changeMode("chat")}
        transcriptionAvailable={transcriptionAvailable}
        onLessonAmended={(messageId, correctionMd) =>
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId && !m.content.endsWith(correctionMd)
                ? { ...m, content: `${m.content}\n\n${correctionMd}` }
                : m,
            ),
          )
        }
        personaControl={
          <PersonaEditor
            key={conversation.id}
            conversation={conversation}
            onUpdated={applyConversationUpdate}
            compact
          />
        }
      />
    );
  }

  return (
    <>
      {/* Desktop conversation list lives in the global Sidebar (AppShell) via a
          portal — the chat page owns the conversation state, the Sidebar owns
          the chrome, so there's a single left column instead of a rail + a
          separate pane. Hidden below `tab` (the Sidebar is hidden there; mobile
          uses the slide-in sheet below). Only portal once the slot has mounted. */}
      {slotEl &&
        createPortal(
          <ConversationListPane
            conversations={conversations}
            activeId={activeId}
            onSelect={selectConversation}
            onNew={newConversation}
            onDelete={deleteConversation}
            query={query}
            onQueryChange={setQuery}
            projects={projects}
            activeProjectId={activeProjectId}
            onProjectChange={setActiveProjectId}
            loading={convLoading}
          />,
          slotEl,
        )}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border bg-paper/80 px-4 py-3 backdrop-blur-sm tab:px-5">
          <div className="flex min-w-0 items-center gap-3">
            {/* Mobile: conversation list slides in from the left (desktop pane
                is always visible at tab+). */}
            <Dialog open={convSheetOpen} onOpenChange={setConvSheetOpen}>
              <DialogTrigger asChild>
                <IconButton label="Conversations" className="tab:hidden">
                  <MessageSquare size={17} strokeWidth={1.75} />
                </IconButton>
              </DialogTrigger>
              <DialogContent side="left" showClose={false} className="p-0">
                <ConversationListPane
                  conversations={conversations}
                  activeId={activeId}
                  onSelect={selectConversation}
                  onNew={newConversation}
                  onDelete={deleteConversation}
                  query={query}
                  onQueryChange={setQuery}
                  projects={projects}
                  activeProjectId={activeProjectId}
                  onProjectChange={setActiveProjectId}
                  loading={convLoading}
                />
              </DialogContent>
            </Dialog>
            <span className="truncate text-[15px] italic text-ink-2">
              {conversation?.title ?? "Select or start a conversation"}
            </span>
            <IconButton label="Search everything" onClick={search.openPalette}>
              <Search size={16} strokeWidth={1.8} />
            </IconButton>
          </div>
          {conversation && (
            <div className="flex shrink-0 items-center gap-3">
              {conversation.project_id && (() => {
                const p = projects.find((x) => x.id === conversation.project_id);
                if (!p) return null;
                return (
                  <a
                    href="/projects"
                    className="mono hidden items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] tracking-wide text-feynman transition-colors hover:text-content sm:inline-flex"
                  >
                    {p.name}
                    {activeProjectMaterialCount !== null && (
                      <span className="text-content-faint">
                        · {activeProjectMaterialCount} material{activeProjectMaterialCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </a>
                );
              })()}
              <Dialog open={contextSheetOpen} onOpenChange={setContextSheetOpen}>
                <DialogTrigger asChild>
                  <IconButton label="Open conversation context" className="tab:hidden">
                    <PanelRightOpen size={17} strokeWidth={1.75} />
                  </IconButton>
                </DialogTrigger>
                <DialogContent side="right" className="flex p-0">
                  <ConversationContextPanel
                    variant="sheet"
                    context={conversationContext}
                    onSelectArtifact={selectContextArtifact}
                    onSelectSource={selectContextSource}
                    onDownloadDocument={downloadContextDocument}
                  />
                </DialogContent>
              </Dialog>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setContextOpen((open) => !open)}
                aria-expanded={contextOpen}
                aria-controls="conversation-context-rail"
                className="hidden gap-1.5 tab:inline-flex"
              >
                {contextOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
                context
                {contextItemCount > 0 && (
                  <span className="mono text-[10px] text-content-faint">{contextItemCount}</span>
                )}
              </Button>
              <ModelSwitcher value={conversation.model} models={models} onChange={changeModel} />
              <PersonaEditor
                key={conversation.id}
                conversation={conversation}
                onUpdated={applyConversationUpdate}
              />
              <ModeToggle mode={conversation.mode} onChange={changeMode} />
            </div>
          )}
        </header>

        <div className="flex min-h-0 min-w-0 flex-1">
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              ref={scrollRef}
              className="chat-scroll graph-paper min-h-0 flex-1 overflow-y-auto px-4 py-8 pb-[calc(4.5rem+env(safe-area-inset-bottom))] tab:px-6 tab:pb-8"
            >
          {!conversation ? (
            <div className="flex min-h-full items-center justify-center">
              <motion.div {...m} variants={fadeUp} className="w-full max-w-[560px]">
                <Card accent className="px-8 py-10 sm:px-10">
                  <p className="eyebrow">Loom</p>
                  <h1 className="hero-title mt-4">
                    Ask anything.
                    <br />
                    Think out loud.
                  </h1>
                  <p className="hero-lede mt-4">
                    A calm, local place to write, ask, and work through ideas.
                    Attach materials to a project, or turn on study tools to learn
                    by explaining something back.
                  </p>
                  <div className="mt-7">
                    <Button variant="primary" onClick={() => newConversation()}>
                      <Plus size={15} strokeWidth={2} />
                      start a conversation
                    </Button>
                  </div>
                  <div className="mt-6 flex flex-wrap gap-2">
                    {CHAT_SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => welcomeChip(s)}
                        className="mono rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] text-content-muted transition-[transform,border-color,background-color] duration-fast ease-out hover:-translate-y-px hover:border-border-strong hover:bg-surface-2 hover:text-content"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </Card>
              </motion.div>
            </div>
          ) : (
            <div className="chat-content flex w-full flex-col">
              {messages.length === 0 && !streaming && (
                <motion.div {...m} variants={fadeUp} className="mx-auto mt-20 w-full max-w-[520px] text-center">
                  <p className="eyebrow">Ask</p>
                  <h2 className="mt-4 text-[1.4rem] leading-tight text-ink">
                    Ask your first question.
                  </h2>
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    {(conversation.mode === "feynman" ? FEYNMAN_SUGGESTIONS : CHAT_SUGGESTIONS).map(
                      (s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => sendMessage(s, [])}
                          className="mono rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] text-content-muted transition-[transform,border-color,background-color] duration-fast ease-out hover:-translate-y-px hover:border-border-strong hover:bg-surface-2 hover:text-content"
                        >
                          {s}
                        </button>
                      ),
                    )}
                  </div>
                </motion.div>
              )}
              {messages.map((m, i) => (
                <motion.div
                  key={m.id}
                  id={`message-${m.id}`}
                  layout={!streaming}
                  transition={layoutTransition}
                  className={`${i === 0 ? "pt-2" : "mt-6 border-t border-border pt-6"}${highlightedMessageId === m.id ? " rounded-card bg-rule/5 ring-1 ring-rule/30 transition-[background-color,box-shadow] duration-fast" : ""}`}
                >
                  <ChatMessage
                    id={m.id}
                    role={m.role}
                    content={m.content}
                    attachments={m.attachments}
                    kind={m.kind}
                    deliveryState={m.delivery_state}
                    streaming={streaming && m.id === assistantStreamId}
                    sources={m.sources}
                    activities={m.activities}
                    grounding={m.grounding}
                    status={m.status}
                    statusLabel={m.statusLabel}
                    reasoning={m.reasoning}
                    allMaterials={activeProjectMaterials}
                    canRegenerate={m.role === "user" ? true : m.id === lastAssistantId}
                    onRegenerate={m.role === "user" ? () => regenerateFromPrompt(m.id) : regenerate}
                    onEdit={(content, attachments) => editMessage(m.id, content, attachments)}
                    conversationTitle={conversation?.title}
                    conversationId={conversation?.id}
                    overlayAnchors={m.role === "assistant" ? overlayAnchors[m.id] ?? [] : []}
                    onOpenOverlay={(anchor: OverlayAnchor) => {
                      // Opening an overlay from a stored source-marker anchor must
                      // NOT auto-send a study-action prompt — clear any stale one.
                      setOverlayInitialPrompt(null);
                      void resolveOverlay(anchor);
                    }}
                    onOpenSource={setFocusedSource}
                    studyActions={m.role === "assistant" && m.kind !== "document" ? studyActionsByMessage[m.id] : undefined}
                    onStudyAction={
                      m.role === "assistant" && m.kind !== "document"
                        ? (action: StudyAction) => {
                            // Open the overlay anchored to the action's selectedText
                            // and arrange for the action's prompt to be sent as the
                            // first overlay turn. setOverlayInitialPrompt is batched
                            // with resolveOverlay's setOverlaySession, so ChatOverlay
                            // mounts with the prompt already in hand.
                            setOverlayInitialPrompt(action.prompt);
                            void resolveOverlay({
                              sourceMessageId: m.id,
                              selectedText: action.selectedText,
                              textOffset: Math.max(0, m.content.indexOf(action.selectedText)),
                            });
                          }
                        : undefined
                    }
                    artifactVersionOverrides={
                      m.role === "assistant" && m.kind !== "document" && !(streaming && m.id === assistantStreamId)
                        ? artifactVersionOverrides
                        : undefined
                    }
                    onArtifactVersionChange={
                      m.role === "assistant" && m.kind !== "document"
                        ? handleArtifactVersionChange
                        : undefined
                    }
                    onArtifactVersionError={handleArtifactVersionError}
                  />
                </motion.div>
              ))}
              {conversation && !streaming && (
                <SelectionAskController
                  onAsk={(snap) => {
                    // Selection-ask opens a fresh overlay; it must not inherit a
                    // stale study-action prompt.
                    setOverlayInitialPrompt(null);
                    void resolveOverlay(snap);
                  }}
                />
              )}
            </div>
          )}
            </div>

            {error && (
              <div className="chat-content px-4">
                <div className="mono flex items-center gap-3 rounded-card border border-danger/40 bg-danger/5 px-3.5 py-3 text-[12px] text-danger shadow-sm">
                  <span className="flex-1">{error}</span>
                  <Button variant="ghost" size="sm" onClick={retry} className="text-danger hover:text-danger">
                    <RefreshCw size={13} />
                    retry
                  </Button>
                </div>
              </div>
            )}

            {/* Composer: flush to the bottom of the content panel (native Mac
                bottom-bar pattern, like Claude's app) — the form's own padding
                handles the insets. A top divider separates it from the scroll
                area instead of a floating card + shadow, which read less
                native on macOS. */}
            <div className="border-t border-line bg-paper">
              <ChatInput
                onSend={sendMessage}
                onStop={stop}
                streaming={streaming}
                disabled={streaming || !conversation}
                projectId={conversation?.project_id ?? null}
                transcriptionAvailable={transcriptionAvailable}
                initialText={pendingPrompt ?? undefined}
                placeholder={
                  conversation
                    ? conversation.mode === "feynman"
                      ? "Explain a concept back in your own words…"
                      : "Message Loom… (Enter to send)"
                    : "Start a conversation first"
                }
              />
            </div>
          </section>
          {contextOpen && (
            <aside
              id="conversation-context-rail"
              aria-label="Conversation context"
              className="hidden w-72 shrink-0 border-l border-border/60 bg-paper/70 tab:flex"
            >
              <ConversationContextPanel
                variant="rail"
                context={conversationContext}
                onSelectArtifact={selectContextArtifact}
                onSelectSource={selectContextSource}
                onDownloadDocument={downloadContextDocument}
              />
            </aside>
          )}
        </div>
        {overlaySession && conversation && (
          <ChatOverlay
            thread={overlaySession.thread}
            initialMessages={overlaySession.messages}
            web={lastWeb}
            allMaterials={activeProjectMaterials}
            transcriptionAvailable={transcriptionAvailable}
            initialPrompt={overlayInitialPrompt ?? undefined}
            onClose={() => {
              setOverlaySession(null);
              setOverlayInitialPrompt(null);
            }}
          />
        )}
        {focusedArtifact && (
          <ArtifactFocusDialog
            open
            onOpenChange={(open) => !open && setFocusedArtifact(null)}
            content={focusedArtifact.content}
            kind={focusedArtifact.kind}
            title={focusedArtifact.title}
          />
        )}
        <EvidenceDialog source={focusedSource} onOpenChange={setFocusedSource} />
        <CommandPalette
          open={search.open}
          onOpenChange={search.onOpenChange}
          onSelect={selectSearchResult}
          results={search.results}
          query={search.query}
          onQueryChange={search.setQuery}
          loading={search.loading}
          activeIndex={search.activeIndex}
          onActiveIndexChange={search.setActiveIndex}
        />
      </main>
    </>
  );
}
