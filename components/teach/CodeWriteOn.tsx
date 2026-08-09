"use client";

import { useEffect, useRef } from "react";
import { signalDone } from "@/lib/teach/completion";
import { performer } from "@/lib/teach/performer";
import { register } from "@/lib/teach/spatial";

// Source code on the board: monospace block typed out character by character
// (pausable), one row per line. Each line carries data-part="L<n>" and
// registers in the spatial index as `${codeId}:L<n>` so marks and student
// selections can point at exact lines. Code never goes through MathJax.
export function CodeWriteOn({
  code,
  codeId,
  itemKey,
  instant = false,
}: {
  code: string;
  codeId: string;
  itemKey?: string;
  instant?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || host.dataset.started) return;
    host.dataset.started = "1";
    (async () => {
      try {
        const lines = code.replace(/\n+$/, "").split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const row = document.createElement("div");
          row.className = "code-line";
          row.setAttribute("data-part", `L${i}`);
          host.appendChild(row);
          register({
            id: `${codeId}:L${i}`,
            kind: "codeline",
            itemKey: itemKey ?? codeId,
            el: row,
            text: line,
          });
          if (instant) {
            row.textContent = line || " ";
            continue;
          }
          // Type it out; keep at least a space so empty lines hold height.
          row.textContent = " ";
          for (let c = 0; c < line.length; c += 2) {
            while (performer.paused()) await new Promise((r) => setTimeout(r, 150));
            row.textContent = line.slice(0, c + 2);
            await new Promise((r) => setTimeout(r, 16));
          }
          if (!line.length) await new Promise((r) => setTimeout(r, 60));
        }
      } finally {
        if (!instant && itemKey) signalDone(itemKey);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={hostRef}
      data-eq-id={codeId}
      className="code-board mono overflow-x-auto rounded-[3px] border border-line bg-paper-2 px-4 py-3 text-[13px] leading-[1.5] text-ink"
    />
  );
}
