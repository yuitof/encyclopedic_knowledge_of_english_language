import { test, expect } from "@playwright/test";

test("starter collection supports navigation, images, search and the graph", async ({
  page,
}) => {
  const errors: string[] = [],
    failures: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(response.url());
  });
  await page.goto("./");
  await expect(page.locator(".collection-note-count")).toContainText("3 notes");
  await page.goto("./articles/welcome");
  await expect(page.locator(".article-title")).toHaveText("Welcome");
  await expect(page.locator("article img")).toBeVisible();
  expect(
    await page
      .locator("article img")
      .evaluate((image: HTMLImageElement) => image.naturalWidth),
  ).toBeGreaterThan(0);
  await page.locator('article a[href$="writing-notes"]').first().click();
  await expect(page.locator(".article-title")).toHaveText("Writing notes");
  const search = page.getByRole("textbox", { name: "Search the encyclopedia" });
  await search.fill("Linking notes");
  await expect(page.locator(".result-card").first()).toContainText(
    "Linking notes",
  );
  await search.press("Escape");
  const base = (await page.locator("body").getAttribute("data-basepath")) ?? "";
  const index = await page.evaluate(
    async (base) => (await fetch(base + "/static/contentIndex.json")).json(),
    base,
  );
  expect(index["articles/welcome"].title).toBe("Welcome");
  expect(index["articles/linking-notes"].links).toContain(
    "articles/writing-notes",
  );
  expect(Object.keys(index).some((slug) => slug.startsWith("missing/"))).toBe(
    true,
  );
  await page.goto("./articles/");
  await expect(page.locator(".page-listing .section-li")).toHaveCount(3);
  await page.goto("./graph");
  await expect(page.locator(".graph-page canvas")).toBeVisible({
    timeout: 20000,
  });
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
});
