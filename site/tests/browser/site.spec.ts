import { test, expect } from "@playwright/test";
const mobile = (page: any) => (page.viewportSize()?.width ?? 1440) <= 800;
async function openContents(page: any) {
  if (mobile(page)) {
    const details = page.locator(".navigation-panel");
    if (!(await details.getAttribute("open")))
      await details.locator(":scope > summary").click();
  }
}
const modes = [
  "name-asc",
  "name-desc",
  "modified-desc",
  "modified-asc",
  "created-desc",
  "created-asc",
];
const expectedOrder = async (page: any, mode: string) =>
  page.evaluate(async (mode) => {
    const data = await fetch(
      "" + (document.body.dataset.basepath ?? "") + "/static/contentIndex.json",
    ).then((r) => r.json());
    const [field, direction] = mode.split("-");
    return Object.entries(data)
      .filter(([slug, n]: any) => slug.startsWith("articles/") && n.sortRanks)
      .sort((a: any, b: any) => {
        const x = a[1].sortRanks,
          y = b[1].sortRanks,
          av = x[field],
          bv = y[field];
        if (av === null && bv !== null) return 1;
        if (bv === null && av !== null) return -1;
        return (
          (av === null || bv === null ? 0 : av - bv) *
            (direction === "desc" ? -1 : 1) || x.name - y.name
        );
      })
      .map(([slug]) => slug);
  }, mode);
