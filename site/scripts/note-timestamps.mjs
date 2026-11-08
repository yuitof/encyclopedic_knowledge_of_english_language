import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";

export function splitNote(text) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
  const meta = front ? (YAML.parse(front[1]) ?? {}) : {};
  if (typeof meta !== "object" || Array.isArray(meta))
    throw new Error("Frontmatter must be a mapping");
  return { front, meta, body: front ? text.slice(front[0].length) : text };
}
export function validTimestamp(value) {
  return (
    typeof value === "string" &&
    !!value.trim() &&
    Number.isFinite(Date.parse(value))
  );
}
export function addMissingTimestamps(text, dates) {
  const { front, meta } = splitNote(text);
  const missing = ["created", "modified"].filter(
    (field) => meta[field] === undefined,
  );
  for (const field of ["created", "modified"])
    if (meta[field] !== undefined && !validTimestamp(meta[field]))
      throw new Error(`${field} must be a valid date string`);
  if (!missing.length) return text;
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines =
    missing
      .map((field) => `${field}: ${JSON.stringify(dates[field])}`)
      .join(newline) + newline;
  if (!front) return `---${newline}${lines}---${newline}${text}`;
  const end = front[0].lastIndexOf("---");
  return text.slice(0, end) + lines + text.slice(end);
}
export function commitDates(root, source) {
  const result = spawnSync(
    "git",
    ["-C", root, "log", "--follow", "--format=%cI%x09%s", "--", source],
    { encoding: "utf8" },
  );
  const dates =
    result.status === 0
      ? result.stdout
          .trim()
          .split(/\r?\n/u)
          .filter((line) => !line.endsWith("\tRepair missing note timestamps"))
          .map((line) => line.split("\t")[0])
          .filter(validTimestamp)
      : [];
  return dates.length ? { created: dates.at(-1), modified: dates[0] } : null;
}
export async function noteDates(
  root,
  source,
  meta,
  { filesystemOnly = false, requireHistory = false } = {},
) {
  for (const field of ["created", "modified"])
    if (meta[field] !== undefined && !validTimestamp(meta[field]))
      throw new Error(`${field} must be a valid date string`);
  if (meta.created !== undefined && meta.modified !== undefined)
    return { created: meta.created, modified: meta.modified };
  const stat = await fs.stat(path.join(root, source));
  const history = filesystemOnly ? null : commitDates(root, source);
  if (requireHistory && !history)
    throw new Error(
      `No commit history for ${source}; full history is required`,
    );
  const fallback = {
    created:
      history?.created ??
      new Date(
        stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs,
      ).toISOString(),
    modified: history?.modified ?? stat.mtime.toISOString(),
  };
  return {
    created: meta.created ?? fallback.created,
    modified: meta.modified ?? fallback.modified,
  };
}
