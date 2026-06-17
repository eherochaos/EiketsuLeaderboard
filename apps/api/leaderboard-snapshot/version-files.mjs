import { resolve } from "node:path";

export const VERSION_MANIFEST_SCHEMA_VERSION = 1;

export function versionSlug(targetVersion) {
  const value = String(targetVersion || "").trim();
  if (!value) return "";
  return value.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export function versionArtifactPath(versionOutputDir, targetVersion, fileName) {
  const slug = versionSlug(targetVersion);
  if (!slug) {
    throw new Error("target version is required");
  }
  return resolve(versionOutputDir, slug, fileName);
}

export function versionEntry(manifest, targetVersion) {
  const requested = String(targetVersion || "").trim();
  const versions = Array.isArray(manifest?.versions) ? manifest.versions : [];
  if (requested) {
    return versions.find((item) => item.targetVersion === requested) || null;
  }
  const current = String(manifest?.currentTargetVersion || "").trim();
  return versions.find((item) => item.targetVersion === current) || versions[0] || null;
}
