"use client";

import { X } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import type { ContextArtifactKind } from "@/lib/chat/conversation-context";

const KIND_LABELS: Record<ContextArtifactKind, string> = {
  document: "Focused document",
  diagram: "Focused diagram",
  visualization: "Focused visualization",
  flashcards: "Focused flashcards",
};

export type ArtifactFocusDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  content: string;
  kind: ContextArtifactKind;
  title: string;
};

export function ArtifactFocusDialogBody({
  content,
  kind,
  title,
}: Omit<ArtifactFocusDialogProps, "open" | "onOpenChange">) {
  return (
    <>
      <DialogHeader className="flex shrink-0 items-start gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <DialogTitle className="truncate pr-8">{title}</DialogTitle>
          <DialogDescription>{KIND_LABELS[kind]}</DialogDescription>
        </div>
        <DialogClose
          aria-label="Close focus view"
          className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-content-faint transition-colors hover:bg-surface-2 hover:text-content focus-visible:ring-2 focus-visible:ring-ring outline-none"
        >
          <X size={16} />
        </DialogClose>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
        <Markdown content={content} />
      </div>
    </>
  );
}

export function ArtifactFocusDialog({
  open,
  onOpenChange,
  content,
  kind,
  title,
}: ArtifactFocusDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showClose={false}
        className="flex h-[min(88dvh,56rem)] w-[min(96vw,72rem)] max-w-none flex-col overflow-hidden"
      >
        <ArtifactFocusDialogBody content={content} kind={kind} title={title} />
      </DialogContent>
    </Dialog>
  );
}
