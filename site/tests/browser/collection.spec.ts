import { test, expect } from "@playwright/test";

test("configured collection supports articles, search and graph without reference-corpus assumptions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  const base = (await page.locator("body").getAttribute("data-basepath")) ?? "";
  const entries = await page.evaluate(async (base) => {
    const index = await (
      await fetch(base + "/static/contentIndex.json")
    ).json();
    return Object.entries(index)
      .filter(
        ([slug, value]: any) => slug.startsWith("articles/") && value.sortRanks,
      )
      .map(([slug, value]: any) => ({ slug, title: value.title }));
  }, base);
  expect(entries.length).toBeGreaterThan(0);
  await expect(page.locator(".collection-note-count")).toContainText(
    `${entries.length.toLocaleString("en-US")} notes`,
  );
  await page.goto(`./${entries[0].slug}`);
  await expect(page.locator(".article-title")).toHaveText(entries[0].title);
  const searchable = entries.find((entry) =>
    /[\p{L}\p{N}]{3}/u.test(entry.title),
  );
  if (searchable) {
    await page
      .getByRole("textbox", { name: "Search the encyclopedia" })
      .fill(searchable.title);
    await expect(page.locator(".result-card")).not.toHaveCount(0);
  }
  await page.goto("./articles/");
  await expect(page.locator(".page-listing .section-li")).toHaveCount(
    entries.length,
  );
  await page.goto("./graph");
  await expect(page.locator(".graph-page canvas")).toBeVisible({
    timeout: 20000,
  });
  expect(errors).toEqual([]);
});
