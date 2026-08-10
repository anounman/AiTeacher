// Headless driver for the vendored calligrapher.ai handwriting engine
// (public/handwriting/engine.js). The engine is DOM-coupled to fixed element
// ids, so we build a hidden sandbox carrying those ids, load the script once,
// and per write: park the engine's <svg id="canvas"> inside the target board
// item (so the pen writes live on the board), set the inputs, fire
// draw-button, wait for the stroke stream to go idle, snapshot a clean sized
// clone, and return the engine svg to the sandbox for the next line.
//
// All writes go through one queue — the engine is a single global instance.

const ENGINE_SRC = "/handwriting/engine.js";
const DEFAULT_STYLE = 4; // fixed so the whole lesson is one "hand"

export interface WriteOpts {
  widthPx?: number; // engine canvas width — scale of the writing
  heightPx?: number;
  bias?: number; // legibility: higher = neater
  speed?: number; // sampled points per frame: higher = faster pen
}

let enginePromise: Promise<boolean> | null = null;
let sandbox: HTMLDivElement | null = null;

function buildSandbox(): HTMLDivElement {
  const box = document.createElement("div");
  box.id = "hw-sandbox";
  box.style.cssText = "position:absolute;left:-99999px;top:0;width:1000px;";
  const styleOptions = ['<option value="-">-</option>']
    .concat(Array.from({ length: 13 }, (_, i) => `<option value="${i}">${i}</option>`))
    .join("");
  box.innerHTML = `
    <svg id="canvas" xmlns="http://www.w3.org/2000/svg" width="860" height="140"></svg>
    <select id="select-style">${styleOptions}</select>
    <input id="bias-slider" value="0.9" />
    <input id="speed-slider" value="8" />
    <input id="width-slider" value="1" />
    <input id="text-input" value="" />
    <button id="draw-button"></button>
    <button id="save-button"></button>
    <div id="loading-indicator"></div>
  `;
  return box;
}

export function loadEngine(): Promise<boolean> {
  if (enginePromise) return enginePromise;
  enginePromise = new Promise<boolean>((resolve) => {
    if (typeof document === "undefined") return resolve(false);
    sandbox = buildSandbox();
    document.body.appendChild(sandbox);
    const script = document.createElement("script");
    script.src = ENGINE_SRC;
    script.onload = () => {
      // Engine removes #loading-indicator once the 2.6MB weights are parsed.
      const started = Date.now();
      const poll = setInterval(() => {
        if (!document.getElementById("loading-indicator")) {
          clearInterval(poll);
          resolve(true);
        } else if (Date.now() - started > 45_000) {
          clearInterval(poll);
          resolve(false);
        }
      }, 150);
    };
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
  return enginePromise;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`handwriting sandbox element #${id} missing`);
  return el as T;
}

// Resolve when the engine has produced at least one stroke and then gone
// quiet for `idleMs`. Recolors every incoming path to currentColor so writing
// is visible on both themes (engine hardcodes black).
function waitForIdle(svg: SVGSVGElement, idleMs: number, hardMs: number): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sawStroke = false;
    const hard = setTimeout(() => finish(), hardMs);
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (n instanceof SVGPathElement) {
            n.style.stroke = "currentColor";
            n.style.fill = "currentColor";
          }
        });
      }
      sawStroke = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => finish(), idleMs);
    });
    const finish = () => {
      obs.disconnect();
      clearTimeout(hard);
      if (timer) clearTimeout(timer);
      resolve();
    };
    obs.observe(svg, { childList: true });
    // If nothing ever arrives (empty/unsupported text) resolve on a short fuse.
    timer = setTimeout(() => (sawStroke ? finish() : finish()), 4000);
  });
}

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  // Keep the queue alive after failures; callers see their own rejection.
  queue = next.catch(() => {});
  return next;
}

const lineCache = new Map<string, Promise<SVGSVGElement>>();

const cacheKey = (text: string, opts: WriteOpts) =>
  [text, opts.widthPx ?? 860, opts.heightPx ?? 140, opts.bias ?? 0.9].join("|");

