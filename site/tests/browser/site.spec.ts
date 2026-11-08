import { test, expect } from "@playwright/test";
test("article layout, Obsidian features, navigation, static assets and backlinks", async ({
  page,
}) => {
  const failures: string[] = [],
    errors: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(response.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./mathematics/linear-algebra");
  await expect(page.locator("h1")).toHaveText("Linear algebra");
  await expect(page.locator(".katex").first()).toBeVisible();
  await expect(page.locator(".katex-mathml math").first()).toBeAttached();
  await expect(page.locator("article img")).toBeVisible();
  expect(
    await page
      .locator("article img")
      .evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  await expect(page.locator("article .callout")).toBeVisible();
  await expect(page.locator(".backlinks")).toContainText("Binary search");
  await expect(
    page.locator('a[href*="#vectors-and-coordinates"]').first(),
  ).toBeAttached();
  await expect(page.locator(".header-search input")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
  await page.locator("article a").filter({ hasText: "binary search" }).click();
  await expect(page.locator("h1")).toHaveText("Binary search");
  await expect(page.locator("article pre")).toBeVisible();
  await expect(page.locator("article")).toContainText("What is the claim?");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
});
test("live stock search matches title/content/Japanese; keyboard selection works without network", async ({
  page,
  context,
}) => {
  let sockets = 0;
  page.on("websocket", () => sockets++);
  await page.goto("./");
  const input = page.getByRole("textbox", { name: "Search the encyclopedia" });
  await expect(input).toHaveAttribute("data-visible-search", "true");
  // Wait for the stock component to finish constructing its local index and results UI.
  await expect(page.locator(".results-container")).toBeAttached();
  await input.fill("Linear");
  await expect(page.locator(".result-card").first()).toContainText(
    "Linear algebra",
  );
  await expect(
    page.locator(".result-card .card-description").first(),
  ).toBeVisible();
  await input.fill("intervalhalving");
  await expect(page.locator(".result-card").first()).toContainText(
    "Binary search",
  );
  await input.fill("学習");
  await expect(page.locator(".result-card").first()).toContainText("日本語");
  await context.setOffline(true);
  await input.fill("vectors");
  await expect(page.locator(".result-card").first()).toContainText(
    "Linear algebra",
  );
  await context.setOffline(false);
  await input.press("ArrowDown");
  await input.press("ArrowUp");
  await input.press("Enter");
  await expect(page.locator("h1")).toHaveText("Linear algebra");
  await input.press("ControlOrMeta+k");
  await input.fill("absenttermxyz");
  await expect(page.locator(".result-card")).toContainText("No results.");
  await input.press("Escape");
  await expect(input).toHaveValue("");
  expect(sockets).toBe(0);
});
test("keyboard skip link, mobile topic collapse and dark mode", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.keyboard.press("Tab");
  await expect(page.getByText("Skip to article")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  if (testInfo.project.name.includes("mobile")) {
    const summary = page.locator(".navigation-panel > summary");
    await expect(page.locator(".navigation-panel")).not.toHaveAttribute(
      "open",
      "",
    );
    await summary.click();
    await expect(page.locator(".navigation-panel")).toHaveAttribute("open", "");
    await summary.click();
  }
  const dark = page.locator(".darkmode");
  await dark.scrollIntoViewIfNeeded();
  await expect(dark).toBeVisible();
  await dark.click();
  await expect(page.locator("html")).toHaveAttribute("saved-theme", "dark");
});
