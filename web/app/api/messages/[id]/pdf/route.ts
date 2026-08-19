import puppeteer, { type Browser } from "puppeteer";
import { getMessage, getConversation } from "@/lib/db";
import { normalizeLabel } from "@/lib/concepts/slug";
import { withRouteHandler } from "@/lib/server/withRouteHandler";

// GET /api/messages/[id]/pdf — renders the existing /print/[id] page in a
// headless Chromium and returns the bytes as a real .pdf file
// (Content-Disposition: attachment). This replaces the old "open /print/[id]
// in a new tab, click save as PDF" dance: the chat's "download PDF" button
// hits this route and the browser downloads a .pdf directly.
//
// Fidelity: we don't reimplement markdown→PDF. Chromium loads the SAME
// /print/[id] page the user would (same Markdown pipeline, same @page A4 CSS
// + page numbers in globals.css), waits for its data-print-ready marker, and
// calls page.pdf() with preferCSSPageSize so the existing @page rule owns the
// layout. So the PDF is WYSIWYG with the chat card + print preview.
//
// Performance: one Browser is kept alive for the process (cached on
// globalThis to survive Next dev HMR), mirroring the tesseract worker pattern
// in /api/parse-image. We open a fresh Page per request and close it in
// finally. First request cold-starts Chromium (puppeteer downloads it to
// ~/.cache/puppeteer on install); subsequent requests reuse the browser.
// A single shared browser serializes PDF renders — fine for a single-user
// local app. The handler is async on a Node worker, so it doesn't block other
// requests.

const globalForPdf = globalThis as unknown as { __pdfBrowser?: Promise<Browser> };

function getBrowser(): Promise<Browser> {
  if (!globalForPdf.__pdfBrowser) {
    globalForPdf.__pdfBrowser = puppeteer.launch({ headless: true });
  }
  return globalForPdf.__pdfBrowser;
}

export const GET = withRouteHandler<{ id: string }>(async ({ request, params }) => {
  const { id } = params;
  const msg = getMessage(id);
  if (!msg) return new Response("Not found", { status: 404 });
  const conv = getConversation(msg.conversation_id);

  // Origin comes from the incoming request (http://localhost:3000 in dev, the
  // real host under `next start`) — never hardcoded, never user-supplied.
  const origin = new URL(request.url).origin;
  const slug = normalizeLabel(conv?.title ?? "") || "document";

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.goto(`${origin}/print/${id}`, { waitUntil: "networkidle0" });
    // The print page sets <html data-print-ready="1"> once the doc is mounted
    // (after a rAF, so async Shiki/Mermaid have committed). Wait on it rather
    // than guessing; fall through at timeout so a transient miss still yields
    // a PDF rather than a 502.
    try {
      await page.waitForSelector("html[data-print-ready='1']", { timeout: 15000 });
    } catch {
      // readiness marker never appeared — proceed with whatever rendered
    }
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    // Copy into a fresh ArrayBuffer-backed Uint8Array — puppeteer's Buffer
    // carries ArrayBufferLike (possibly SharedArrayBuffer) which the Blob
    // constructor's TS type rejects; a plain ArrayBuffer copy satisfies it.
    const bytes = new Uint8Array(pdf.byteLength);
    bytes.set(pdf);
    return new Response(new Blob([bytes], { type: "application/pdf" }), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${slug}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "PDF rendering failed";
    return new Response(message, { status: 502 });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});