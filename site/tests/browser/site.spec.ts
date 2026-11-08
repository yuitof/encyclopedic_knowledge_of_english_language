import { test, expect } from "@playwright/test";
test("real articles, image assets, aliases, backlinks and navigation work", async ({
  page,
}) => {
  const failures: string[] = [],
    errors: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(response.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./articles/crocodile-and-alligator");
  await expect(page.locator("h1")).toHaveText("Crocodile and alligator");
  await expect(page.locator("article img")).toBeVisible();
  expect(
    await page
      .locator("article img")
      .evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  await page.goto("./articles/crocodile");
  await expect(page.locator(".backlinks")).toContainText("rock");
  await page.goto("./articles/crocodile-and-alligator");
  await expect(page.locator(".header-search input")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
  await page.locator('article a[href*="caimans"]').click();
  await expect(page.locator("h1")).toHaveText("caimans");
  await expect(page.locator("article")).toContainText("ペットにするなら");
  await page.goto("./articles/cptsd");
  await expect(
    page.locator("article a").filter({ hasText: "第一次世界大戦" }),
  ).toBeVisible();
  await page.goto("./articles/r.e.p.o.?preview=1#main-content");
  await expect(page.locator("h1")).toHaveText("R.E.P.O.");
  await page.goto("./articles/u.s.-state?preview=1");
  await expect(page.locator("h1")).toHaveText("U.S. state");
  await page.goto("./articles");
  await expect(page).toHaveURL(/\/articles\/$/);
  await expect(page.locator("h1")).toContainText("articles");
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
});
test("stock search finds real English titles/content and Japanese, including offline queries", async ({
  page,
  context,
}) => {
  let sockets = 0;
  page.on("websocket", () => sockets++);
  await page.goto("./");
  const input = page.getByRole("textbox", { name: "Search the encyclopedia" });
  await expect(input).toHaveAttribute("data-visible-search", "true");
  await expect(page.locator(".results-container")).toBeAttached();
  await input.fill("crocodile");
  await expect(page.locator(".result-card").first()).toContainText(
    /crocodile/i,
  );
  await expect(
    page.locator(".result-card .card-description").first(),
  ).toBeVisible();
  await input.fill("death rolls");
  await expect(page.locator(".result-card").first()).toContainText(
    "Crocodile and alligator",
  );
  await input.fill("人称代名詞");
  await expect(page.locator(".result-card").first()).toContainText(
    "人称代名詞",
  );
  await context.setOffline(true);
  await input.fill("caimans");
  await expect(page.locator(".result-card").first()).toContainText("caimans");
  await context.setOffline(false);
  await input.press("ArrowDown");
  await input.press("ArrowUp");
  await input.press("Enter");
  await expect(page.locator("h1")).toHaveText("caimans");
  await input.press("ControlOrMeta+k");
  await input.fill("absenttermxyz");
  await expect(page.locator(".result-card")).toContainText("No results.");
  await input.press("Escape");
  await expect(input).toHaveValue("");
  expect(sockets).toBe(0);
});
test("keyboard skip link, bounded catalogue navigation and dark mode", async ({
  page,
}, testInfo) => {
  await page.goto("./articles/caimans");
  await page.keyboard.press("Tab");
  await expect(page.getByText("Skip to article")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  if (testInfo.project.name.includes("mobile")) {
    const panel = page.locator(".navigation-panel"),
      summary = panel.locator(":scope > summary");
    await expect(panel).not.toHaveAttribute("open", "");
    await summary.click();
    await expect(panel).toHaveAttribute("open", "");
    const explorer = page.locator(".explorer-content");
    await expect(explorer).toBeVisible();
    expect(
      await explorer.evaluate((e) => e.getBoundingClientRect().height),
    ).toBeLessThanOrEqual(260);
    await summary.click();
    await expect(panel).not.toHaveAttribute("open", "");
  }
  const dark = page.locator(".darkmode");
  await dark.scrollIntoViewIfNeeded();
  await dark.click();
  await expect(page.locator("html")).toHaveAttribute("saved-theme", "dark");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
});
