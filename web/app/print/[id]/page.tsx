"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Markdown } from "@/components/Markdown";
import { PrintButton } from "@/components/PrintButton";
import { Skeleton } from "@/components/Skeleton";

interface Doc {
  content: string;
  kind: string;
  conversationTitle: string | null;
  sources?: { title: string; snippet: string }[];
}

// /print/[id] — a chrome-free page that renders an authored document so the
// user can print it to PDF (⌘P → Save as PDF). Same Markdown pipeline as the
// chat card, so what you preview is what prints. The `.no-print` chrome
// (back link, print button) and the print stylesheet in globals.css strip
// everything but the document on the printed page.
export default function PrintPage() {
  const params = useParams<{ id: string }>();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!params.id) return;
    fetch(`/api/messages/${params.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: Doc) => setDoc(d))
      .catch(() => setErr("Document not found."));
  }, [params.id]);

  if (err) return <div className="mono p-8 text-sm text-rule">{err}</div>;
  if (!doc) {
    return (
      <div className="min-h-screen bg-paper-2">
        <div className="no-print mx-auto flex max-w-[760px] items-center justify-between px-6 py-6">
          <Link
            href="/"
            className="mono text-[12px] tracking-wide text-ink-3 transition-colors hover:text-ink"
          >
            ← back to chat
          </Link>
        </div>
        <article className="mx-auto max-w-[760px] px-2 py-6">
          <Skeleton className="h-9 w-2/3" />
          <div className="mt-8 flex flex-col gap-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper-2">
      <div className="no-print mx-auto flex max-w-[760px] items-center justify-between px-6 py-6">
        <Link href="/" className="mono text-[12px] tracking-wide text-ink-3 transition-colors hover:text-ink">
          ← back to chat
        </Link>
        <PrintButton />
      </div>
      <article className="print-sheet mx-auto max-w-[760px] px-2 py-6">
        <Markdown content={doc.content} className="prose-chat text-ink" />
      </article>
    </div>
  );
}