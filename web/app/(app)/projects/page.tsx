"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Material, Project } from "@/lib/db/schema";

// Concept-graph read shape from GET /api/concepts (SP1). SP2's graph page and
// SP4's mastery layer will extend this; SP1 only carries concepts, edges, and
// per-material extraction status.
type ConceptReport = {
  concepts: { id: string; label: string; slug: string; description: string | null; sourceCount: number }[];
  edges: { source: string; target: string; relation: string; confidence: string; score: number | null }[];
  materials: {
    materialId: string;
    title: string;
    status: "pending" | "extracting" | "ready" | "error";
    conceptCount: number;
    error: string | null;
  }[];
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [conceptsReport, setConceptsReport] = useState<ConceptReport | null>(null);
  const [building, setBuilding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    if (res.ok) setProjects(await res.json());
  }, []);

  const loadMaterials = useCallback(async (id: string) => {
    const res = await fetch(`/api/projects/${id}`);
    if (res.ok) {
      const d: { project: Project; materials: Material[] } = await res.json();
      setMaterials(d.materials);
    }
  }, []);

  const loadConcepts = useCallback(async (id: string) => {
    const res = await fetch(`/api/concepts?projectId=${encodeURIComponent(id)}`);
    if (res.ok) setConceptsReport(await res.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProjects();
  }, [loadProjects]);

  // Select first project once projects load (if none selected).
  useEffect(() => {
    if (!selectedId && projects.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(projects[0].id);
    }
    if (selectedId && !projects.some((p) => p.id === selectedId)) {
      // Selected project got deleted — fall back to first or none.
      setSelectedId(projects[0]?.id ?? null);
      setMaterials([]);
    }
  }, [projects, selectedId]);

  // Load materials when selection changes.
  useEffect(() => {
    if (!selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMaterials([]);
      setConceptsReport(null);
      return;
    }
    loadMaterials(selectedId);
    loadConcepts(selectedId);
  }, [selectedId, loadMaterials, loadConcepts]);

  // Poll while any material is still processing.
  useEffect(() => {
    const anyProcessing = materials.some((m) => m.status === "processing");
    if (!selectedId || !anyProcessing) return;
    const t = setInterval(() => {
      loadMaterials(selectedId);
    }, 1000);
    return () => clearInterval(t);
  }, [selectedId, materials, loadMaterials]);

  // Poll while any material's concept extraction is in flight. The POST to
  // /api/concepts/extract runs server-side and may take a while for a large
  // project; this lets the per-material chip show live "extracting…" → "N
  // concepts" progress while it runs.
  useEffect(() => {
    const anyExtracting = (conceptsReport?.materials ?? []).some((m) => m.status === "extracting");
    if (!selectedId || !anyExtracting) return;
    const t = setInterval(() => {
      loadConcepts(selectedId);
    }, 1000);
    return () => clearInterval(t);
  }, [selectedId, conceptsReport, loadConcepts]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const p: Project = await res.json();
      setNewProjectName("");
      await loadProjects();
      setSelectedId(p.id);
    }
  }

  async function renameProject(id: string) {
    const name = renameValue.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setRenamingId(null);
    await loadProjects();
  }

  async function deleteProject(id: string) {
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    setConfirmDeleteId(null);
    if (selectedId === id) {
      setSelectedId(null);
      setMaterials([]);
    }
    await loadProjects();
  }

  // Upload a single supported file. `title` (may be "") overrides the shared addTitle
  // field — used so multi-file uploads name each material after its filename
  // instead of stamping the same title on every file. Returns null on success
  // or an error message on failure (caller aggregates per-file results).
  async function addFile(file: File, title: string): Promise<string | null> {
    if (!selectedId) return null;
    const form = new FormData();
    form.append("projectId", selectedId);
    form.append("file", file);
    const t = title.trim();
    if (t) form.append("title", t);
    const res = await fetch("/api/materials", { method: "POST", body: form });
    if (res.ok) return null;
    const err = await res.text();
    return err || "File upload failed";
  }

  // Upload one or more files sequentially. Sequential (not parallel) so we
  // don't fan out concurrent embedding batches onto Ollama mid-ingest, and so
  // each material appears in the list as soon as it's ready. Progress is shown
  // per file; per-file failures are aggregated into a single status message.
  async function addFiles(files: FileList | File[]) {
    if (!selectedId) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    const errors: string[] = [];
    for (let i = 0; i < list.length; i++) {
      // A single-file upload honors the shared title field; a multi-file
      // upload leaves each to fall back to its filename (cleaner than naming
      // them all the same).
      const title = list.length === 1 ? addTitle : "";
      setStatusMsg(`Indexing file ${i + 1}/${list.length}…`);
      const err = await addFile(list[i], title);
      if (err) errors.push(`${list[i].name}: ${err}`);
      await loadMaterials(selectedId);
    }
    setStatusMsg(null);
    setAddTitle("");
    if (errors.length) {
      setStatusMsg(
        errors.length === list.length
          ? `All ${list.length} uploads failed — ${errors[0]}`
          : `${list.length - errors.length}/${list.length} uploaded; ${errors.length} failed`,
      );
    }
  }

  async function submitUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !addUrl.trim()) return;
    setStatusMsg("Adding URL…");
    const res = await fetch("/api/materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: selectedId,
        url: addUrl.trim(),
        title: addTitle.trim() || undefined,
      }),
    });
    setStatusMsg(null);
    if (res.ok) {
      setAddUrl("");
      setAddTitle("");
      await loadMaterials(selectedId);
    } else {
      const err = await res.text();
      setStatusMsg(err || "URL add failed");
    }
  }

  async function deleteMaterial(id: string) {
    await fetch(`/api/materials/${id}`, { method: "DELETE" });
    if (selectedId) await loadMaterials(selectedId);
  }

  // Build (or refresh) the concept graph for the selected project. The POST
  // preflights the chat model and runs extraction server-side; it resolves
  // only once every ready material is processed, so we surface the summary
  // (processed / concepts / edges / skipped / chunk errors) in the status line.
  async function buildGraph() {
    if (!selectedId) return;
    setBuilding(true);
    setStatusMsg("Building concept graph…");
    // Refresh once up front so the poll effect can observe the per-material
    // "extracting" state the server sets while the POST runs.
    void loadConcepts(selectedId);
    try {
      const res = await fetch("/api/concepts/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedId }),
      });
      if (res.ok) {
        const r: { processed: number; concepts: number; edges: number; skipped: number; errors: string[] } =
          await res.json();
        const parts = [
          `processed ${r.processed}`,
          `${r.concepts} concepts`,
          `${r.edges} edges`,
        ];
        if (r.skipped) parts.push(`skipped ${r.skipped}`);
        if (r.errors.length) parts.push(`${r.errors.length} chunk error(s)`);
        setStatusMsg(parts.join(" · "));
      } else {
        const err = await res.text();
        setStatusMsg(err || "Build failed");
      }
    } finally {
      setBuilding(false);
      if (selectedId) await loadConcepts(selectedId);
    }
  }

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  // Concept-graph derived state for the selected project. extById is hoisted
  // once per render so each material row can look up its extraction status
  // without a per-row DB hit or a map rebuild.
  const readyMaterialCount = materials.filter((m) => m.status === "ready").length;
  const conceptCount = conceptsReport?.concepts.length ?? 0;
  const edgeCount = conceptsReport?.edges.length ?? 0;
  const extById = new Map((conceptsReport?.materials ?? []).map((r) => [r.materialId, r]));
  const renderConceptChip = (materialId: string) => {
    const ext = extById.get(materialId);
    if (!ext || ext.status === "pending") return null;
    if (ext.status === "extracting")
      return <span className="mono text-[10px] text-feynman">extracting…</span>;
    if (ext.status === "error")
      return (
        <span className="mono max-w-[140px] truncate text-[10px] text-rule" title={ext.error ?? ""}>
          extraction failed
        </span>
      );
    return (
      <span className="mono text-[10px] text-ink-2">
        {ext.conceptCount} concept{ext.conceptCount === 1 ? "" : "s"}
      </span>
    );
  };

  return (
    <div className="graph-paper page-scroll">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/"
            className="mono text-[12px] tracking-wide text-ink-3 transition-colors hover:text-ink"
          >
            ← Back to chat
          </Link>
          <span className="mono flex items-center gap-2 text-[13px] font-medium tracking-wide text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-rule" />
            Projects
          </span>
        </div>

        <h1 className="mb-6 text-[1.6rem] leading-tight text-ink">
          Projects &amp; materials
        </h1>

        <div className="grid gap-6 md:grid-cols-[260px_1fr]">
          {/* Left column: project list */}
          <section className="rounded-[3px] border border-line bg-paper-2 p-4">
            <form onSubmit={createProject} className="mb-3 flex gap-2">
              <input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="new project name"
                className="mono w-full rounded-[3px] border border-line bg-paper px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-ink/40"
              />
              <button
                type="submit"
                className="mono shrink-0 rounded-[3px] border border-line bg-paper px-2 py-1.5 text-[12px] tracking-wide text-ink transition-colors hover:border-ink/40"
              >
                +
              </button>
            </form>

            <ul className="flex flex-col gap-1">
              {projects.length === 0 && (
                <li className="mono px-1 py-3 text-[11px] text-ink-3">
                  no projects yet
                </li>
              )}
              {projects.map((p) => {
                const active = p.id === selectedId;
                const renaming = p.id === renamingId;
                const confirming = p.id === confirmDeleteId;
                return (
                  <li key={p.id} className="group">
                    {renaming ? (
                      <div className="flex gap-1">
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => renameProject(p.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") renameProject(p.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          className="mono w-full rounded-[3px] border border-line bg-paper px-2 py-1 text-[12px] text-ink outline-none focus:border-ink/40"
                        />
                      </div>
                    ) : confirming ? (
                      <div className="flex items-center gap-2 rounded-[3px] bg-paper px-2 py-1.5">
                        <span className="mono flex-1 truncate text-[11px] text-rule">
                          delete?
                        </span>
                        <button
                          onClick={() => deleteProject(p.id)}
                          className="mono text-[11px] text-rule hover:underline"
                        >
                          yes
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="mono text-[11px] text-ink-3 hover:underline"
                        >
                          no
                        </button>
                      </div>
                    ) : (
                      <div
                        className={`flex items-center gap-1.5 rounded-[3px] px-2 py-1.5 transition-colors ${
                          active ? "bg-paper" : "hover:bg-paper/60"
                        }`}
                      >
                        <button
                          onClick={() => setSelectedId(p.id)}
                          className="flex-1 truncate text-left text-[13px] text-ink"
                        >
                          {p.name}
                        </button>
                        <button
                          onClick={() => {
                            setRenamingId(p.id);
                            setRenameValue(p.name);
                          }}
                          aria-label="Rename project"
                          className="mono text-[11px] text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(p.id)}
                          aria-label="Delete project"
                          className="mono text-[11px] text-ink-3 opacity-0 transition-opacity hover:text-rule group-hover:opacity-100"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Right column: materials manager */}
          <section className="rounded-[3px] border border-line bg-paper-2 p-4">
            {!selected ? (
              <p className="mono py-10 text-center text-[12px] text-ink-3">
                select a project to manage its materials
              </p>
            ) : (
              <>
                <div className="mb-4 flex items-baseline justify-between">
                  <h2 className="text-[18px] text-ink">{selected.name}</h2>
                  <span className="mono text-[11px] tracking-wide text-ink-3">
                    {materials.length} material{materials.length === 1 ? "" : "s"}
                  </span>
                </div>

                {/* Build concept graph (SP1). Disabled while building or when
                    no material is ready to extract from. The chip shows the
                    current concept/edge totals once a graph exists. */}
                <div className="mb-5 flex items-center gap-3 border-b border-line pb-4">
                  <button
                    onClick={buildGraph}
                    disabled={building || readyMaterialCount === 0}
                    className="mono rounded-[3px] border border-line bg-paper px-3 py-1.5 text-[12px] tracking-wide text-ink transition-colors hover:border-ink/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line"
                  >
                    {building ? "building…" : "build concept graph"}
                  </button>
                  {(conceptCount > 0 || edgeCount > 0) && (
                    <span className="mono text-[11px] text-ink-3">
                      {conceptCount} concepts · {edgeCount} edges
                    </span>
                  )}
                </div>

                {/* Add material */}
                <div className="mb-5 flex flex-col gap-2 border-b border-line pb-4">
                  <label className="mono text-[11px] tracking-wide text-ink-3">
                    title (optional)
                  </label>
                  <input
                    value={addTitle}
                    onChange={(e) => setAddTitle(e.target.value)}
                    placeholder="material title"
                    className="mono w-full rounded-[3px] border border-line bg-paper px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-ink/40"
                  />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="mono rounded-[3px] border border-line bg-paper px-3 py-1.5 text-[12px] tracking-wide text-ink transition-colors hover:border-ink/40"
                    >
                      + upload files
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.java,.c,.cc,.cpp,.h,.hpp,.go,.rs,.sql,text/*,application/pdf"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = e.target.files;
                        if (files && files.length > 0) addFiles(files);
                        e.target.value = "";
                      }}
                    />
                    <form onSubmit={submitUrl} className="flex flex-1 gap-2">
                      <input
                        value={addUrl}
                        onChange={(e) => setAddUrl(e.target.value)}
                        placeholder="https://example.com/article"
                        className="mono w-full rounded-[3px] border border-line bg-paper px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-ink/40"
                      />
                      <button
                        type="submit"
                        className="mono shrink-0 rounded-[3px] border border-line bg-paper px-3 py-1.5 text-[12px] tracking-wide text-ink transition-colors hover:border-ink/40"
                      >
                        add URL
                      </button>
                    </form>
                  </div>
                  {statusMsg && (
                    <p className="mono text-[11px] text-ink-3">{statusMsg}</p>
                  )}
                </div>

                {/* Materials list */}
                <ul className="flex flex-col gap-2">
                  {materials.length === 0 && (
                    <li className="mono py-6 text-center text-[11px] text-ink-3">
                      no materials yet
                    </li>
                  )}
                  {materials.map((m) => (
                    <li
                      key={m.id}
                      className="group flex items-center gap-3 rounded-[3px] border border-line bg-paper px-3 py-2"
                    >
                      <span className="mono rounded-[2px] border border-line bg-paper-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
                        {m.source_type}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] text-ink">
                          {m.title}
                        </div>
                        <div className="mono truncate text-[10px] text-ink-3">
                          {m.source_ref}
                        </div>
                      </div>
                      <span
                        className={`mono text-[10px] tracking-wide ${
                          m.status === "ready"
                            ? "text-ink-2"
                            : m.status === "processing"
                              ? "text-feynman"
                              : "text-rule"
                        }`}
                      >
                        {m.status}
                      </span>
                      <span className="mono text-[10px] text-ink-3">
                        {m.char_count.toLocaleString()} chars
                      </span>
                      {renderConceptChip(m.id)}
                      {m.status === "error" && m.error && (
                        <span
                          className="mono max-w-[180px] truncate text-[10px] text-rule"
                          title={m.error}
                        >
                          {m.error}
                        </span>
                      )}
                      <button
                        onClick={() => deleteMaterial(m.id)}
                        aria-label="Delete material"
                        className="mono text-[12px] text-ink-3 opacity-0 transition-opacity hover:text-rule group-hover:opacity-100"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
