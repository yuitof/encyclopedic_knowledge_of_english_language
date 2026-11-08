import { test, expect } from "@playwright/test";
const mobile = (page: any) => (page.viewportSize()?.width ?? 1440) <= 800;
async function openContents(page: any) {
  const panel = page.locator(".contents-panel");
  if (!(await panel.evaluate((element: HTMLDetailsElement) => element.open)))
    await panel.locator(":scope > summary").click();
}
async function openExplorer(page: any) {
  const panel = page.locator(".explorer-panel");
  if (!(await panel.evaluate((element: HTMLDetailsElement) => element.open)))
    await panel.locator(":scope > summary").click();
}
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
test("Explorer shows only the ten newest modified articles regardless of obsolete saved preferences", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("article-order", "name-desc");
    localStorage.setItem("catalogue-order", "created-asc");
  });
  for (const route of ["./", "./articles/", "./articles/caimans"]) {
    await page.goto(route);
    await openContents(page);
    await expect(
      page.locator(".article-sort, .catalogue-navigation"),
    ).toHaveCount(0);
    await expect(page.locator('a[href*="/catalogue"]')).toHaveCount(0);
    const expected = await expectedOrder(page, "modified-desc");
    await expect.poll(() => actualOrder(page)).toEqual(expected.slice(0, 10));
    if (route === "./articles/")
      await expect(page.locator(".page-listing .section-li")).toHaveCount(
        expected.length,
      );
  }
});
test("Show more follows the recent articles and opens the full list", async ({
  page,
}) => {
  await page.goto("./articles/caimans");
  await openContents(page);
  await openExplorer(page);
  const link = page.getByRole("link", { name: "Show more", exact: true });
  await expect(link).toHaveCount(1);
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeVisible();
  await expect(
    page.locator(
      '.folder-container[data-folderpath="articles/index"] + .folder-outer > ul > li:last-child > a',
    ),
  ).toHaveText("Show more");
  await link.click();
  await expect(page).toHaveURL(/\/articles\/$/);
  await expect(page.locator(".page-listing .section-li")).toHaveCount(
    (await expectedOrder(page, "modified-desc")).length,
  );
  await openContents(page);
  await openExplorer(page);
  await expect(
    page.getByRole("link", { name: "Show more", exact: true }),
  ).toHaveCount(1);
});
test("homepage uses the static index for varying note counts and compact snippets", async ({
  page,
}) => {
  for (const size of [0, 2, 9, 14]) {
    await page.route("**/static/contentIndex.json", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          Object.fromEntries(
            Array.from({ length: size }, (_, i) => [
              `articles/note-${i}`,
              {
                slug: `articles/note-${i}`,
                filePath: `articles/note-${i}.md`,
                title: `Note ${i}`,
                content: `Body ${i}`,
                links: [],
                tags: [],
                sortRanks: {
                  name: i,
                  modified: i === size - 1 ? null : Math.floor(i / 2),
                  created: i,
                },
              },
            ]),
          ),
        ),
      }),
    );
    await page.goto("./");
    await expect(page.locator(".collection-note-count")).toHaveText(
      `${size} notes in the collection.`,
    );
    const maximum = Number(
      await page.locator(".home-highlights").getAttribute("data-maximum"),
    );
    await expect(page.locator(".highlight-cards > article")).toHaveCount(
      Math.min(size, maximum),
    );
    await openContents(page);
    await expect
      .poll(() => actualOrder(page))
      .toEqual((await expectedOrder(page, "modified-desc")).slice(0, 10));
    await page.unroute("**/static/contentIndex.json");
  }
});
test("footer starts after both sidebars and its links remain clickable", async ({
  page,
}) => {
  for (const width of ["standard", "wide"]) {
    await page.addInitScript(
      (width) =>
        localStorage.setItem("reading-appearance", JSON.stringify({ width })),
      width,
    );
    for (const route of [
      "./articles/caimans",
      "./articles/culture",
      "./",
      "./privacy",
    ]) {
      await page.goto(route);
      await page.evaluate(() =>
        scrollTo(0, document.documentElement.scrollHeight),
      );
      await expect
        .poll(() =>
          page.evaluate(() => {
            const footer = document
              .querySelector(".encyclopedia-footer")!
              .getBoundingClientRect();
            return Array.from(document.querySelectorAll(".sidebar")).every(
              (sidebar) =>
                sidebar.getBoundingClientRect().bottom <= footer.top + 1,
            );
          }),
        )
        .toBe(true);
      const privacy = page
        .getByRole("navigation", { name: "Footer" })
        .getByRole("link", { name: "Privacy policy" });
      await expect(privacy).toBeInViewport();
      expect(
        await privacy.evaluate((link) => {
          const r = link.getBoundingClientRect();
          return link.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          );
        }),
      ).toBe(true);
      await privacy.click();
      await expect(page.locator("h1")).toHaveText("Privacy policy");
    }
  }
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
  await page.setViewportSize({
    width: page.viewportSize()!.width,
    height: 500,
  });
  await page.goto("./articles/culture");
  await openContents(page);
  await expect(page.locator(".contents-top")).toHaveAttribute(
    "aria-current",
    "location",
  );
  await expect(
    page.locator(".article-contents details, .article-contents summary"),
  ).toHaveCount(0);
  await expect(page.getByText("On this page", { exact: true })).toHaveCount(0);
  await expect(page.locator(".article-contents > ul")).toBeVisible();
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
  await openExplorer(page);
  const explorer = page.locator(".explorer-panel");
  const button = explorer.locator(":scope > summary");
  await button.click();
  await expect(explorer).not.toHaveAttribute("open", "");
  await expect(page.locator(".explorer-content")).not.toBeVisible();
  await button.press("Space");
  await expect(explorer).toHaveAttribute("open", "");
  for (const target of [
    page.locator(".article-contents a[data-section]").first(),
    page.locator(".explorer-content a.nav-file-title").first(),
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

test("build-time backlinks match article styling and contents, with no empty sections", async ({
  page,
}) => {
  await page.goto("./articles/crocodile");
  const section = page.locator("article .article-backlinks");
  await expect(section).toHaveCount(1);
  await expect(section.locator("h2")).toHaveText("Backlinks");
  await expect(
    section.getByRole("link", { name: "rock", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.locator(
      ".sidebar.right .backlinks, .sidebar.right .article-backlinks",
    ),
  ).toHaveCount(0);
  expect(
    await section.locator("h2").evaluate((e) => getComputedStyle(e).fontFamily),
  ).toContain("Georgia");
  expect(
    await section.locator("ul").evaluate((e) => getComputedStyle(e).overflowY),
  ).toBe("visible");
  await openContents(page);
  const shortcut = page.locator('.article-contents a[data-backlinks="true"]');
  await expect(shortcut).toHaveText("Backlinks");
  await shortcut.click();
  await expect(section).toBeInViewport();
  await expect(shortcut).toHaveAttribute("aria-current", "location");
  const negative = await page.evaluate(async () => {
    const index = await fetch(
      `${document.body.dataset.basepath ?? ""}/static/contentIndex.json`,
    ).then((r) => r.json());
    const entries = Object.entries(index) as [
      string,
      { sortRanks?: object; links?: string[] },
    ][];
    return entries.find(
      ([slug, note]) =>
        slug.startsWith("articles/") &&
        note.sortRanks &&
        !entries.some(([, source]) => source.links?.includes(slug)),
    )?.[0];
  });
  expect(negative).toBeTruthy();
  await page.goto(`./${negative}`);
  await expect(page.locator(".article-backlinks")).toHaveCount(0);
  await expect(
    page.locator('.article-contents a[data-backlinks="true"]'),
  ).toHaveCount(0);
});

test("Top reaches document zero including the masthead with mouse and keyboard", async ({
  page,
}) => {
  await page.goto("./articles/culture");
  await openContents(page);
  const top = page.locator(".contents-top");
  await expect(top).toHaveAttribute("href", "#quartz-root");
  for (const activation of ["click", "Enter"]) {
    await page.evaluate(() =>
      scrollTo(0, document.documentElement.scrollHeight),
    );
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    if (activation === "click") await top.click();
    else await top.press("Enter");
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect(page.locator(".encyclopedia-header")).toBeInViewport();
    await expect(top).toHaveAttribute("aria-current", "location");
  }
  await openExplorer(page);
  await page.locator(".nav-show-more").click();
  await expect(page).toHaveURL(/\/articles\/$/);
  await openContents(page);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await top.click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test("Contents and Explorer are matching independent sibling panels", async ({
  page,
}) => {
  await page.goto("./articles/culture");
  const contents = page.locator(".contents-panel");
  const explorer = page.locator(".explorer-panel");
  await expect(page.locator(".sidebar.left > .navigation-panel")).toHaveCount(
    2,
  );
  await expect(contents.locator(".explorer")).toHaveCount(0);
  await expect(page.locator(".explorer-toggle")).toHaveCount(0);
  for (const panel of [contents, explorer]) {
    if (mobile(page)) await expect(panel).not.toHaveAttribute("open", "");
    else await expect(panel).toHaveAttribute("open", "");
  }
  const style = (panel: any) =>
    panel.locator(":scope > summary").evaluate((element: Element) => {
      const computed = getComputedStyle(element);
      return [
        computed.fontFamily,
        computed.fontSize,
        computed.fontWeight,
        computed.color,
        computed.padding,
        computed.borderBottom,
        computed.listStyleType,
      ];
    });
  expect(await style(contents)).toEqual(await style(explorer));
  await openContents(page);
  await openExplorer(page);
  await contents.locator(":scope > summary").click();
  await expect(contents).not.toHaveAttribute("open", "");
  await expect(explorer).toHaveAttribute("open", "");
  await expect(page.locator(".explorer-content")).toBeVisible();
  await contents.locator(":scope > summary").press("Enter");
  await expect(page.locator(".contents-top")).toBeVisible();
  await explorer.locator(":scope > summary").click();
  await expect(explorer).not.toHaveAttribute("open", "");
  await expect(contents).toHaveAttribute("open", "");
  await expect(page.locator(".contents-top")).toBeVisible();
  await explorer.locator(":scope > summary").press("Space");
  await expect(page.locator(".explorer-content")).toBeVisible();
});

test("sidebar pins to the window edge until the article ends", async ({
  page,
}) => {
  await page.goto("./articles/culture");
  const sidebar = page.locator(".sidebar.left");
  await expect(page.locator(".nav-show-more")).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".header-search .search-bar")).toHaveAttribute(
    "data-visible-search",
    "true",
  );
  await page.evaluate(() => scrollTo(0, 0));
  const initial = await sidebar.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  expect(initial).toBeGreaterThan(30);
  for (const y of [initial / 2, initial + 200, initial + 450, initial + 800]) {
    await page.evaluate((y) => scrollTo(0, y), y);
    // Measure the current row boundary, including any masthead layout changes.
    await expect
      .poll(() =>
        sidebar.evaluate((element) => {
          const rowTop = element.parentElement!.getBoundingClientRect().top;
          return Math.abs(
            element.getBoundingClientRect().top - Math.max(0, rowTop),
          );
        }),
      )
      .toBeLessThan(1);
    if (y === initial / 2) {
      expect(
        await sidebar.evaluate(
          (element) => element.getBoundingClientRect().top,
        ),
      ).toBeGreaterThan(0);
    } else {
      await expect
        .poll(() =>
          sidebar.evaluate((element) => element.getBoundingClientRect().top),
        )
        .toBeCloseTo(0, 0);
    }
  }
  await openContents(page);
  await openExplorer(page);
  await expect
    .poll(() =>
      sidebar.evaluate((element) => element.getBoundingClientRect().top),
    )
    .toBeCloseTo(0, 0);
  await expect(
    sidebar.locator(":scope > .contents-panel > summary"),
  ).toBeInViewport();
  if (mobile(page)) {
    expect(
      await sidebar.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).not.toBe("rgba(0, 0, 0, 0)");
    const section = page.locator(".article-contents a[data-section]").nth(2);
    const slug = await section.getAttribute("data-section");
    await section.click();
    await expect(section).toHaveAttribute("aria-current", "location");
    await expect
      .poll(() =>
        page.evaluate((slug) => {
          const heading = document
            .getElementById(slug!)!
            .getBoundingClientRect();
          const sidebar = document
            .querySelector(".sidebar.left")!
            .getBoundingClientRect();
          return heading.top >= sidebar.bottom && heading.top < innerHeight;
        }, slug),
      )
      .toBe(true);
  }
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const sidebar = document
          .querySelector(".sidebar.left")!
          .getBoundingClientRect();
        const footer = document
          .querySelector(".encyclopedia-footer")!
          .getBoundingClientRect();
        return sidebar.bottom <= footer.top + 1;
      }),
    )
    .toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await expect
    .poll(() =>
      sidebar.evaluate((element) =>
        Math.abs(
          element.getBoundingClientRect().top -
            element.parentElement!.getBoundingClientRect().top,
        ),
      ),
    )
    .toBeLessThan(1);
  expect(
    await sidebar.evaluate((element) => element.getBoundingClientRect().top),
  ).toBeGreaterThan(30);
});
