import assert from "node:assert/strict";
import test from "node:test";
import { loadEvidencePreview } from "./evidence-preview";

test("revokes a preview URL created after its consumer is cancelled", async () => {
  let active = true;
  let resolveResponse: ((response: { ok: boolean; blob: () => Promise<Blob> }) => void) | undefined;
  const response = new Promise<{ ok: boolean; blob: () => Promise<Blob> }>((resolve) => {
    resolveResponse = resolve;
  });
  const revoked: string[] = [];

  const preview = loadEvidencePreview("/evidence", {
    fetchPreview: async () => response,
    createObjectURL: () => "blob:late-preview",
    revokeObjectURL: (url) => revoked.push(url),
    isActive: () => active,
  }, () => assert.fail("cancelled previews must not be retained"));
  active = false;
  resolveResponse?.({ ok: true, blob: async () => new Blob(["image"]) });

  assert.equal(await preview, false);
  assert.deepEqual(revoked, ["blob:late-preview"]);
});
