"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/Skeleton";

interface SlotState {
  slot: string;
  model: string;
  defaultModel: string;
  saved: string;
  pinnedByEnv: boolean;
}

interface McpServer {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
}

interface Config {
  provider: string;
  model: string;
  baseURL: string;
  apiKey: string;
  tavilyApiKey: string;
  openaiApiKey: string;
  totalTokens: number;
  slots: SlotState[];
  learnerProfile: string;
  mcpServers: McpServer[];
}

// What each capability actually does, so the picker reads as a job rather than
// a jargon key. Order matches how a turn flows.
const SLOT_HELP: Record<string, string> = {
  reason: "Writes the lesson and the chat replies. The one that matters most.",
  visual: "Directs lesson diagrams. Never blocks speech — a slow pick just means no scene.",
  dispatch: "Turns an intent into an exact tool call. Only runs when tools are needed.",
  parse: "Reads PDF pages at upload time. Must be able to see images.",
  read: "Reads the student's pen strokes on the whiteboard. Must be a vision model.",
  embed: "Builds retrieval vectors. Changing this invalidates existing embeddings.",
};

const SECTIONS = [
  { id: "connection", label: "Connection" },
  { id: "models", label: "Capability models" },
  { id: "learner", label: "Learner profile" },
  { id: "connections", label: "Connected apps" },
  { id: "keys", label: "API keys" },
] as const;

const CONSCIOUS_PRESET: Omit<McpServer, "id"> = {
  name: "conscious",
  transport: "stdio",
  command: "node",
  args: ["/Users/anounman/Code/Conscious/daemon/mcp-server.mjs"],
  enabled: true,
};

