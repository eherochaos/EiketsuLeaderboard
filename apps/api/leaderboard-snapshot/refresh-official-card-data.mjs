import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OFFICIAL_DATALIST_BASE_URL = "https://eiketsu-taisen.net/datalist/api/base";
const DEFAULT_OUTPUT_PATH = resolve("apps/api/data/legacy-service/cards/datalist_api_base.json");

async function fetchOfficialDatalistBase() {
  const response = await fetch(OFFICIAL_DATALIST_BASE_URL, {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`official datalist fetch failed: ${response.status}`);
  }

  return await response.json();
}

export async function refreshOfficialCardData(options = {}) {
  const outputPath = resolve(options.outputPath || process.argv[2] || DEFAULT_OUTPUT_PATH);
  let payload;
  try {
    payload = await fetchOfficialDatalistBase();
  } catch (error) {
    if (!(await fileExists(outputPath))) {
      throw error;
    }
    const generalCount = await readExistingGeneralCount(outputPath);
    console.warn(`officialCardDataRefresh=kept-existing reason="${String(error.message || error)}"`);
    return {
      outputPath,
      generalCount,
      reusedExisting: true
    };
  }
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  try {
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }

  return {
    outputPath,
    generalCount: Array.isArray(payload.general) ? payload.general.length : 0,
    reusedExisting: false
  };
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readExistingGeneralCount(path) {
  try {
    const payload = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(payload.general) ? payload.general.length : 0;
  } catch {
    return 0;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await refreshOfficialCardData();
  console.log(`officialCardData=${result.outputPath} cards=${result.generalCount}`);
}
