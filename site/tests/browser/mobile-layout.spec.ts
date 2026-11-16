import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) > 800, "Phone layout only");
});

async function waitForNavigation(page: Page) {
  // Production loads component modules before the SPA bootstrap dispatches nav.
  // page.goto() can finish before those dynamic imports on a busy CI runner.
  await expect(page.locator(".sidebar.left")).toHaveAttribute(
    "data-sticky-navigation",
    "ready",
    { timeout: 20000 },
  );
}

async function openPanel(page: Page, name: string, native = false) {
  if (!native) await waitForNavigation(page);
  const panel = page.locator(`.${name}-panel`);
  if (!(await panel.evaluate((element: HTMLDetailsElement) => element.open)))
    await panel.locator(":scope > summary").click();
  return panel;
}

test("phone pages start with readable content and never widen the viewport", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const route of ["./", "./privacy", "./articles/", "./graph"]) {
    await page.goto(route);
    await waitForNavigation(page);
    await expect(page.locator(".article-title")).toBeInViewport();
    expect(
      (await page.locator(".article-title").boundingBox())!.y,
    ).toBeLessThan(240);
    expect(
      (await page.locator(".sidebar.left").boundingBox())!.height,
    ).toBeLessThanOrEqual(48);
    await expect(page.locator(".sidebar.left details[open]")).toHaveCount(0);
    for (const summary of await page
      .locator(".sidebar.left > details > summary")
      .all())
      expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".search-bar")
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
  }
  expect(errors).toEqual([]);
});

test("phone panels overlay content, close on Escape or outside tap, and expose all navigation", async ({
  page,
}) => {
  await page.goto("./");
  const title = page.locator(".article-title");
  const before = await title.boundingBox();
  const explorer = await openPanel(page, "explorer");
  await expect(
    explorer.getByRole("link", { name: "Browse entries", exact: true }),
  ).toBeVisible();
  await expect(
    explorer.getByRole("link", { name: "Graph view", exact: true }),
  ).toBeVisible();
  expect((await title.boundingBox())!.y).toBe(before!.y);
  const appearance = await openPanel(page, "appearance");
  await expect(explorer).not.toHaveAttribute("open", "");
  await expect(appearance.locator("fieldset")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(appearance).not.toHaveAttribute("open", "");
  await expect(appearance.locator(":scope > summary")).toBeFocused();
  await openPanel(page, "contents");
  // A tap below the sheet dismisses it without changing the document layout.
  await page.locator(".encyclopedia-brand").click();
  await expect(page.locator(".sidebar.left details[open]")).toHaveCount(0);
  await openPanel(page, "explorer");
  await explorer
    .getByRole("link", { name: "Browse entries", exact: true })
    .click();
  await expect(page).toHaveURL(/\/articles\/\?sort=name-asc$/);
  await expect(
    page.getByRole("combobox", { name: "Sort articles" }),
  ).toBeEnabled();
  await openPanel(page, "explorer");
  await explorer.getByRole("link", { name: "Graph view", exact: true }).click();
  await expect(page.locator(".graph-page canvas")).toBeVisible();
  await expect(page.locator(".sidebar.left details[open]")).toHaveCount(0);
});

test("a panel opened before navigation scripts load keeps the reader's appearance choice", async ({
  page,
}) => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Quartz imports the SPA bootstrap after its component modules. Delay it
  // deterministically so this covers the slow-load race seen on the live site.
  await page.route("**/static/scripts/script-14-*.js", async (route) => {
    await blocked;
    await route.continue();
  });
  try {
    await page.goto("./privacy", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".sidebar.left")).not.toHaveAttribute(
      "data-sticky-navigation",
      "ready",
    );
    const appearance = await openPanel(page, "appearance", true);
    await appearance.getByLabel("Dark", { exact: true }).check();
    release();
    await waitForNavigation(page);
    await expect(appearance).toHaveAttribute("open", "");
    await expect(
      page.locator(".sidebar.left > .appearance-panel"),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("saved-theme", "dark");
    await appearance.getByLabel("Large", { exact: true }).check();
    await expect(page.locator("html")).toHaveAttribute("data-text", "large");
  } finally {
    release();
  }
});

