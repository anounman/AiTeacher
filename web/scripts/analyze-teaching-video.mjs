#!/usr/bin/env node
// Teaching-style analyzer: point it at a lecture video and it produces a
// grounded report on HOW the teacher explains visually — board layout, color
// conventions, incremental drawing, worked examples — by sampling frames and
// reading them with the app's `read` (vision) slot via Ollama.
//
//   node scripts/analyze-teaching-video.mjs <youtube-url> [interval-seconds]
//
// Pipeline: yt-dlp (lowest mp4 that keeps text legible) → ffmpeg frame every
// N seconds → vision model describes each frame's board state → a final
// synthesis pass distills recurring teaching patterns. Output lands in
// scripts/out/<video-id>/report.md next to the frames, so claims can be
// checked against the exact frame they came from.

import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";
const VISION_MODEL = process.env.VISION_MODEL || "minimax-m3:cloud";
const SYNTH_MODEL = process.env.SYNTH_MODEL || "deepseek-v4-pro:cloud";

const url = process.argv[2];
const interval = Number(process.argv[3] || 25);
if (!url) {
  console.error("usage: node scripts/analyze-teaching-video.mjs <youtube-url> [interval-seconds]");
  process.exit(1);
}

const id = (url.match(/[?&]v=([\w-]{6,})/) || [, "video"])[1];
const outDir = join("scripts", "out", id);
mkdirSync(outDir, { recursive: true });

// 1. Download once (skip if present).
const video = join(outDir, "video.mp4");
try {
  readFileSync(video);
  console.log("video cached");
} catch {
  console.log("downloading…");
  execFileSync(
    "yt-dlp",
    ["-f", "worst[ext=mp4][height>=360]/worst[ext=mp4]", "-o", video, url],
    { stdio: "inherit" },
  );
}

// 2. Frames every N seconds.
if (!readdirSync(outDir).some((f) => f.startsWith("frame-"))) {
  console.log(`extracting a frame every ${interval}s…`);
  execSync(
    `ffmpeg -loglevel error -i "${video}" -vf "fps=1/${interval},scale=960:-1" "${join(outDir, "frame-%03d.png")}"`,
  );
}
const frames = readdirSync(outDir).filter((f) => f.startsWith("frame-")).sort();
console.log(`${frames.length} frames`);

async function ollama(model, messages) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    body: JSON.stringify({ model, messages, stream: false }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.message?.content ?? "";
}

// 3. Vision pass — one focused description per frame.
const notes = [];
for (const [i, frame] of frames.entries()) {
  const b64 = readFileSync(join(outDir, frame)).toString("base64");
  const t = i * interval;
  try {
    const note = await ollama(VISION_MODEL, [
      {
        role: "user",
        content:
          "This is one frame of a lecture video. Describe ONLY the teaching technique visible: " +
          "what is on the board (layout, diagrams, trees, tables), what colors are used for what, " +
          "what appears to have just been added versus already present, and any pointing/highlighting. " +
          "3-5 terse bullet lines. If the frame shows no board (talking head, title card), say SKIP.",
        images: [b64],
      },
    ]);
    if (!/^SKIP/m.test(note.trim())) notes.push(`[t≈${t}s] ${note.trim()}`);
    console.log(`${frame} ✓`);
  } catch (e) {
    console.log(`${frame} ✗ ${e.message}`);
  }
}
writeFileSync(join(outDir, "frame-notes.md"), notes.join("\n\n"));

// 4. Synthesis — distill the recurring technique, not the lesson content.
console.log("synthesizing…");
const report = await ollama(SYNTH_MODEL, [
  {
    role: "user",
    content:
      `Below are frame-by-frame observations of how a lecturer uses a board, sampled every ${interval}s.\n\n` +
      notes.join("\n\n") +
      "\n\nDistill the teacher's VISUAL TEACHING TECHNIQUE into a concrete, imitable spec:\n" +
      "1. Board layout habits (where things go, how space is used over time)\n" +
      "2. Color conventions (which color means what)\n" +
      "3. How diagrams grow (incremental order, what gets drawn before speech vs after)\n" +
      "4. How worked examples are structured (setup → trace → generalization?)\n" +
      "5. Emphasis techniques (circling, underlining, arrows, boxes)\n" +
      "6. Pacing signals visible on the board\n" +
      "Then a final section: 10 imperative rules an AI whiteboard tutor should follow to teach like this. " +
      "Ground every claim in the timestamps.",
  },
]);
writeFileSync(join(outDir, "report.md"), report);
console.log(`\nreport: ${join(outDir, "report.md")}`);
