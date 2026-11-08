import { test } from "node:test";
import assert from "node:assert/strict";
import { createSortRanks } from "../scripts/sort-ranks.mjs";
const records = [
  { slug: "articles/b", name: "b.md", mtimeMs: 200, birthtimeMs: 400 },
  { slug: "articles/a", name: "a.md", mtimeMs: 200, birthtimeMs: 100 },
  { slug: "articles/c", name: "c.md", mtimeMs: 300, birthtimeMs: 0 },
  { slug: "articles/d", name: "d.md", mtimeMs: NaN, birthtimeMs: NaN },
];
const order = (ranks, mode) => {
  const [field, direction] = mode.split("-");
  return Object.keys(ranks)
    .sort((a, b) => {
      const x = ranks[a],
        y = ranks[b],
        av = x[field],
        bv = y[field];
      if (av === null && bv !== null) return 1;
      if (bv === null && av !== null) return -1;
      return (
        (av === null || bv === null ? 0 : av - bv) *
          (direction === "desc" ? -1 : 1) || x.name - y.name
      );
    })
    .map((slug) => slug.split("/")[1]);
};
test("six order modes keep filename ties deterministic and unknown dates last", () => {
  const ranks = createSortRanks(records);
  assert.deepEqual(order(ranks, "name-asc"), ["a", "b", "c", "d"]);
  assert.deepEqual(order(ranks, "name-desc"), ["d", "c", "b", "a"]);
  assert.deepEqual(order(ranks, "modified-desc"), ["c", "a", "b", "d"]);
  assert.deepEqual(order(ranks, "modified-asc"), ["a", "b", "c", "d"]);
  assert.deepEqual(order(ranks, "created-desc"), ["b", "a", "c", "d"]);
  assert.deepEqual(order(ranks, "created-asc"), ["a", "b", "c", "d"]);
  assert.equal(ranks["articles/c"].created, null);
  assert.doesNotMatch(
    JSON.stringify(ranks),
    /\.md|mtime|birthtime|1970|200|400/,
  );
});
test("explicit valid dates override filesystem ranking while invalid dates fail", () => {
  const ranks = createSortRanks([
    { ...records[0], modified: "2020-01-01", created: "2022-01-01" },
    { ...records[1], modified: "2021-01-01", created: "2019-01-01" },
  ]);
  assert.deepEqual(order(ranks, "modified-desc"), ["a", "b"]);
  assert.deepEqual(order(ranks, "created-desc"), ["b", "a"]);
  for (const value of ["unknown", 123, null, ""])
    assert.throws(
      () => createSortRanks([{ ...records[0], created: value }]),
      /valid date/,
    );
});