export default function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [tavilyApiKey, setTavilyApiKey] = useState("");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<Record<string, string>>({});
  const [available, setAvailable] = useState<string[]>([]);
  const [learnerProfile, setLearnerProfile] = useState("");
  const [mcpServers, setMcp] = useState<McpServer[]>([]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((c: Config) => {
        setConfig(c);
        setModel(c.model);
        setBaseUrl(c.baseURL);
        setApiKey(c.apiKey || "");
        setTavilyApiKey(c.tavilyApiKey || "");
        setOpenaiApiKey(c.openaiApiKey || "");
        setSlots(Object.fromEntries((c.slots ?? []).map((s) => [s.slot, s.saved])));
        setLearnerProfile(c.learnerProfile ?? "");
        setMcp(c.mcpServers ?? []);
      })
      .catch(() => setError("Could not load settings."));
    // The chat picker hides embedding models; slots need the full list, since
    // `embed` can only be an embedding model.
    fetch("/api/models?all=1")
      .then((r) => r.json())
      .then((d: { models?: { id: string }[] }) => setAvailable((d.models ?? []).map((m) => m.id)))
      .catch(() => setAvailable([]));
  }, []);

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setSaved(false);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "ollama",
        model,
        baseUrl,
        apiKey,
        tavilyApiKey,
        openaiApiKey,
        slots,
        learnerProfile,
        mcpServers,
      }),
    });
    if (res.ok) {
      setSaved(true);
      const next: Config = await res.json();
      setConfig(next);
      setSlots(Object.fromEntries((next.slots ?? []).map((s) => [s.slot, s.saved])));
      setLearnerProfile(next.learnerProfile ?? "");
      setMcp(next.mcpServers ?? []);
      setTimeout(() => setSaved(false), 2500);
    } else {
      setError("Save failed.");
    }
  }

  if (!config) {
    return (
      <div className="graph-paper page-scroll">
        <div className="mx-auto max-w-3xl px-6 py-14">
          <p className="mono mb-2 text-[11px] tracking-[0.2em] text-rule">SETTINGS</p>
          <Skeleton className="h-7 w-64" />
          <div className="mt-9 flex flex-col gap-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="graph-paper page-scroll">
      <div className="mx-auto flex max-w-5xl gap-10 px-6 py-14">
        {/* Section rail */}
        <nav className="settings-rail mono" aria-label="Settings sections">
          <p className="mb-3 text-[11px] tracking-[0.2em] text-rule">SETTINGS</p>
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="settings-rail-link">
              {s.label}
            </a>
          ))}
          <div className="mt-6 border-t border-line pt-4">
            <p className="text-[10px] tracking-[0.14em] text-ink-3">TOTAL TOKENS</p>
            <p className="mt-1 text-[14px] text-ink">{config.totalTokens.toLocaleString()}</p>
          </div>
          <Link href="/" className="mt-6 block text-[12px] text-ink-3 hover:text-ink">
            ← back to chat
          </Link>
        </nav>

        <form onSubmit={save} className="min-w-0 flex-1">
          <h1 className="text-[1.6rem] leading-tight text-ink">Configuration</h1>
          <p className="mt-2 max-w-lg text-[15px] text-ink-2">
            Models, memory, and connected apps. Changes apply to new turns.
          </p>

          {/* Connection */}
          <section id="connection" className="settings-card page-card">
            <h2 className="settings-card-title">Connection</h2>
            <div className="settings-grid">
              <Field label="Provider" hint="More providers arrive in later phases.">
                <select value="ollama" disabled className="settings-input mono">
                  <option value="ollama">Ollama (local / cloud)</option>
                </select>
              </Field>
              <Field label="Base URL" hint="OpenAI-compatible endpoint.">
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434/v1"
                  className="settings-input mono"
                />
              </Field>
              <Field label="Chat model" hint="The header picker's default for chat mode.">
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="settings-input mono"
                />
              </Field>
              <SecretField label="API key" value={apiKey} onChange={setApiKey} placeholder="(none — local mode)" />
            </div>
          </section>

          {/* Capability models */}
          <section id="models" className="settings-card page-card">
            <h2 className="settings-card-title">Capability models</h2>
            <p className="settings-card-lede">
              Each job runs on its own model. <span className="text-ink-2">default</span> uses the
              checked-in pick from config/models.json.
            </p>
            <div className="settings-grid">
              {(config.slots ?? []).map((s) => (
                <label key={s.slot} className="flex min-w-0 flex-col gap-1.5">
                  <span className="mono text-[12px] tracking-wide text-ink-2">
                    {s.slot}
                    {s.pinnedByEnv && <span className="ml-2 text-[11px] text-rule">pinned by env</span>}
                  </span>
                  <select
                    value={slots[s.slot] ?? ""}
                    disabled={s.pinnedByEnv}
                    onChange={(e) => setSlots((prev) => ({ ...prev, [s.slot]: e.target.value }))}
                    className="settings-input mono"
                  >
                    <option value="">default — {s.defaultModel}</option>
                    {available.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                    {slots[s.slot] && !available.includes(slots[s.slot]!) && (
                      <option value={slots[s.slot]}>{slots[s.slot]} (not installed)</option>
                    )}
                  </select>
                  <span className="mono text-[11px] leading-relaxed text-ink-3">
                    {SLOT_HELP[s.slot]} Now: <span className="text-ink-2">{s.model}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          {/* Learner profile */}
          <section id="learner" className="settings-card page-card">
            <h2 className="settings-card-title">Learner profile</h2>
            <p className="settings-card-lede">
              What the tutor has learned about how you study — updated automatically after each
              exchange, injected into every lesson. Edit freely.
            </p>
            <textarea
              value={learnerProfile}
              onChange={(e) => setLearnerProfile(e.target.value)}
              placeholder="(empty — the tutor starts learning your style from the next conversation)"
              rows={5}
              spellCheck={false}
              className="settings-input mono w-full resize-y leading-relaxed"
            />
            {learnerProfile && (
              <button
                type="button"
                onClick={() => setLearnerProfile("")}
                className="mono mt-2 self-start text-[11px] tracking-wide text-ink-3 hover:text-rule"
              >
                forget everything
              </button>
            )}
          </section>

          {/* MCP connections */}
          <section id="connections" className="settings-card page-card">
            <h2 className="settings-card-title">Connected apps (MCP)</h2>
            <p className="settings-card-lede">
              The tutor can call tools from your other apps over the Model Context Protocol —
              e.g. Conscious, so lessons can search what was actually on your screen. Local
              commands run with this app&apos;s permissions; add only servers you trust.
            </p>

            {mcpServers.length === 0 && (
              <p className="mono mb-4 text-[12px] text-ink-3">No connections yet.</p>
            )}
            <div className="flex flex-col gap-3">
              {mcpServers.map((s, i) => (
                <div key={s.id} className="mcp-row">
                  <label className="mcp-toggle" title={s.enabled ? "Enabled" : "Disabled"}>
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={(e) =>
                        setMcp((list) =>
                          list.map((x, xi) => (xi === i ? { ...x, enabled: e.target.checked } : x)),
                        )
                      }
                    />
                    <span />
                  </label>
                  <div className="min-w-0 flex-1">
                    <p className="mono text-[13px] text-ink">
                      {s.name}
                      <span className="mcp-badge">{s.transport}</span>
                    </p>
                    <p className="mono truncate text-[11px] text-ink-3">
                      {s.transport === "stdio" ? `${s.command ?? ""} ${(s.args ?? []).join(" ")}` : s.url}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMcp((list) => list.filter((_, xi) => xi !== i))}
                    className="mono text-[11px] text-ink-3 hover:text-rule"
                  >
                    remove
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {!mcpServers.some((s) => s.name === "conscious") && (
                <button
                  type="button"
                  className="chip"
                  onClick={() =>
                    setMcp((list) => [...list, { ...CONSCIOUS_PRESET, id: `mcp-${Date.now()}` }])
                  }
                >
                  + Connect Conscious
                </button>
              )}
              <AddMcpForm onAdd={(s) => setMcp((list) => [...list, s])} />
            </div>
          </section>

          {/* Keys */}
          <section id="keys" className="settings-card page-card">
            <h2 className="settings-card-title">API keys</h2>
            <div className="settings-grid">
              <SecretField
                label="Tavily API key"
                value={tavilyApiKey}
                onChange={setTavilyApiKey}
                placeholder="(none — web search disabled)"
                hint="Enables web search."
              />
              <SecretField
                label="OpenAI API key"
                value={openaiApiKey}
                onChange={setOpenaiApiKey}
                placeholder="(none — voice uses the browser engine)"
                hint="Enables Whisper voice typing; never leaves this server."
              />
            </div>
          </section>

          <div className="settings-savebar">
            <button type="submit" className="btn-primary">
              Save changes
            </button>
            {saved && <span className="mono text-[12px] text-feynman">saved.</span>}
            {error && <span className="mono text-[12px] text-rule">{error}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}

function AddMcpForm({ onAdd }: { onAdd: (s: McpServer) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("http");
  const [target, setTarget] = useState("");

  if (!open) {
    return (
      <button type="button" className="chip" onClick={() => setOpen(true)}>
        + Add MCP server
      </button>
    );
  }
  return (
    <div className="mcp-add">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="name (e.g. notes)"
        className="settings-input mono w-36"
      />
      <select
        value={transport}
        onChange={(e) => setTransport(e.target.value as "stdio" | "http")}
        className="settings-input mono w-24"
      >
        <option value="http">http</option>
        <option value="stdio">stdio</option>
      </select>
      <input
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        placeholder={transport === "http" ? "https://host/mcp" : "command arg1 arg2"}
        className="settings-input mono min-w-0 flex-1"
      />
      <button
        type="button"
        className="btn-primary"
        onClick={() => {
          if (!name.trim() || !target.trim()) return;
          const parts = target.trim().split(/\s+/);
          onAdd({
            id: `mcp-${Date.now()}`,
            name: name.trim(),
            transport,
            ...(transport === "http"
              ? { url: target.trim() }
              : { command: parts[0]!, args: parts.slice(1) }),
            enabled: true,
          });
          setOpen(false);
          setName("");
          setTarget("");
        }}
      >
        Add
      </button>
      <button type="button" className="mono text-[11px] text-ink-3 hover:text-ink" onClick={() => setOpen(false)}>
        cancel
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="mono text-[12px] tracking-wide text-ink-2">{label}</span>
      {children}
      {hint && <span className="mono text-[11px] text-ink-3">{hint}</span>}
    </label>
  );
}

function SecretField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="settings-input mono min-w-0 flex-1"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="mono shrink-0 text-[11px] tracking-wide text-ink-3 hover:text-ink"
        >
          {show ? "hide" : "show"}
        </button>
      </div>
    </Field>
  );
}