test("phone navigation waits for a slow production bootstrap", async ({
  page,
}) => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/static/scripts/script-14-*.js", async (route) => {
    await blocked;
    await route.continue();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await page.goto("./privacy", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".sidebar.left")).not.toHaveAttribute(
      "data-sticky-navigation",
      "ready",
    );
    // Exceed Playwright's default five-second assertion deadline, while the
    // same readiness wait used by the collection checks is already pending.
    timer = setTimeout(release, 6000);
    await waitForNavigation(page);
    const explorer = await openPanel(page, "explorer");
    await expect(explorer).toHaveAttribute("open", "");
  } finally {
    clearTimeout(timer);
    release();
  }
});

test("contents jump clears the sheet and leaves the heading below the compact sticky bar", async ({
  page,
}) => {
  await page.goto("./articles/");
  await expect(
    page.getByRole("combobox", { name: "Sort articles" }),
  ).toBeEnabled();
  const contents = await openPanel(page, "contents");
  const link = contents.locator("a[data-section]").first();
  const id = await link.getAttribute("data-section");
  await link.click();
  await expect(contents).not.toHaveAttribute("open", "");
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const heading = document.getElementById(id!)!.getBoundingClientRect();
        const bar = document
          .querySelector(".sidebar.left")!
          .getBoundingClientRect();
        return heading.top >= bar.bottom && heading.top < innerHeight;
      }, id),
    )
    .toBe(true);
  await openPanel(page, "contents");
  await contents.locator(".contents-top").click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test("appearance survives SPA navigation and moves back to the desktop sidebar on resize", async ({
  page,
}) => {
  const width = page.viewportSize()!.width;
  await page.goto("./privacy");
  const appearance = await openPanel(page, "appearance");
  await appearance.getByLabel("Dark", { exact: true }).check();
  await appearance.getByLabel("Large", { exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("saved-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-text", "large");
  await openPanel(page, "explorer");
  await page
    .locator(".mobile-site-links")
    .getByRole("link", { name: "Main page", exact: true })
    .click();
  await expect(page.locator(".collection-note-count")).toBeVisible();
  await expect(page.locator(".appearance-panel")).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("saved-theme", "dark");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    page.locator(".sidebar.right > .appearance-panel"),
  ).toBeVisible();
  await expect(appearance).toHaveAttribute("open", "");
  await page.setViewportSize({ width, height: 844 });
  await expect(page.locator(".sidebar.left > .appearance-panel")).toBeVisible();
  await expect(appearance).not.toHaveAttribute("open", "");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("article sorting keeps phone panels closed until the reader opens the date filters", async ({
  page,
}) => {
  await page.goto("./articles/");
  const select = page.getByRole("combobox", { name: "Sort articles" });
  await expect(select).toBeEnabled();
  await select.selectOption("modified-desc");
  await expect(page.locator(".sidebar.left details[open]")).toHaveCount(0);
  const explorer = await openPanel(page, "explorer");
  await expect(
    explorer.getByRole("form", { name: "Article date range" }),
  ).toBeVisible();
  await expect(explorer.getByLabel("From", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await select.selectOption("name-asc");
  await expect(page.locator(".sidebar.left details[open]")).toHaveCount(0);
  await expect(page.locator(".page-listing .section-li").first()).toBeVisible();
});

test("mobile article navigation remains usable without JavaScript", async ({
  browser,
  baseURL,
  viewport,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport,
  });
  try {
    const page = await context.newPage();
    await page.goto(baseURL!);
    await expect(page.locator(".article-title")).toBeInViewport();
    const explorer = await openPanel(page, "explorer", true);
    await explorer
      .getByRole("link", { name: "Browse entries", exact: true })
      .click();
    await expect(
      page.locator(".page-listing .section-li").first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await context.close();
  }
});
