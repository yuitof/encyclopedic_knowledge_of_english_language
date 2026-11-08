import fs from "node:fs/promises";
import path from "node:path";

const filenameOrder = (a, b) =>
  a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }) ||
  a.name.localeCompare(b.name, "en") ||
  a.slug.localeCompare(b.slug, "en");
function time(value, fallback, field) {
  if (value === undefined)
    return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
  if (
    typeof value !== "string" ||
    !value.trim() ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error(`${field} must be a valid date string`);
  return Date.parse(value);
}
/** Compute locally; publish ordinal ranks, never exact filesystem dates or paths. */
export function createSortRanks(records) {
  const sorted = [...records].sort(filenameOrder),
    result = {};
  sorted.forEach((record, index) => {
    result[record.slug] = { name: index, modified: null, created: null };
  });
  for (const field of ["modified", "created"]) {
    const known = sorted
      .map((record) => ({
        record,
        value: time(
          record[field],
          field === "modified" ? record.mtimeMs : record.birthtimeMs,
          field,
        ),
      }))
      .filter((item) => item.value !== null)
      .sort((a, b) => a.value - b.value || filenameOrder(a.record, b.record));
    let rank = -1,
      previous;
    for (const { record, value } of known) {
      if (value !== previous) rank++;
      result[record.slug][field] = rank;
      previous = value;
    }
  }
  return result;
}
/** Minimal publication metadata for filename sections and inclusive UTC date filters. */
export function createSortDetails(records) {
  return Object.fromEntries(
    records.map((record) => {
      const initial = record.name
        .replace(/\.md$/iu, "")
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .charAt(0)
        .toUpperCase();
      const group = /^[A-Z]$/u.test(initial)
        ? initial
        : /^\p{L}/u.test(initial)
          ? "other"
          : "symbols";
      const day = (field) => {
        const value = time(
          record[field],
          field === "modified" ? record.mtimeMs : record.birthtimeMs,
          field,
        );
        return value === null
          ? null
          : new Date(value).toISOString().slice(0, 10);
      };
      return [
        record.slug,
        { group, modified: day("modified"), created: day("created") },
      ];
    }),
  );
}
export async function enrichSortRanks(output, publication) {
  const file = path.join(output, "static/contentIndex.json"),
    index = JSON.parse(await fs.readFile(file, "utf8"));
  for (const [slug, ranks] of Object.entries(publication.sortRanks ?? {}))
    if (Object.hasOwn(index, slug)) {
      index[slug].sortRanks = ranks;
      index[slug].sortDetails = publication.sortDetails[slug];
    }
  await fs.writeFile(file, JSON.stringify(index));
}
