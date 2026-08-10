// Module store for the lesson performance: pause flag, per-message cursor
// progress, interruption bookkeeping, and the student's marked selection.
// Lives outside React so board items (which poll paused() between strokes),
// the TeachPanel pump, and page.tsx (which builds teachContext for an
// interrupting question) all see one source of truth.

export interface WorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PerformerStatus {
  activeId: string | null;
  activeEventIndex: number | null;
  cursor: number;
  total: number;
  lastShown: string | null;
}

const st = {
  paused: false,
  activeId: null as string | null,
  activeEventIndex: null as number | null,
  cursor: 0,
  total: 0,
  lastShown: null as string | null,
  progress: new Map<string, number>(),
  statusListeners: new Set<(status: PerformerStatus) => void>(),
  onLessonDone: null as ((id: string) => void) | null,
  selection: null as string | null,
  selectionRect: null as WorldRect | null,
  selectionListeners: new Set<(s: string | null) => void>(),
  // Anchor consumed by the NEXT lesson that starts (an answer to a marked
  // question), then remembered per lesson id so resume re-anchors correctly.
  pendingAnchor: null as WorldRect | null,
  anchors: new Map<string, WorldRect>(),
};

function statusSnapshot(): PerformerStatus {
  return {
    activeId: st.activeId,
    activeEventIndex: st.activeEventIndex,
    cursor: st.cursor,
    total: st.total,
    lastShown: st.lastShown,
  };
}

function notifyStatus(): void {
  const status = statusSnapshot();
  st.statusListeners.forEach((fn) => fn(status));
}

export const performer = {
  paused: () => st.paused,
  pause(): void {
    st.paused = true;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* SSR */
    }
  },
  resume(): void {
    st.paused = false;
  },
  isActive(): boolean {
    return st.activeId !== null && st.cursor < st.total;
  },

  begin(id: string, total: number, cursor: number): void {
    st.activeId = id;
    st.activeEventIndex = cursor < total ? cursor : null;
    st.total = total;
    st.cursor = cursor;
    notifyStatus();
  },
  activate(id: string, eventIndex: number): void {
    if (st.activeId !== id || st.activeEventIndex === eventIndex) return;
    st.activeEventIndex = eventIndex;
    notifyStatus();
  },
  advance(id: string, cursor: number, lastShown?: string): void {
    st.progress.set(id, cursor);
    if (st.activeId === id) {
      st.cursor = cursor;
      if (lastShown) st.lastShown = lastShown;
      notifyStatus();
    }
  },
  getProgress(id: string): number {
    return st.progress.get(id) ?? 0;
  },
  finish(id: string): void {
    if (st.activeId === id) {
      st.activeId = null;
      st.activeEventIndex = null;
      notifyStatus();
    }
    st.onLessonDone?.(id);
  },
  status(): PerformerStatus {
    return statusSnapshot();
  },
  subscribeStatus(fn: (status: PerformerStatus) => void): () => void {
    st.statusListeners.add(fn);
    fn(statusSnapshot());
    return () => st.statusListeners.delete(fn);
  },
  setOnLessonDone(fn: ((id: string) => void) | null): void {
    st.onLessonDone = fn;
  },

  // Student's marked board region (described via the spatial index). Consumed
  // by the next question; peek keeps it visible in the UI until sent. The
  // world rect rides along so the answer can be written beside the mark.
  setSelection(desc: string | null, rect: WorldRect | null = null): void {
    st.selection = desc;
    st.selectionRect = desc ? rect : null;
    st.selectionListeners.forEach((fn) => fn(desc));
  },
  peekSelection(): string | null {
    return st.selection;
  },
  takeSelection(): string | null {
    const s = st.selection;
    if (s && st.selectionRect) st.pendingAnchor = st.selectionRect;
    performer.setSelection(null);
    return s;
  },
  // Called by the stage when a lesson's performance starts: binds the pending
  // anchor (if any) to that lesson id. Idempotent for resumes.
  anchorFor(lessonId: string): WorldRect | null {
    if (st.pendingAnchor) {
      st.anchors.set(lessonId, st.pendingAnchor);
      st.pendingAnchor = null;
    }
    return st.anchors.get(lessonId) ?? null;
  },
  subscribeSelection(fn: (s: string | null) => void): () => void {
    st.selectionListeners.add(fn);
    return () => st.selectionListeners.delete(fn);
  },
};
