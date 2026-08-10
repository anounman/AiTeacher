import type { InkStroke } from "@/components/teach/InkLayer";

// Rasterize the student's pen strokes to a PNG the parse slot's vision model
// can read (Phase 4.1). Ink only, on white — the question context travels as
// text, so the vision call has exactly one job: read the handwriting.

export interface InkCapture {
  dataUrl: string;
  /** World-space bounding box of the captured strokes. */
  box: { x: number; y: number; w: number; h: number };
}

export function captureInk(strokes: InkStroke[]): InkCapture | null {
  const points = strokes.flatMap((s) => s.points);
  if (points.length < 2) return null;
  const pad = 16;
  const minX = Math.min(...points.map((p) => p.x)) - pad;
  const minY = Math.min(...points.map((p) => p.y)) - pad;
  const maxX = Math.max(...points.map((p) => p.x)) + pad;
  const maxY = Math.max(...points.map((p) => p.y)) + pad;
  const w = maxX - minX;
  const h = maxY - minY;
  // Render at up to 2x so thin pencil strokes survive; cap the bitmap so a
  // stray stroke across the whole board can't allocate a huge canvas.
  const scale = Math.min(2, 1600 / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#111111";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    const avgP = stroke.points.reduce((a, p) => a + p.p, 0) / stroke.points.length;
    ctx.lineWidth = Math.max(2, (1.6 + avgP * 2.2) * scale);
    ctx.beginPath();
    stroke.points.forEach((p, i) => {
      const x = (p.x - minX) * scale;
      const y = (p.y - minY) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  return { dataUrl: canvas.toDataURL("image/png"), box: { x: minX, y: minY, w, h } };
}