// Synthesize one line offscreen (engine at max speed) and return a
// tightly-viewBoxed svg template. Cached — the prefetch pass during lesson
// generation makes performance-time replays instant. Rejects only if the
// engine can't load or produced nothing.
export function synthesizeLine(text: string, opts: WriteOpts = {}): Promise<SVGSVGElement> {
  const key = cacheKey(text, opts);
  const hit = lineCache.get(key);
  if (hit) return hit;
  const p = enqueue(async () => {
    const ok = await loadEngine();
    if (!ok) throw new Error("handwriting engine unavailable");
    const svg = byId<HTMLElement>("canvas") as unknown as SVGSVGElement;
    svg.setAttribute("width", String(opts.widthPx ?? 860));
    svg.setAttribute("height", String(opts.heightPx ?? 140));
    byId<HTMLInputElement>("bias-slider").value = String(opts.bias ?? 0.9);
    // Synthesis speed, not writing speed: points-per-frame. Replay paces the
    // visible writing, so crank synthesis as fast as the engine allows.
    byId<HTMLInputElement>("speed-slider").value = String(opts.speed ?? 60);
    byId<HTMLInputElement>("width-slider").value = "1";
    byId<HTMLSelectElement>("select-style").value = String(DEFAULT_STYLE);
    byId<HTMLInputElement>("text-input").value = text;
    byId<HTMLButtonElement>("draw-button").dispatchEvent(
      new MouseEvent("mousedown", { bubbles: false }),
    );
    // Generous idle window: rAF throttling in background tabs stretches the
    // gap between engine frames well past normal frame time.
    await waitForIdle(svg, 1_200, 45_000);
    const bb = svg.getBBox(); // throws on empty — caught by caller
    if (!(bb.width > 0)) throw new Error("empty handwriting result");
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.removeAttribute("id");
    clone.setAttribute("viewBox", `${bb.x - 4} ${bb.y - 4} ${bb.width + 8} ${bb.height + 8}`);
    clone.setAttribute("width", "100%");
    clone.removeAttribute("height");
    clone.style.height = "auto";
    // NOTE: never clear the engine svg here — its rAF loop may still hold a
    // lastChild reference (crashes on removeChild); E() self-clears on the
    // next write.
    return clone;
  });
  lineCache.set(key, p);
  p.catch(() => lineCache.delete(key)); // allow retry after failure
  return p;
}

export function prefetchLine(text: string, opts: WriteOpts = {}): void {
  void synthesizeLine(text, opts).catch(() => {});
}

// Cache-only lookup — history renders use this so a reload never queues
// synthesis work ahead of a live lesson's prefetch.
export function getCachedLine(text: string, opts: WriteOpts = {}): Promise<SVGSVGElement> | null {
  return lineCache.get(cacheKey(text, opts)) ?? null;
}

// Replay a synthesized template into `host` with a writing cadence: pen
// segments (one path each) appear sequentially, duration proportional to
// stroke length. Pausable between segments via `paused`.
export async function replayInto(
  host: HTMLElement,
  template: SVGSVGElement,
  { paused, instant = false }: { paused?: () => boolean; instant?: boolean } = {},
): Promise<void> {
  const svg = template.cloneNode(true) as SVGSVGElement;
  const paths = Array.from(svg.querySelectorAll("path"));
  for (const p of paths) {
    p.style.stroke = "currentColor";
    p.style.fill = "currentColor";
    if (!instant) p.style.visibility = "hidden";
  }
  host.appendChild(svg);
  if (instant) return;
  for (const p of paths) {
    while (paused?.()) await new Promise((r) => setTimeout(r, 150));
    p.style.visibility = "";
    p.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 90, fill: "forwards" });
    let len = 0;
    try {
      len = p.getTotalLength();
    } catch {
      /* detached */
    }
    await new Promise((r) => setTimeout(r, Math.min(420, 50 + len / 14)));
  }
}
