import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { refreshOfficialCardData } from "./refresh-official-card-data.mjs";

async function withTempDir(callback) {
  const dir = await mkdtemp(join(tmpdir(), "eiketsu-official-card-data-"));
  try {
    await callback(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

async function testWritesFetchedPayload() {
  await withTempDir(async (dir) => {
    const outputPath = join(dir, "cards.json");
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ general: [{ id: "1" }] })
    });

    const result = await refreshOfficialCardData({ outputPath });
    const payload = JSON.parse(await readFile(outputPath, "utf8"));

    assert.equal(result.generalCount, 1);
    assert.equal(result.reusedExisting, false);
    assert.equal(result.usedEmptyFallback, false);
    assert.deepEqual(payload.general, [{ id: "1" }]);
  });
}

async function testKeepsExistingPayloadWhenOfficialFetchFails() {
  await withTempDir(async (dir) => {
    const outputPath = join(dir, "cards.json");
    await writeFile(outputPath, `${JSON.stringify({ general: [{ id: "old-1" }, { id: "old-2" }] })}\n`, "utf8");
    globalThis.fetch = async () => ({
      ok: false,
      status: 503
    });

    const result = await refreshOfficialCardData({ outputPath });
    const payload = JSON.parse(await readFile(outputPath, "utf8"));

    assert.equal(result.generalCount, 2);
    assert.equal(result.reusedExisting, true);
    assert.equal(result.usedEmptyFallback, false);
    assert.deepEqual(payload.general, [{ id: "old-1" }, { id: "old-2" }]);
  });
}

async function testWritesEmptyFallbackWhenOfficialFetchFailsWithoutExistingPayload() {
  await withTempDir(async (dir) => {
    const outputPath = join(dir, "cards.json");
    globalThis.fetch = async () => ({
      ok: false,
      status: 503
    });

    const result = await refreshOfficialCardData({ outputPath });
    const payload = JSON.parse(await readFile(outputPath, "utf8"));

    assert.equal(result.generalCount, 0);
    assert.equal(result.reusedExisting, false);
    assert.equal(result.usedEmptyFallback, true);
    assert.deepEqual(payload, {});
  });
}

const originalFetch = globalThis.fetch;
try {
  await testWritesFetchedPayload();
  await testKeepsExistingPayloadWhenOfficialFetchFails();
  await testWritesEmptyFallbackWhenOfficialFetchFailsWithoutExistingPayload();
} finally {
  globalThis.fetch = originalFetch;
}

console.log("official card data refresh tests passed");