const actualOrder = async (page: any) =>
  page
    .locator(".explorer-content a.nav-file-title")
    .evaluateAll((links: any[]) =>
      links.map((link) =>
        decodeURIComponent(new URL(link.href).pathname)
          .replace(document.body.dataset.basepath ?? "", "")
          .replace(/^\//, ""),
      ),
    );

test("real note links, images, dotted routes, appearance and local assets", async ({
  page,
}) => {
  const failures: string[] = [],
    errors: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400) failures.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./articles/crocodile-and-alligator");
  await expect(page.locator("h1")).toHaveText("Crocodile and alligator");
  await expect(page.locator("article img")).toBeVisible();
  expect(
    await page
      .locator("article img")
      .evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  await page.locator('article a[href*="caimans"]').click();
  await expect(page.locator("h1")).toHaveText("caimans");
  await expect(page.locator("article")).toContainText("ペットにするなら");
  await expect(page.locator(".appearance-panel")).toBeVisible();
  await page.goto("./articles/r.e.p.o.?check=1#main-content");
  await expect(page.locator("h1")).toHaveText("R.E.P.O.");
  await page.goto("./articles/u.s.-state");
  await expect(page.locator("h1")).toHaveText("U.S. state");
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
});
test("stock title, content and Japanese search works offline after loading", async ({
  page,
  context,
}) => {
  let sockets = 0;
  page.on("websocket", () => sockets++);
  await page.goto("./articles/caimans");
  const input = page.getByRole("textbox", { name: "Search the encyclopedia" });
  await expect(page.locator(".results-container")).toBeAttached();
  for (const [query, title] of [
    ["crocodile", "crocodile"],
    ["death rolls", "Crocodile and alligator"],
    ["人称代名詞", "人称代名詞"],
  ]) {
    await input.fill(query);
    await expect(page.locator(".result-card").first()).toContainText(
      new RegExp(title, "i"),
    );
  }
  await context.setOffline(true);
  await input.fill("caimans");
  await expect(page.locator(".result-card").first()).toContainText("caimans");
  await context.setOffline(false);
  await input.press("Enter");
  await expect(page.locator("h1")).toHaveText("caimans");
  expect(sockets).toBe(0);
});
test("dedicated catalogue stays inside Explorer above articles in canonical order", async ({
  page,
}) => {
  await page.goto("./articles/caimans");
  await openContents(page);
  const catalogue = page.getByRole("navigation", {
    name: "Alphabetical catalogue",
  });
  await expect(catalogue).toBeVisible();
  await expect(
    page.locator(".explorer-content .catalogue-navigation"),
  ).toBeVisible();
  await expect(catalogue.locator("li a")).toHaveText([
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "Symbols and numbers",
    "日本語 and other scripts",
  ]);
  await catalogue
    .getByRole("link", { name: "Symbols and numbers", exact: true })
    .click();
  await expect(page).toHaveURL(/\/catalogue#symbols-and-numbers$/);
  await expect(page.locator("#symbols-and-numbers")).toBeInViewport();
  expect(
    (await page.locator("article h3").allTextContents()).slice(-3),
  ).toEqual(["Z", "Symbols and numbers", "日本語 and other scripts"]);
  await page.goto("./articles/caimans");
  await openContents(page);
  await page
    .getByRole("navigation", { name: "Alphabetical catalogue" })
    .getByRole("link", { name: "日本語 and other scripts", exact: true })
    .click();
  await expect(
    page.locator('[id="日本語-and-other-scripts"]'),
  ).toBeInViewport();
});
test("six article orders persist with missing dates last and filename tie breaks", async ({
  page,
}) => {
  await page.goto("./articles/");
  await openContents(page);
  const select = page.getByLabel("Arrange articles");
  await expect(select).toBeVisible();
  await expect(select).toHaveValue("modified-desc");
  await expect
    .poll(() => page.locator(".explorer-content a.nav-file-title").count())
    .toBe(2584);
  await expect(select.locator("option")).toHaveText([
    "File name(A-Z)",
    "File name(Z-A)",
    "Modified time(new to old)",
    "Modified time(old to new)",
    "Created time(new to old)",
    "Created time(old to new)",
  ]);
  for (const mode of modes) {
    await select.selectOption(mode);
    const expected = await expectedOrder(page, mode);
    await expect.poll(() => actualOrder(page)).toEqual(expected);
  }
  await page.reload();
  await openContents(page);
  await expect(page.getByLabel("Arrange articles")).toHaveValue("created-asc");
  await page.goto("./articles/caimans");
  await openContents(page);
  await expect(page.getByLabel("Arrange articles")).toHaveCount(0);
  await expect
    .poll(() => actualOrder(page))
    .toEqual(await expectedOrder(page, "created-asc"));
});
test("appearance text width and color preferences persist, including automatic color", async ({
  page,
}) => {
  await page.goto("./articles/caimans");
  const panel = page.locator(".appearance-panel");
  await panel.locator('input[name="appearance-text"][value="large"]').check();
  await panel.locator('input[name="appearance-width"][value="wide"]').check();
  await panel.locator('input[name="appearance-color"][value="dark"]').check();
  await expect(page.locator("html")).toHaveAttribute("saved-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-text", "large");
  await expect(page.locator("html")).toHaveAttribute("data-width", "wide");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("saved-theme", "dark");
  await page
    .locator('input[name="appearance-color"][value="automatic"]')
    .check();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("saved-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("saved-theme", "dark");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
});
test("malformed saved appearance falls back safely and keeps keyboard controls", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "reading-appearance",
      JSON.stringify({ text: "wide", width: "dark", color: "bogus" }),
    ),
  );
  await page.goto("./articles/caimans");
  await expect(page.locator("html")).toHaveAttribute("data-text", "standard");
  await expect(page.locator("html")).toHaveAttribute("data-width", "standard");
  await expect(page.locator("html")).toHaveAttribute("data-color", "automatic");
  await page.keyboard.press("Tab");
  await expect(page.getByText("Skip to article")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".encyclopedia-brand")).toBeFocused();
  await page.locator(".encyclopedia-brand").hover();
  expect(
    await page
      .locator(".encyclopedia-brand")
      .evaluate((e) => getComputedStyle(e).textDecorationLine),
  ).toBe("none");
});
test("section contents, active heading and Explorer collapse share one sidebar scroll", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./articles/culture");
  await openContents(page);
  await expect(page.locator(".contents-top")).toHaveAttribute(
    "aria-current",
    "location",
  );
  const contents = page.locator(".article-contents details"),
    summary = contents.locator("summary");
  await summary.click();
  await expect(contents.locator("ul")).not.toBeVisible();
  await summary.press("Enter");
  await expect(contents.locator("ul")).toBeVisible();
  await page.locator(".article-contents a[data-section]").nth(2).click();
  await expect(
    page.locator(".article-contents a[data-section]").nth(2),
  ).toHaveAttribute("aria-current", "location");
  expect(
    await page
      .locator(".active-section")
      .evaluate((e) => getComputedStyle(e).fontWeight),
  ).toBe("700");
  expect(
    await page
      .locator(".active-section")
      .evaluate((e) => getComputedStyle(e).color),
  ).toBe("rgb(16, 20, 24)");
  const button = page.locator(".desktop-explorer");
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".explorer-content")).not.toBeVisible();
  await button.press("Space");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  for (const target of [
    page.locator(".article-contents a[data-section]").first(),
    page.locator(".explorer-content a.nav-file-title").nth(10),
  ]) {
    await target.scrollIntoViewIfNeeded();
    await target.hover();
    const sidebar = page.locator(".sidebar.left"),
      before = await sidebar.evaluate((e) => e.scrollTop),
      windowBefore = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 120);
    await expect
      .poll(() => sidebar.evaluate((e) => e.scrollTop))
      .toBeGreaterThan(before + 15);
    expect(await page.evaluate(() => scrollY)).toBe(windowBefore);
  }
});
test("home shows compact randomized real snippets and footer policies and E icon", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".highlight-cards > article")).toHaveCount(6);
  const first = await page.locator(".highlight-cards a").allTextContents();
  expect(new Set(first).size).toBe(6);
  await page.reload();
  await expect(page.locator(".highlight-cards > article")).toHaveCount(6);
  expect(
    await page.locator(".highlight-cards a").allTextContents(),
  ).not.toEqual(first);
  await expect(page.locator("article h3")).toHaveCount(0);
  const footer = page.getByRole("navigation", { name: "Footer" });
  await expect(
    footer.getByRole("link", { name: "Privacy policy" }),
  ).toBeVisible();
  await footer.getByRole("link", { name: "License", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("License");
  await expect(page.locator("article")).toContainText("third-party images");
  const icon = await page.locator('link[rel="icon"]').getAttribute("href");
  expect(icon).toContain("favicon.svg");
  const response = await page.request.get(
    new URL(icon!, page.url()).toString(),
  );
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain(">E</text>");
});
test("hover previews omit article title while retaining the note body", async ({
  page,
}) => {
  await page.goto("./articles/culture");
  const link = page.locator('article a[href*="drake"]').first();
  await link.hover();
  if (mobile(page)) {
    await expect(page.locator(".popover.active-popover")).not.toBeVisible();
    return;
  }
  await expect(page.locator(".popover.active-popover")).toBeVisible();
  await expect(page.locator(".popover.active-popover h1")).toHaveCount(0);
  await expect(
    page.locator(".popover.active-popover .popover-inner"),
  ).not.toBeEmpty();
});
