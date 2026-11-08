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
    const sidebar = page.locator(".sidebar.left");
    expect(await sidebar.evaluate((e) => e.clientHeight)).toBeLessThanOrEqual(
      480,
    );
    expect(await explorer.evaluate((e) => getComputedStyle(e).overflowY)).toBe(
      "visible",
    );
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

test("persistent alphabetical groups keep canonical order and navigate to homepage anchors", async ({
  page,
}) => {
  await page.goto("./articles/caimans");
  if ((page.viewportSize()?.width ?? 1440) <= 800)
    await page.locator(".navigation-panel > summary").click();
  const catalogue = page.getByRole("navigation", {
    name: "Alphabetical catalogue",
  });
  await expect(catalogue.getByRole("heading")).toHaveText(
    "Alphabetical catalogue",
  );
  await expect(catalogue.locator("li a")).toHaveText([
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "Symbols and numbers",
    "日本語 and other scripts",
  ]);
  await catalogue
    .getByRole("link", { name: "Symbols and numbers", exact: true })
    .click();
  await expect(page).toHaveURL(/#symbols-and-numbers$/);
  await expect(page.locator("#symbols-and-numbers")).toBeInViewport();
  const headings = await page.locator("article h3").allTextContents();
  expect(headings.slice(-3)).toEqual([
    "Z",
    "Symbols and numbers",
    "日本語 and other scripts",
  ]);
  expect(await page.locator(".sidebar.left .toc").count()).toBe(0);
  expect(await page.locator(".catalogue-navigation").count()).toBe(1);
  await page.goto("./articles/caimans");
  if ((page.viewportSize()?.width ?? 1440) <= 800)
    await page.locator(".navigation-panel > summary").click();
  await page
    .getByRole("navigation", { name: "Alphabetical catalogue" })
    .getByRole("link", { name: "日本語 and other scripts", exact: true })
    .click();
  await expect(page).toHaveURL(
    /#(?:%E6%97%A5%E6%9C%AC%E8%AA%9E|日本語)-and-other-scripts$/,
  );
  await expect(
    page.locator('[id="日本語-and-other-scripts"]'),
  ).toBeInViewport();
});

test("TOC and Explorer arrows respond once to mouse, Enter and Space with correct state", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./articles/culture");
  if ((page.viewportSize()?.width ?? 1440) <= 800)
    await page.locator(".navigation-panel > summary").click();
  await expect
    .poll(() => page.locator(".explorer-ul > li").count())
    .toBeGreaterThan(1);
  for (const [buttonSelector, contentSelector] of [
    [".toc-header", ".toc-content"],
    [".desktop-explorer", ".explorer-content"],
  ]) {
    const button = page.locator(buttonSelector),
      content = page.locator(contentSelector);
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const initialTransform = await button
      .locator(".fold")
      .evaluate((e) => getComputedStyle(e).transform);
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(content).not.toBeVisible();
    expect(
      await button
        .locator(".fold")
        .evaluate((e) => getComputedStyle(e).transform),
    ).not.toBe(initialTransform);
    await button.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(content).toBeVisible();
    await button.press("Space");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(content).not.toBeVisible();
    await button.press("Space");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(content).toBeVisible();
    await expect(page.locator(".catalogue-navigation")).toBeVisible();
  }
  await page.locator('article a[href*="drake"]').first().click();
  await expect(page.locator("h1")).toContainText("Drake");
  await page.goBack();
  await expect(page.locator("h1")).toHaveText("culture");
  if ((page.viewportSize()?.width ?? 1440) <= 800)
    await page.locator(".navigation-panel > summary").click();
  const button = page.locator(".desktop-explorer");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".explorer-content")).not.toBeVisible();
});

test("wheel input over contents or Explorer scrolls only the shared left sidebar", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./articles/culture");
  if ((page.viewportSize()?.width ?? 1440) <= 800)
    await page.locator(".navigation-panel > summary").click();
  await expect
    .poll(() => page.locator(".explorer-ul > li").count())
    .toBeGreaterThan(1);
  const sidebar = page.locator(".sidebar.left");
  for (const target of [
    page.locator(".toc-content a").first(),
    page.locator(".explorer-content a.nav-file-title").nth(10),
  ]) {
    await target.scrollIntoViewIfNeeded();
    await target.hover();
    const before = await sidebar.evaluate((e) => e.scrollTop),
      windowBefore = await page.evaluate(() => window.scrollY);
    expect(
      await sidebar.evaluate(
        (e) => e.scrollHeight - e.clientHeight - e.scrollTop,
      ),
    ).toBeGreaterThan(300);
    await page.mouse.wheel(0, 150);
    await expect
      .poll(() => sidebar.evaluate((e) => e.scrollTop))
      .toBeGreaterThan(before + 20);
    expect(await page.evaluate(() => window.scrollY)).toBe(windowBefore);
    const children = await page
      .locator(
        ".sidebar.left .toc-content,.sidebar.left .explorer-content,.sidebar.left .explorer-ul",
      )
      .evaluateAll((elements) =>
        elements.map((e) => ({
          scroll: e.scrollTop,
          overflow: getComputedStyle(e).overflowY,
        })),
      );
    expect(
      children.every((e) => e.scroll === 0 && e.overflow === "visible"),
    ).toBeTruthy();
  }
});

test("brand hover stays plain while native keyboard focus remains visible", async ({
  page,
}) => {
  await page.goto("./articles/caimans");
  const brand = page.locator(".encyclopedia-brand");
  await brand.hover();
  expect(
    await brand.evaluate((e) => getComputedStyle(e).textDecorationLine),
  ).toBe("none");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(brand).toBeFocused();
  expect(
    await brand.evaluate((e) => getComputedStyle(e).outlineStyle),
  ).not.toBe("none");
});
