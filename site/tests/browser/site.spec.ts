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
    await expect
      .poll(() => actualOrder(page))
      .toEqual(route === "./articles/" ? [] : expected.slice(0, 10));
    if (route === "./articles/")
      await expect(page.locator(".page-listing .section-li")).toHaveCount(
        expected.length,
      );
  }
  await openExplorer(page);
  const recentLinks = page.locator(
    ".explorer-content a.nav-file-title, .explorer-panel > .show-more-row a.nav-show-more",
  );
  await expect(recentLinks).toHaveCount(11);
  for (const mode of ["light", "dark"]) {
    await page
      .locator(`input[name="appearance-color"][value="${mode}"]`)
      .check();
    const blue = await page
      .locator(".graph-view-link")
      .evaluate((link) => getComputedStyle(link).color);
    expect(
      await recentLinks.evaluateAll((links) =>
        links.map((link) => ({
          color: getComputedStyle(link).color,
          opacity: getComputedStyle(link).opacity,
        })),
      ),
    ).toEqual(
      Array.from({ length: 11 }, () => ({ color: blue, opacity: "1" })),
    );
  }
});
test("Show more follows the recent articles and opens the full list", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("article-list-order", "created-asc"),
  );
  await page.goto("./articles/caimans");
  await openContents(page);
  await openExplorer(page);
  const link = page.getByRole("link", { name: "Show more", exact: true });
  await expect(link).toHaveCount(1);
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeVisible();
  await expect(page.locator(".explorer-panel > .show-more-row > a")).toHaveText(
    "Show more",
  );
  await expect(page.locator(".explorer .nav-show-more")).toHaveCount(0);
  await expect(link).toHaveAttribute(
    "href",
    /\/articles\/\?sort=modified-desc$/,
  );
  await link.click();
  await expect(page).toHaveURL(/\/articles\/\?sort=modified-desc$/);
  await expect(page.locator(".page-listing .section-li")).toHaveCount(
    (await expectedOrder(page, "modified-desc")).length,
  );
  const select = page.getByRole("combobox", { name: "Sort articles" });
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue("modified-desc");
  await expect
    .poll(() => articleListOrder(page))
    .toEqual(await expectedOrder(page, "modified-desc"));
  await page.reload();
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue("modified-desc");
  await select.selectOption("name-asc");
  await expect(page).toHaveURL(/\?sort=name-asc$/);
  await page.reload();
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue("name-asc");
  await expect
    .poll(() => articleListOrder(page))
    .toEqual(await expectedArticleList(page, "name-asc"));
  await expect(page.locator(".nav-show-more")).toHaveCount(0);
  await select.selectOption("modified-desc");
  const browse = page.getByRole("link", {
    name: "Browse entries",
    exact: true,
    includeHidden: true,
  });
  await expect(browse).toHaveAttribute("href", /\/articles\/\?sort=name-asc$/);
  if (mobile(page)) {
    // The compact header omits this link visually; its URL still works in a new tab.
    const target = await browse.evaluate(
      (link: HTMLAnchorElement) => link.href,
    );
    const tab = await page.context().newPage();
    try {
      await tab.goto(target);
      const tabSelect = tab.getByRole("combobox", { name: "Sort articles" });
      await expect(tabSelect).toBeEnabled();
      await expect(tabSelect).toHaveValue("name-asc");
      await expect
        .poll(() => articleListOrder(tab))
        .toEqual(await expectedArticleList(tab, "name-asc"));
    } finally {
      await tab.close();
    }
  } else {
    await browse.click();
    await expect(page).toHaveURL(/\/articles\/\?sort=name-asc$/);
    await expect(select).toBeEnabled();
    await expect(select).toHaveValue("name-asc");
    await expect
      .poll(() => articleListOrder(page))
      .toEqual(await expectedArticleList(page, "name-asc"));
  }
});
test("homepage uses the static index for snippets and keeps its compiled note count", async ({
  page,
}) => {
  const html = await (await page.request.get("./")).text();
  const compiledCount =
    /<p class="collection-note-count"[^>]*>([\d,]+ notes in the collection\.)<\/p>/u.exec(
      html,
    )?.[1];
  expect(compiledCount).toBeDefined();
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
      compiledCount!,
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
  // Show more is build-rendered now; wait for the client-loaded recent tree
  // before measuring wheel movement through its two navigation sections.
  await expect
    .poll(() => actualOrder(page))
    .toEqual((await expectedOrder(page, "modified-desc")).slice(0, 10));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
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
    // Center the wheel target within the shared panel, away from clipping edges.
    await target.evaluate((element) => {
      const panel = element.closest<HTMLElement>(".sidebar")!;
      panel.scrollTop +=
        element.getBoundingClientRect().top -
        panel.getBoundingClientRect().top -
        panel.clientHeight / 2;
    });
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
  await expect(page.locator(".highlight-cards > article")).toHaveCount(9);
  const first = await page.locator(".highlight-cards a").allTextContents();
  expect(new Set(first).size).toBe(9);
  await page.reload();
  await expect(page.locator(".highlight-cards > article")).toHaveCount(9);
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
  await expect(page).toHaveURL(/\/articles\/\?sort=modified-desc$/);
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
    if (mobile(page) && panel === contents)
      await expect(panel).not.toHaveAttribute("open", "");
    else await expect(panel).toHaveAttribute("open", "");
  }
  await openContents(page);
  await openExplorer(page);
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
  const offset = await sidebar.evaluate((element) =>
    parseFloat(getComputedStyle(element).top),
  );
  expect(offset).toBeGreaterThanOrEqual(16);
  await expect
    .poll(() => actualOrder(page))
    .toEqual((await expectedOrder(page, "modified-desc")).slice(0, 10));
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
            element.getBoundingClientRect().top -
              Math.max(parseFloat(getComputedStyle(element).top), rowTop),
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
        .toBeCloseTo(offset, 0);
    }
  }
  await openContents(page);
  await openExplorer(page);
  await expect
    .poll(() =>
      sidebar.evaluate((element) => element.getBoundingClientRect().top),
    )
    .toBeCloseTo(offset, 0);
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

test("sidebars pin on shorter articles without reserving empty viewport space", async ({
  page,
}) => {
  await page.goto("./articles/caimans");
  await expect
    .poll(() => actualOrder(page))
    .toEqual((await expectedOrder(page, "modified-desc")).slice(0, 10));
  await page.evaluate(() => document.fonts.ready);
  const floating =
    page.viewportSize()!.width >= 1200
      ? page.locator(".sidebar")
      : page.locator(".sidebar.left");
  await page.evaluate(() => scrollTo(0, 0));
  for (const panel of await floating.all()) {
    expect(
      await panel.evaluate((element) => element.getBoundingClientRect().top),
    ).toBeGreaterThan(30);
    expect(
      await panel.evaluate((element) =>
        Math.abs(
          element.getBoundingClientRect().bottom -
            Math.min(
              element.lastElementChild!.getBoundingClientRect().bottom,
              element.getBoundingClientRect().top +
                parseFloat(getComputedStyle(element).maxHeight),
            ),
        ),
      ),
    ).toBeLessThan(2);
  }
  await page.mouse.move(
    page.viewportSize()!.width / 2,
    page.viewportSize()!.height - 24,
  );
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
  for (const panel of await floating.all()) {
    const offset = await panel.evaluate((element) =>
      parseFloat(getComputedStyle(element).top),
    );
    expect(offset).toBeGreaterThanOrEqual(16);
    await expect
      .poll(() =>
        panel.evaluate((element) => element.getBoundingClientRect().top),
      )
      .toBeCloseTo(offset, 0);
  }
  await expect(
    page.getByText("Around this article", { exact: true }),
  ).toHaveCount(0);
  const appearance = page.locator(".appearance-panel");
  expect(
    await appearance.evaluate(
      (element) => getComputedStyle(element).borderBottomWidth,
    ),
  ).toBe("0px");
  for (const legend of await appearance.locator("legend").all()) {
    expect(
      await legend.evaluate((element) => getComputedStyle(element).fontWeight),
    ).toBe("400");
    expect(
      await legend.evaluate(
        (element) => getComputedStyle(element).borderBottomWidth,
      ),
    ).toBe("1px");
  }
  await expect(
    page.getByRole("link", { name: "yuitof’s website", exact: true }),
  ).toHaveCount(0);
});

const articleListOrder = async (page: any) =>
  page
    .locator(".page-listing .section-li .desc a.internal")
    .evaluateAll((links: HTMLAnchorElement[]) =>
      links.map((link) =>
        decodeURIComponent(new URL(link.href).pathname)
          .slice((document.body.dataset.basepath ?? "").length)
          .replace(/^\//, "")
          .replace(/\.html$/, ""),
      ),
    );
const expectedArticleList = async (page: any, mode: string) => {
  const order = await expectedOrder(page, mode);
  if (!mode.startsWith("name-")) return order;
  return page.evaluate(
    async ({ order }) => {
      const data = await fetch(
        `${document.body.dataset.basepath ?? ""}/static/contentIndex.json`,
      ).then((r) => r.json());
      const groupOrder = (slug: string) =>
        data[slug].sortDetails?.group ?? "other";
      const letters = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
      if (
        order.length > 1 &&
        data[order[0]].sortRanks.name >
          data[order[order.length - 1]].sortRanks.name
      )
        letters.reverse();
      const groups = [...letters, "symbols", "other"];
      return order.sort(
        (a, b) => groups.indexOf(groupOrder(a)) - groups.indexOf(groupOrder(b)),
      );
    },
    { order },
  );
};
const articleModes = [
  ["name-asc", "File name (A-Z)"],
  ["name-desc", "File name (Z-A)"],
  ["modified-desc", "Modified time (new to old)"],
  ["modified-asc", "Modified time (old to new)"],
  ["created-desc", "Created time (new to old)"],
  ["created-asc", "Created time (old to new)"],
];

test("Articles supports all six orders, keyboard control, offline changes and persistent selection", async ({
  page,
  context,
}) => {
  await page.goto("./articles/");
  const select = page.getByRole("combobox", { name: "Sort articles" });
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue("name-asc");
  expect(await select.locator("option").allTextContents()).toEqual(
    articleModes.map(([, label]) => label),
  );
  const orders = new Map<string, string[]>();
  for (const [mode] of articleModes) {
    const expected = await expectedArticleList(page, mode);
    orders.set(mode, expected);
    await select.selectOption(mode);
    await expect.poll(() => articleListOrder(page)).toEqual(expected);
    await expect(page.locator("#article-sort-status")).toHaveCount(0);
    await expect(page.locator(".article-sort-error")).not.toBeVisible();
  }
  await expect.poll(() => actualOrder(page)).toEqual([]);
  await expect(page.locator(".sidebar .article-list-sort")).toHaveCount(0);
  try {
    await context.setOffline(true);
    await select.selectOption("name-desc");
    await expect
      .poll(() => articleListOrder(page))
      .toEqual(orders.get("name-desc"));
  } finally {
    await context.setOffline(false);
  }
  await select.selectOption("name-asc");
  await select.focus();
  // Native select type-ahead works without opening an OS-level popup menu.
  await select.press("m");
  await expect(select).toHaveValue("modified-desc");
  await expect
    .poll(() => articleListOrder(page))
    .toEqual(orders.get("modified-desc"));
  await select.selectOption("created-asc");
  await page
    .locator(".page-listing .section-li .desc a.internal")
    .first()
    .click();
  await expect(page.locator(".article-list-sort")).toHaveCount(0);
  await page.goBack();
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue("created-asc");
  await expect
    .poll(() => articleListOrder(page))
    .toEqual(orders.get("created-asc"));
  await page.reload();
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue("created-asc");
  await expect
    .poll(() => articleListOrder(page))
    .toEqual(orders.get("created-asc"));
  await page
    .locator(".page-listing .section-li .desc a.internal")
    .first()
    .click();
  await expect(page.locator(".article-list-sort")).toHaveCount(0);
  await expect(page.locator("h1")).toBeVisible();
});

test("Article sorts handle date ties, unknown dates and unavailable saved preferences", async ({
  page,
}) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("article-list-order", "invalid-sort");
    } catch {}
  });
  await page.route("**/static/contentIndex.json", async (route) => {
    const response = await route.fetch();
    const index = await response.json();
    for (const note of Object.values(index) as any[])
      if (note.sortRanks)
        note.sortRanks = { ...note.sortRanks, modified: null, created: null };
    const slugs = [
      "caimans",
      "crocodile",
      "crocodile-and-alligator",
      "culture",
    ];
    slugs.forEach((name, i) =>
      Object.assign(index[`articles/${name}`].sortRanks, {
        modified: [2, 2, 5, null][i],
        created: [null, 3, 3, 1][i],
      }),
    );
    await route.fulfill({ response, json: index });
  });
  await page.goto("./articles/");
  const select = page.getByRole("combobox", { name: "Sort articles" });
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue("name-asc");
  for (const [mode] of articleModes) {
    const expected = await expectedArticleList(page, mode);
    await select.selectOption(mode);
    await expect.poll(() => articleListOrder(page)).toEqual(expected);
  }
  await page.addInitScript(() => {
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === "article-list-order") throw new Error("Storage unavailable");
      return originalGet.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "article-list-order") throw new Error("Storage unavailable");
      return originalSet.call(this, key, value);
    };
  });
  await page.reload();
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue("name-asc");
  await select.selectOption("modified-desc");
  await expect
    .poll(() => articleListOrder(page))
    .toEqual(await expectedOrder(page, "modified-desc"));
});

test("Articles retains the complete static list without JavaScript", async ({
  browser,
  page,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL,
    viewport: page.viewportSize()!,
  });
  try {
    const staticPage = await context.newPage();
    await staticPage.goto("./articles/");
    const response = await context.request.get(
      new URL("static/contentIndex.json", baseURL!).href,
    );
    const index = await response.json();
    const count = Object.entries(index).filter(
      ([slug, note]: any) => slug.startsWith("articles/") && note.sortRanks,
    ).length;
    await expect(staticPage.locator(".page-listing .section-li")).toHaveCount(
      count,
    );
    await expect(staticPage.locator(".page-listing > p")).toHaveText(
      `${count.toLocaleString("en-US")} ${count === 1 ? "item" : "items"} under this folder.`,
    );
    await expect(
      staticPage.getByRole("combobox", { name: "Sort articles" }),
    ).toBeDisabled();
    await expect(
      staticPage.locator(".article-list-sort noscript"),
    ).toHaveJSProperty(
      "textContent",
      "Enable JavaScript to change the article order.",
    );
    await staticPage.goto("./");
    await expect(staticPage.locator(".collection-note-count")).toHaveText(
      `${count.toLocaleString("en-US")} notes in the collection.`,
    );
  } finally {
    await context.close();
  }
});

test("Articles filename groups populate Contents and date calendars filter inclusive ranges", async ({
  page,
}) => {
  await page.route("**/static/contentIndex.json", async (route) => {
    const response = await route.fetch(),
      index = await response.json();
    // The calendar and sorter share one fixture: never retain real-note ranks
    // beside synthetic dates, which can reverse the expected order in CI.
    for (const note of Object.values(index) as any[]) {
      if (note.sortDetails)
        note.sortDetails = {
          ...note.sortDetails,
          modified: null,
          created: null,
        };
      if (note.sortRanks)
        note.sortRanks = { ...note.sortRanks, modified: null, created: null };
    }
    Object.assign(index["articles/caimans"].sortDetails, {
      modified: "2020-01-10",
      created: "2019-02-01",
    });
    Object.assign(index["articles/crocodile"].sortDetails, {
      modified: "2020-01-20",
      created: "2019-02-02",
    });
    Object.assign(index["articles/culture"].sortDetails, {
      modified: "2020-01-21",
      created: "2019-02-03",
    });
    // Both sample date fields increase in this order; preserve filename ranks.
    ["caimans", "crocodile", "culture"].forEach((name, rank) => {
      Object.assign(index[`articles/${name}`].sortRanks, {
        modified: rank,
        created: rank,
      });
    });
    await route.fulfill({ response, json: index });
  });
  await page.goto("./articles/");
  const select = page.getByRole("combobox", { name: "Sort articles" });
  await expect(select).toBeEnabled();
  await expect(
    page.locator(".sidebar .explorer, .sidebar .nav-show-more"),
  ).toHaveCount(0);
  await openContents(page);
  const headings = page.locator(".article-group-heading h2");
  const names = await headings.allTextContents();
  expect(names.slice(0, 26)).toEqual([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"]);
  expect(names.slice(-2)).toEqual([
    "Symbols and numbers",
    "日本語 and other scripts",
  ]);
  expect(
    await page.locator(".article-contents a[data-section]").allTextContents(),
  ).toEqual(names);
  const jump = page.locator('.article-contents a[href="#article-group-m"]');
  await jump.click();
  await expect(page.locator("#article-group-m")).toBeInViewport();
  await expect(jump).toHaveAttribute("aria-current", "location");
  await page.locator(".contents-top").click();
  await select.selectOption("name-desc");
  expect((await headings.allTextContents()).slice(0, 26)).toEqual(
    [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].reverse(),
  );
  await select.selectOption("modified-asc");
  await expect(headings).toHaveCount(0);
  await expect(page.locator(".article-contents a[data-section]")).toHaveCount(
    0,
  );
  await openExplorer(page);
  const calendar = page.getByRole("form", { name: "Article date range" });
  await expect(calendar).toBeVisible();
  await expect(calendar.locator(".date-filter-title")).toHaveText(
    "Modified date",
  );
  const compiledFolderCount = await page
    .locator(".page-listing > p")
    .textContent();
  const total = compiledFolderCount!.match(/^[\d,]+/u)![0];
  const from = calendar.getByLabel("From", { exact: true }),
    to = calendar.getByLabel("To", { exact: true });
  await from.fill("2020-01-10");
  await to.fill("2020-01-20");
  await expect
    .poll(() => articleListOrder(page))
    .toEqual(["articles/caimans", "articles/crocodile"]);
  await expect(calendar.locator(".date-filter-status")).toHaveText(
    `2 of ${total} articles.`,
  );
  await expect(page.locator(".page-listing > p")).toHaveText(
    compiledFolderCount!,
  );
  await to.fill("2020-01-10");
  await expect.poll(() => articleListOrder(page)).toEqual(["articles/caimans"]);
  await from.fill("2020-01-11");
  await expect(calendar.locator(".date-filter-status")).toHaveText(
    "Choose an end date on or after the start date.",
  );
  await from.fill("2020-01-15");
  await to.fill("2020-01-19");
  await expect(page.locator(".article-empty")).toHaveText(
    "No articles match this date range.",
  );
  await calendar.getByRole("button", { name: "Clear dates" }).click();
  await expect(from).toHaveValue("");
  await expect(to).toHaveValue("");
  await expect
    .poll(() => articleListOrder(page))
    .toEqual(await expectedOrder(page, "modified-asc"));
  await select.selectOption("created-desc");
  await expect(calendar.locator(".date-filter-title")).toHaveText(
    "Created date",
  );
  await from.fill("2019-02-02");
  await expect
    .poll(() => articleListOrder(page))
    .toEqual(["articles/culture", "articles/crocodile"]);
  await select.selectOption("name-asc");
  await expect(calendar).not.toBeVisible();
  await expect(page.locator(".page-listing .section-li")).toHaveCount(
    (await expectedOrder(page, "name-asc")).length,
  );
  await page.getByRole("link", { name: "Main page", exact: true }).click();
  await openExplorer(page);
  await expect(page.locator(".nav-show-more")).toHaveCount(1);
});

test("Browse entries retains filename A-Z through repeated SPA navigation", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("article-list-order", "created-desc"),
  );
  await page.goto("./articles/?sort=modified-desc");
  const select = page.getByRole("combobox", { name: "Sort articles" });
  await expect(select).toBeEnabled();
  const browse = page.getByRole("link", {
    name: "Browse entries",
    exact: true,
    includeHidden: true,
  });
  const openBrowse = async () => {
    await expect(browse).toHaveAttribute(
      "href",
      /^\/(?:knowledge\/)?articles\/\?sort=name-asc$/,
    );
    if (mobile(page))
      await browse.evaluate((link: HTMLAnchorElement) => link.click());
    else await browse.click();
    await expect(page).toHaveURL(/\/articles\/\?sort=name-asc$/);
    await expect(select).toBeEnabled();
    await expect(select).toHaveValue("name-asc");
    await expect
      .poll(() => articleListOrder(page))
      .toEqual(await expectedArticleList(page, "name-asc"));
    // This link was previously stripped to /articles/ by Quartz's URL rebasing.
    await expect(browse).toHaveAttribute(
      "href",
      /^\/(?:knowledge\/)?articles\/\?sort=name-asc$/,
    );
  };
  for (const mode of ["modified-asc", "created-desc", "name-desc"]) {
    await select.selectOption(mode);
    await openBrowse();
  }
  await select.selectOption("modified-desc");
  await page.getByRole("link", { name: "Main page", exact: true }).click();
  await expect(page.locator(".article-list-sort")).toHaveCount(0);
  await openBrowse();
  await page
    .locator(".page-listing .section-li .desc a.internal")
    .first()
    .click();
  await expect(page.locator(".article-list-sort")).toHaveCount(0);
  await openBrowse();
});

test("Recently updated is a plain label and its entries reopen on every reload", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "fileTree",
      JSON.stringify([
        { path: "articles/index", collapsed: true },
        { path: "articles", collapsed: true },
      ]),
    ),
  );
  await page.goto("./articles/culture");
  const explorer = page.locator(".explorer-panel");
  const group = page.locator(
    '.folder-container[data-folderpath="articles/index"]',
  );
  await expect(group).toHaveText("Recently updated");
  await expect(group.locator("a,button,svg")).toHaveCount(0);
  await expect(explorer).toHaveAttribute("open", "");
  await expect(
    page.locator(".explorer-content a.nav-file-title").first(),
  ).toBeVisible();
  await expect
    .poll(() => actualOrder(page))
    .toEqual((await expectedOrder(page, "modified-desc")).slice(0, 10));
  await explorer.locator(":scope > summary").click();
  await expect(explorer).not.toHaveAttribute("open", "");
  await page.reload();
  await expect(group).toHaveText("Recently updated");
  await expect(explorer).toHaveAttribute("open", "");
  await expect(
    page.locator(".explorer-content a.nav-file-title").first(),
  ).toBeVisible();
});

test("Top counts as content while empty Explorer closes automatically", async ({
  page,
}) => {
  await page.goto("./articles/?sort=name-asc");
  const select = page.getByRole("combobox", { name: "Sort articles" });
  await expect(select).toBeEnabled();
  const contents = page.locator(".contents-panel"),
    explorer = page.locator(".explorer-panel");
  // Graph navigation is real content. Remove it to exercise a truly empty panel.
  await expect(explorer.locator(".graph-view-link")).toHaveCount(1);
  await explorer
    .locator(".graph-navigation")
    .evaluate((element) => element.remove());
  await page.evaluate(() =>
    document.dispatchEvent(new Event("article-sections-changed")),
  );
  await expect(explorer).toHaveAttribute("data-empty", "true");
  await expect(explorer).not.toHaveAttribute("open", "");
  await openContents(page);
  await expect(contents).toHaveAttribute("open", "");
  await select.selectOption("modified-desc");
  await expect(contents).toHaveAttribute("data-empty", "false");
  await expect(contents).toHaveAttribute("open", "");
  await expect(page.locator(".contents-top")).toBeVisible();
  await expect(explorer).toHaveAttribute("open", "");
  await expect(page.locator(".article-date-filter")).toBeVisible();
  await select.selectOption("created-asc");
  await expect(explorer).toHaveAttribute("open", "");
  await select.selectOption("name-desc");
  await expect(explorer).not.toHaveAttribute("open", "");
  await expect(contents).toHaveAttribute("open", "");
  await contents.locator(":scope > summary").click();
  await select.selectOption("name-asc");
  await expect(contents).not.toHaveAttribute("open", "");
  const emptySlug = await page.evaluate(async () => {
    const index = await fetch(
      `${document.body.dataset.basepath ?? ""}/static/contentIndex.json`,
    ).then((r) => r.json());
    const entries = Object.entries(index) as [
      string,
      { content?: string; sortRanks?: object; links?: string[] },
    ][];
    return entries.find(
      ([slug, note]) =>
        note.sortRanks &&
        !note.content?.trim() &&
        !entries.some(([, source]) => source.links?.includes(slug)),
    )?.[0];
  });
  expect(emptySlug).toBeTruthy();
  await page.goto(`./${emptySlug}`);
  await expect(contents).toHaveAttribute("data-empty", "false");
  if (mobile(page)) await expect(contents).not.toHaveAttribute("open", "");
  else await expect(contents).toHaveAttribute("open", "");
  await openContents(page);
  await expect(page.locator(".contents-top")).toBeVisible();
  await expect(explorer).toHaveAttribute("open", "");
});

test("Graph view works through Explorer with local resources and normal navigation", async ({
  page,
}) => {
  const externalScripts: string[] = [],
    graphRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/static/graph/"))
      graphRequests.push(request.url());
    if (
      request.resourceType() === "script" &&
      !request.url().startsWith("http://127.0.0.1:")
    )
      externalScripts.push(request.url());
  });
  await page.goto("./articles/culture");
  expect(graphRequests).toEqual([]);
  await openExplorer(page);
  await expect(page.locator(".recently-updated-label")).toBeVisible();
  expect(
    await page.locator(".explorer-panel").evaluate((panel) => {
      const graph = panel.querySelector(".graph-view-link")!;
      const recent = panel.querySelector(".recently-updated-label")!;
      return !!(
        graph.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    }),
  ).toBe(true);
  await page.getByRole("link", { name: "Graph view", exact: true }).click();
  await expect(page).toHaveURL(/\/graph$/);
  const graph = page.locator(".graph-page");
  await expect(graph).toBeVisible();
  await expect(graph.locator("canvas")).toBeVisible({ timeout: 20000 });
  await page.reload();
  await expect(graph.locator("canvas")).toBeVisible({ timeout: 20000 });
  expect(
    graphRequests.some((url) => url.endsWith("/static/graph/d3.min.js")),
  ).toBe(true);
  expect(
    graphRequests.some((url) => url.endsWith("/static/graph/pixi.min.js")),
  ).toBe(true);
  const cfg = JSON.parse(
    (await graph.locator(".graph-container").getAttribute("data-cfg")) ?? "{}",
  );
  expect(cfg.depth).toBe(-1);
  await expect(
    graph.locator("select, .graph-note-browser, .graph-selected-note"),
  ).toHaveCount(0);
  await expect(
    page.getByText("Open a note with the keyboard", { exact: true }),
  ).toHaveCount(0);
  expect(externalScripts).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Main page", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/(?:knowledge\/)?$/);
});

test("landing notebook cards use neutral headings and borders", async ({
  page,
}) => {
  await page.goto("./");
  const title = page.locator(".highlight-cards h2 a").first();
  await expect(title).toBeVisible();
  const colors = await title.evaluate((element) => ({
    title: getComputedStyle(element).color,
    heading: getComputedStyle(document.querySelector("h1")!).color,
    border: getComputedStyle(element.closest("article")!).borderTopColor,
    link: getComputedStyle(document.querySelector(".encyclopedia-brand")!)
      .color,
  }));
  expect(colors.title).toBe(colors.heading);
  expect(colors.border).not.toBe("rgb(51, 102, 204)");
});

test("Graph gravity forms a circular cluster that fits the initial canvas", async ({
  page,
}) => {
  // Observe the real force simulation without exposing test hooks in production.
  await page.route("**/static/graph/d3.min.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `;{
      const original = window.d3.forceSimulation;
      window.d3.forceSimulation = (...args) => {
        const simulation = original(...args);
        window.__graphTestSimulation = simulation;
        return simulation;
      };
    }`,
    });
  });
  await page.goto("./graph");
  await expect(page.locator(".graph-page .graph-container canvas")).toBeVisible(
    { timeout: 20000 },
  );
  const layout = await page.evaluate(() => {
    const simulation = (window as any).__graphTestSimulation;
    simulation.stop().tick(200);
    const nodes = simulation.nodes() as { x: number; y: number }[];
    const canvas = document.querySelector<HTMLCanvasElement>(
      ".graph-page .graph-container canvas",
    )!;
    const zoom = (canvas as any).__zoom;
    const width = canvas.clientWidth,
      height = canvas.clientHeight;
    const bounds = nodes.reduce(
      (box, node) => [
        Math.min(box[0], node.x),
        Math.max(box[1], node.x),
        Math.min(box[2], node.y),
        Math.max(box[3], node.y),
      ],
      [Infinity, -Infinity, Infinity, -Infinity],
    );
    return {
      nodes: nodes.length,
      aspect: (bounds[1] - bounds[0]) / (bounds[3] - bounds[2]),
      left: zoom.applyX(bounds[0] + width / 2),
      right: zoom.applyX(bounds[1] + width / 2),
      top: zoom.applyY(bounds[2] + height / 2),
      bottom: zoom.applyY(bounds[3] + height / 2),
      width,
      height,
    };
  });
  expect(layout.nodes).toBeGreaterThan(0);
  expect(layout.aspect).toBeGreaterThan(0.8);
  expect(layout.aspect).toBeLessThan(1.25);
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(layout.width);
  expect(layout.bottom).toBeLessThanOrEqual(layout.height);
});

test("Graph expands inside the browser window and restores with button or Escape", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.route("**/static/graph/d3.min.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `;{
      const original=window.d3.forceSimulation;
      window.d3.forceSimulation=(...args)=>window.__resizeSimulation=original(...args);
    }`,
    });
  });
  await page.goto("./graph");
  const canvas = page.locator(".graph-page .graph-container canvas");
  const button = page.locator(".graph-expand-button");
  const dialog = page.getByRole("dialog", { name: "Expanded graph view" });
  await expect(canvas).toBeVisible({ timeout: 20000 });
  await expect(button).toHaveAttribute("aria-expanded", "false");
  const graphSession = await page.context().newCDPSession(page);
  await graphSession.send("Emulation.setCPUThrottlingRate", { rate: 2 });
  await page.evaluate(() => (window as any).__resizeSimulation.stop());
  const centered = () =>
    canvas.evaluate((element) => {
      const nodes = (window as any).__resizeSimulation.nodes();
      const bounds = nodes.reduce(
        (b: number[], n: any) => [
          Math.min(b[0], n.x),
          Math.max(b[1], n.x),
          Math.min(b[2], n.y),
          Math.max(b[3], n.y),
        ],
        [Infinity, -Infinity, Infinity, -Infinity],
      );
      const zoom = (element as any).__zoom;
      return Math.max(
        Math.abs(
          zoom.applyX((bounds[0] + bounds[1]) / 2 + element.clientWidth / 2) -
            element.clientWidth / 2,
        ),
        Math.abs(
          zoom.applyY((bounds[2] + bounds[3]) / 2 + element.clientHeight / 2) -
            element.clientHeight / 2,
        ),
      );
    });
  await button.scrollIntoViewIfNeeded();
  await button.focus();
  const initial = await page.evaluate(() => ({
    scroll: scrollY,
    overflow: document.documentElement.style.overflow,
    canvasHeight: document.querySelector<HTMLCanvasElement>(
      ".graph-container canvas",
    )!.clientHeight,
  }));
  await button.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(button).toHaveAccessibleName("Restore graph size");
  expect(await dialog.boundingBox()).toEqual({
    x: 0,
    y: 0,
    ...page.viewportSize()!,
  });
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  expect(
    await page.evaluate(() => document.documentElement.style.overflow),
  ).toBe("hidden");
  await expect
    .poll(() =>
      canvas.evaluate((element) => ({
        width: element.clientWidth,
        height: element.clientHeight,
      })),
    )
    .toEqual(page.viewportSize());
  await expect.poll(centered).toBeLessThan(1);
  await expect(button).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toBeFocused();
  expect(
    await page.evaluate(() => document.documentElement.style.overflow),
  ).toBe(initial.overflow);
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(initial.scroll, 0);
  await button.click();
  await expect(dialog).toBeVisible();
  await button.click();
  await expect(dialog).not.toBeVisible();
  await expect
    .poll(() => canvas.evaluate((element) => element.clientHeight))
    .toBe(initial.canvasHeight);
  await expect.poll(centered).toBeLessThan(1);
  // SPA cleanup must also restore scroll state when navigation occurs while expanded.
  await button.click();
  await expect(dialog).toBeVisible();
  await page.evaluate(() =>
    window.spaNavigate(
      new URL(
        document.body.dataset.basepath
          ? document.body.dataset.basepath + "/"
          : "/",
        location.origin,
      ),
    ),
  );
  await expect(page.locator(".graph-page")).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.style.overflow),
  ).toBe(initial.overflow);
  expect(await page.evaluate(() => !!document.querySelector(":modal"))).toBe(
    false,
  );
});

test("Graph hover fades opaque node colors and highlights neighbors", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.route("**/static/graph/d3.min.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `;{
      const original=window.d3.forceSimulation;
      window.d3.forceSimulation=(...args)=>window.__hoverSimulation=original(...args);
    }`,
    });
  });
  await page.route("**/static/graph/pixi.min.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `;{
      const original=window.PIXI.Application.prototype.init;
      window.PIXI.Application.prototype.init=async function(...args){const result=await original.apply(this,args);window.__hoverApplication=this;return result;};
    }`,
    });
  });
  await page.goto("./graph");
  const canvas = page.locator(".graph-page .graph-container canvas");
  await expect(canvas).toBeVisible({ timeout: 20000 });
  if (mobile(page)) await page.locator(".explorer-panel > summary").click();
  await canvas.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    (window as any).__hoverSimulation.stop().tick(200);
  });
  const scene = () =>
    page.evaluate(() => {
      const containers = (window as any).__hoverApplication.stage.children[0]
        .children;
      return {
        layers: containers.map((layer: any) => layer.label),
        drawOrder: containers[0].children.map((shape: any) => shape.zIndex),
        highlightedNodes: containers[0].children
          .filter(
            (shape: any) => shape.label !== "graph-edge" && shape.zIndex >= 3,
          )
          .map((node: any) => node.label),
        backgroundEdgeColors: containers[0].children
          .filter(
            (shape: any) => shape.label === "graph-edge" && shape.zIndex === 0,
          )
          .map((edge: any) => edge.context.strokeStyle.color),
        edgeOpacities: containers[0].children
          .filter((shape: any) => shape.label === "graph-edge")
          .map((edge: any) => edge.context.strokeStyle.alpha),
        highlightedEdgeColors: containers[0].children
          .filter(
            (shape: any) => shape.label === "graph-edge" && shape.zIndex === 2,
          )
          .map((edge: any) => edge.context.strokeStyle.color),
        highlightedEdges: containers[0].children.filter(
          (shape: any) => shape.label === "graph-edge" && shape.zIndex === 2,
        ).length,
        labels: containers[1].children
          .filter((label: any) => label.alpha > 0)
          .map((label: any) => label.text),
        nodes: containers[0].children
          .filter((shape: any) => shape.label !== "graph-edge")
          .map((node: any) => ({
            id: node.label,
            alpha: node.alpha,
            tint: node.tint,
          })),
      };
    });
  expect((await scene()).labels).toEqual([]);
  const measuredNode = (await scene()).nodes[0].id;
  const screenSizes = () =>
    page.evaluate((id) => {
      const graph = (window as any).__hoverApplication.stage.children[0];
      const shapes = graph.children[0].children;
      const title = (window as any).__hoverSimulation
        .nodes()
        .find((node: any) => node.id === id).text;
      const label = graph.children[1].children.find(
        (label: any) => label.text === title,
      );
      const node = shapes.find((shape: any) => shape.label === id);
      const edge = shapes.find((shape: any) => shape.label === "graph-edge");
      const transform = edge.worldTransform;
      return {
        diameter: node.getBounds().width,
        baseDiameter: node.getLocalBounds().width,
        titleHeight: label.getBounds().height,
        titleOpacity: label.alpha,
        zoom: (document.querySelector(".graph-container canvas") as any).__zoom
          .k,
        thickness:
          edge.context.strokeStyle.width * Math.hypot(transform.a, transform.b),
      };
    }, measuredNode);
  const settleZoom = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const canvas = document.querySelector(
            ".graph-container canvas",
          ) as any;
          let previous = canvas.__zoom.k,
            stable = 0,
            frame = 0;
          const timeout = setTimeout(() => {
            cancelAnimationFrame(frame);
            reject(new Error("Zoom did not settle"));
          }, 5000);
          const sample = () => {
            const next = canvas.__zoom.k;
            stable = next === previous ? stable + 1 : 0;
            previous = next;
            if (stable >= 3) {
              clearTimeout(timeout);
              resolve(next);
            } else frame = requestAnimationFrame(sample);
          };
          frame = requestAnimationFrame(sample);
        }),
    );
  const originalSizes = await screenSizes();
  expect(originalSizes.diameter).toBeGreaterThan(0);
  expect(originalSizes.thickness).toBeCloseTo(1, 2);
  const checkSizes = async () => {
    await expect
      .poll(async () => (await screenSizes()).diameter)
      .not.toBeCloseTo(originalSizes.diameter, 2);
    const current = await screenSizes();
    const zoomRatio = current.zoom / originalSizes.zoom;
    const diameterRatio = current.diameter / originalSizes.diameter;
    if (zoomRatio > 1) {
      expect(diameterRatio).toBeGreaterThan(1);
      expect(diameterRatio).toBeLessThan(zoomRatio);
    } else {
      expect(diameterRatio).toBeLessThan(1);
      expect(diameterRatio).toBeGreaterThan(zoomRatio);
    }
    await expect
      .poll(async () => (await screenSizes()).thickness)
      .toBeCloseTo(originalSizes.thickness, 2);
    const titleRatio = current.titleHeight / originalSizes.titleHeight;
    if (zoomRatio > 1) {
      expect(titleRatio).toBeGreaterThan(1);
      expect(titleRatio).toBeLessThan(zoomRatio);
    } else {
      expect(titleRatio).toBeLessThan(1);
      expect(titleRatio).toBeGreaterThan(zoomRatio);
    }
  };
  const box = (await canvas.boundingBox())!;
  const before = await canvas.evaluate((element) => (element as any).__zoom.k);
  const anchorPoint = {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
  const anchoredWorld = () =>
    canvas.evaluate((element, point) => {
      const bounds = element.getBoundingClientRect();
      return (element as any).__zoom.invert([
        point.x - bounds.left,
        point.y - bounds.top,
      ]);
    }, anchorPoint);
  const anchorBefore = await anchoredWorld();
  await page.evaluate(() => {
    const samples: { time: number; zoom: number }[] = [];
    (window as any).__momentumSamples = samples;
    const start = performance.now();
    const sample = () => {
      samples.push({
        time: performance.now() - start,
        zoom: (document.querySelector(".graph-container canvas") as any).__zoom
          .k,
      });
      if (performance.now() - start < 500) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.mouse.move(anchorPoint.x, anchorPoint.y);
  await page.mouse.wheel(0, -300);
  await expect
    .poll(() => canvas.evaluate((element) => (element as any).__zoom.k))
    .toBeGreaterThan(before);
  await settleZoom();
  const motion = await page.evaluate(
    () => (window as any).__momentumSamples as { time: number; zoom: number }[],
  );
  expect(
    new Set(
      motion.filter((sample) => sample.time > 100).map((sample) => sample.zoom),
    ).size,
  ).toBeGreaterThan(2);
  expect(
    motion.every((sample, i) => i === 0 || sample.zoom >= motion[i - 1].zoom),
  ).toBe(true);
  const anchorAfter = await anchoredWorld();
  expect(anchorAfter[0]).toBeCloseTo(anchorBefore[0], 5);
  expect(anchorAfter[1]).toBeCloseTo(anchorBefore[1], 5);
  await page.mouse.move(0, 0);
  await expect.poll(async () => (await scene()).labels).toEqual([]);
  await checkSizes();
  await page.mouse.move(0, 0);
  await expect.poll(async () => (await scene()).labels).toEqual([]);
  // The preceding zoom can briefly hover a node; let its color recovery finish.
  await page.waitForTimeout(250);
  const target = await page.evaluate(() => {
    const simulation = (window as any).__hoverSimulation,
      canvas = document.querySelector<HTMLCanvasElement>(
        ".graph-container canvas",
      )!,
      zoom = (canvas as any).__zoom,
      box = canvas.getBoundingClientRect();
    const links = simulation.force("link").links();
    const nodes = simulation.nodes();
    const node = nodes.find((node: any) => {
      const x = box.x + zoom.applyX(node.x + canvas.clientWidth / 2),
        y = box.y + zoom.applyY(node.y + canvas.clientHeight / 2);
      return (
        links.some(
          (link: any) =>
            link.source.id === node.id || link.target.id === node.id,
        ) &&
        x > box.left + 20 &&
        x < box.right - 20 &&
        y > Math.max(box.top + 60, 160) &&
        y < Math.min(box.bottom - 20, innerHeight - 20)
      );
    });
    if (!node) throw new Error("No visible connected graph node");
    const neighbors = new Set([node.id]);
    for (const link of links) {
      if (link.source.id === node.id) neighbors.add(link.target.id);
      if (link.target.id === node.id) neighbors.add(link.source.id);
    }
    return {
      title: node.text,
      neighbors: [...neighbors],
      x: box.x + zoom.applyX(node.x + canvas.clientWidth / 2),
      y: box.y + zoom.applyY(node.y + canvas.clientHeight / 2),
    };
  });
  const vertexGeometry = (ids: string[]) =>
    page.evaluate((ids) => {
      const app = (window as any).__hoverApplication;
      const graph = app.stage.children[0],
        shapes = graph.children[0].children,
        labels = graph.children[1].children;
      const links = (window as any).__hoverSimulation.force("link").links();
      return ids.map((id) => {
        const node = shapes.find((node: any) => node.label === id),
          label = labels.find((label: any) => label.label === id);
        const bounds = node.getBounds(),
          title = label.getBounds();
        return {
          id,
          diameter: bounds.width,
          localDiameter: node.getLocalBounds().width,
          nodeBottom: bounds.y + bounds.height,
          titleY: title.y,
          titleHeight: title.height,
          titleWidth: title.width,
          titleScale: label.scale.y,
          font: label.style.fontSize,
          degree: links.filter(
            (link: any) => link.source.id === id || link.target.id === id,
          ).length,
        };
      });
    }, ids);
  const firstId = target.neighbors[0];
  const firstIdle = (await vertexGeometry([firstId]))[0];
  expect(firstIdle.font).toBeCloseTo(3.024, 2);
  expect(firstIdle.titleY).toBeGreaterThan(firstIdle.nodeBottom);
  expect(
    firstIdle.localDiameter / (2 * (2 + Math.sqrt(firstIdle.degree))),
  ).toBeCloseTo(0.45, 3);
  const baseline = await scene();
  const outside = baseline.nodes.find(
    (node: any) => !target.neighbors.includes(node.id),
  )!;
  await page.evaluate((id) => {
    const samples: number[] = [];
    (window as any).__graphColorSamples = samples;
    const start = performance.now();
    const record = () => {
      const node = (
        window as any
      ).__hoverApplication.stage.children[0].children[0].children.find(
        (node: any) => node.label === id,
      );
      samples.push(node.tint);
      if (performance.now() - start < 700) requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  }, outside.id);
  await page.mouse.move(target.x, target.y);
  await expect.poll(async () => (await scene()).labels).toEqual([target.title]);
  await expect
    .poll(async () => {
      const current = await scene();
      return (
        current.nodes.find((node: any) => node.id === outside.id)!.tint !==
        outside.tint
      );
    })
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => new Set((window as any).__graphColorSamples).size),
    )
    .toBeGreaterThan(2);
  const highlightBlue = await page.evaluate(() => {
    const earlier = new (window as any).PIXI.Color(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--secondary")
        .trim(),
    ).toNumber();
    return earlier === 0x88a3e8 ? 0x577fd9 : 0x2c60cb;
  });
  await expect
    .poll(
      async () =>
        (await scene()).nodes.find(
          (node: any) => node.id === target.neighbors[0],
        )!.tint,
    )
    .toBe(highlightBlue);
  await expect
    .poll(async () =>
      (await scene()).highlightedEdgeColors.every(
        (color: number) => color === highlightBlue,
      ),
    )
    .toBe(true);
  const mutedEdge = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement),
      Color = (window as any).PIXI.Color;
    const background = new Color(
      css.getPropertyValue("--light").trim(),
    ).toNumber();
    return background === 0x101418 ? 0x212529 : 0xf1f2f4;
  });
  await expect
    .poll(async () =>
      (await scene()).backgroundEdgeColors.every(
        (color: number) => color === mutedEdge,
      ),
    )
    .toBe(true);
  expect((await scene()).backgroundEdgeColors.length).toBeGreaterThan(0);
  expect(
    (await scene()).edgeOpacities.every((alpha: number) => alpha === 1),
  ).toBe(true);
  const normalColors = new Map(
    baseline.nodes.map((node: any) => [node.id, node.tint]),
  );
  expect(
    (await scene()).nodes
      .filter(
        (node: any) =>
          target.neighbors.includes(node.id) && node.id !== target.neighbors[0],
      )
      .every((node: any) => node.tint === normalColors.get(node.id)),
  ).toBe(true);
  const state = await scene(),
    neighbors = new Set(target.neighbors);
  expect(state.nodes.some((node: any) => !neighbors.has(node.id))).toBe(true);
  expect(state.layers).toEqual(["graph-shapes", "graph-labels"]);
  expect(state.drawOrder).toEqual(
    [...state.drawOrder].sort((a: number, b: number) => a - b),
  );
  expect(new Set(state.drawOrder)).toEqual(new Set([0, 1, 2, 3, 4]));
  expect(new Set(state.highlightedNodes)).toEqual(neighbors);
  expect(state.highlightedEdges).toBeGreaterThan(0);
  expect(state.highlightedNodes.at(-1)).toBe(target.neighbors[0]);
  expect(
    state.nodes
      .filter((node: any) => neighbors.has(node.id))
      .map((node: any) => node.alpha),
  ).toEqual(target.neighbors.map(() => 1));
  expect(
    state.nodes
      .filter((node: any) => !neighbors.has(node.id))
      .every((node: any) => node.alpha === 1),
  ).toBe(true);
  await expect
    .poll(
      async () =>
        (await vertexGeometry([firstId]))[0].diameter / firstIdle.diameter,
    )
    .toBeCloseTo(1.06, 4);
  const firstHover = (await vertexGeometry([firstId]))[0];
  expect(firstHover.titleHeight).toBeCloseTo(firstIdle.titleHeight, 3);
  expect(firstHover.titleWidth).toBeCloseTo(firstIdle.titleWidth, 3);
  expect(firstHover.titleY).toBeGreaterThan(firstHover.nodeBottom);
  const firstTravel = firstHover.titleY - firstIdle.titleY;
  expect(firstTravel).toBeCloseTo(
    (1.5 * firstIdle.diameter) / firstIdle.localDiameter,
    2,
  );
  await page.mouse.move(0, 0);
  await expect
    .poll(async () => (await vertexGeometry([firstId]))[0].diameter)
    .toBeCloseTo(firstIdle.diameter, 4);
  const second = await page.evaluate(
    ({ firstId, diameter }) => {
      const app = (window as any).__hoverApplication,
        graph = app.stage.children[0];
      const canvas = document.querySelector(".graph-container canvas")!,
        box = canvas.getBoundingClientRect();
      for (const node of graph.children[0].children) {
        if (
          node.label === "graph-edge" ||
          node.label === firstId ||
          Math.abs(node.getLocalBounds().width - diameter) < 0.01
        )
          continue;
        const point = node.getGlobalPosition(),
          x = box.left + point.x,
          y = box.top + point.y;
        if (
          x < box.left + 20 ||
          x > box.right - 20 ||
          y < Math.max(box.top + 60, 160) ||
          y > Math.min(box.bottom - 20, innerHeight - 20)
        )
          continue;
        if (app.renderer.events.rootBoundary.hitTest(point.x, point.y) !== node)
          continue;
        return { id: node.label, x, y };
      }
      throw new Error("No second visible vertex of a different diameter");
    },
    { firstId, diameter: firstIdle.localDiameter },
  );
  const secondIdle = (await vertexGeometry([second.id]))[0];
  const diameterRatio = secondIdle.localDiameter / firstIdle.localDiameter;
  const nameRatio = secondIdle.titleScale / firstIdle.titleScale;
  expect(
    Math.pow(2, Math.log(nameRatio) / Math.log(diameterRatio)),
  ).toBeCloseTo(1.3, 3);
  if (diameterRatio > 1) {
    expect(nameRatio).toBeGreaterThan(1);
    expect(nameRatio).toBeLessThan(Math.sqrt(diameterRatio));
  } else {
    expect(nameRatio).toBeLessThan(1);
    expect(nameRatio).toBeGreaterThan(Math.sqrt(diameterRatio));
  }
  await page.mouse.move(second.x, second.y);
  await expect
    .poll(
      async () =>
        (await vertexGeometry([second.id]))[0].diameter / secondIdle.diameter,
    )
    .toBeCloseTo(1.06, 4);
  const secondHover = (await vertexGeometry([second.id]))[0];
  expect(secondHover.titleHeight).toBeCloseTo(secondIdle.titleHeight, 3);
  expect(secondHover.titleY - secondIdle.titleY).toBeCloseTo(firstTravel, 2);
  expect(secondHover.titleY).toBeGreaterThan(secondHover.nodeBottom);
  // No extra pointer event: moving nodes away must clear the hover state too.
  await page.evaluate(() => {
    for (const node of (window as any).__hoverSimulation.nodes()) {
      node.x += 5000;
      node.y += 5000;
    }
  });
  await expect.poll(async () => (await scene()).labels).toEqual([]);
  await expect
    .poll(async () => (await scene()).highlightedNodes.length)
    .toBe(0);
  expect((await scene()).highlightedEdges).toBe(0);
  await expect
    .poll(async () =>
      (await scene()).backgroundEdgeColors.every(
        (color: number) => color === baseline.backgroundEdgeColors[0],
      ),
    )
    .toBe(true);
  expect((await scene()).nodes.every((node: any) => node.alpha === 1)).toBe(
    true,
  );
  await expect
    .poll(async () => {
      const colors = new Map(
        (await scene()).nodes.map((node: any) => [node.id, node.tint]),
      );
      return baseline.nodes.every(
        (node: any) => colors.get(node.id) === node.tint,
      );
    })
    .toBe(true);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 600);
  await expect
    .poll(() => canvas.evaluate((element) => (element as any).__zoom.k))
    .toBeLessThan(before);
  await settleZoom();
  await checkSizes();
  // Reach the new extreme zoom limit through real wheel input.
  await page.mouse.wheel(0, -5000);
  await expect
    .poll(() => canvas.evaluate((element) => (element as any).__zoom.k))
    .toBe(50);
  const extreme = await screenSizes();
  expect(extreme.diameter / extreme.baseDiameter).toBeCloseTo(8.408, 3);
  await page.mouse.wheel(0, 500);
  await expect
    .poll(() => canvas.evaluate((element) => (element as any).__zoom.k))
    .toBeCloseTo(25, 2);
  await settleZoom();
  const halfDiameterRatio = (await screenSizes()).diameter / extreme.diameter;
  expect(halfDiameterRatio).toBeGreaterThan(0.5);
  expect(halfDiameterRatio).toBeLessThan(Math.SQRT1_2);
  const halfTitleRatio =
    (await screenSizes()).titleHeight / extreme.titleHeight;
  expect(halfTitleRatio).toBeGreaterThan(0.84);
  expect(halfTitleRatio).toBeLessThan(0.87);
  await expect
    .poll(async () => (await screenSizes()).thickness)
    .toBeCloseTo(originalSizes.thickness, 2);
  // Sample the rendered curve across normal and extreme zoom, including title reveal.
  await page.mouse.wheel(0, Math.log2(25) * 500);
  await settleZoom();
  await expect
    .poll(() => canvas.evaluate((element) => (element as any).__zoom.k))
    .toBeCloseTo(1, 2);
  const scales = [await screenSizes()];
  expect(scales[0].diameter / scales[0].baseDiameter).toBeCloseTo(1, 3);
  for (const zoom of [2, 4, 8, 16, 32, 50]) {
    await page.mouse.wheel(0, -500);
    await settleZoom();
    const size = await screenSizes();
    expect(size.zoom).toBeCloseTo(zoom, 2);
    scales.push(size);
    const previous = scales[scales.length - 2];
    const titleGrowth = size.titleHeight / previous.titleHeight;
    expect(titleGrowth).toBeGreaterThan(1);
    expect(titleGrowth).toBeLessThan(size.zoom / previous.zoom);
    expect(size.thickness).toBeCloseTo(1, 2);
  }
  const growth = scales
    .slice(1)
    .map(
      (size, i) =>
        Math.log(size.diameter / scales[i].diameter) /
        Math.log(size.zoom / scales[i].zoom),
    );
  expect(growth[0]).toBeGreaterThan(0.49);
  expect(growth[0]).toBeLessThan(0.6);
  expect(growth.at(-1)!).toBeGreaterThan(0.65);
  expect(growth.at(-1)!).toBeLessThan(0.75);
  for (let i = 1; i < growth.length; i++) {
    expect(growth[i]).toBeGreaterThanOrEqual(growth[i - 1] - 0.001);
    expect(growth[i] - growth[i - 1]).toBeLessThan(0.2);
  }
  expect(scales[2].titleOpacity).toBeCloseTo(0, 8);
  expect(scales[3].titleOpacity).toBeGreaterThan(0);
  expect(scales[3].titleOpacity).toBeLessThan(scales[4].titleOpacity);
  expect(scales[4].titleOpacity).toBeLessThan(scales[5].titleOpacity);
  expect(scales[5].titleOpacity).toBeCloseTo(1, 8);
  // A direction reversal should discard the pending tail, and reduced motion should settle directly.
  await page.mouse.wheel(0, 300);
  await expect
    .poll(() => canvas.evaluate((element) => (element as any).__zoom.k))
    .toBeLessThan(50);
  const reversing = await canvas.evaluate(
    (element) => (element as any).__zoom.k,
  );
  await page.mouse.wheel(0, -100);
  await settleZoom();
  expect(
    await canvas.evaluate((element) => (element as any).__zoom.k),
  ).toBeGreaterThan(reversing);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.mouse.wheel(0, 500);
  await settleZoom();
  const reduced = await canvas.evaluate((element) => (element as any).__zoom.k);
  await page.waitForTimeout(150);
  expect(await canvas.evaluate((element) => (element as any).__zoom.k)).toBe(
    reduced,
  );
  await page.mouse.move(0, 0);
});

test.describe("Graph rendering quality", () => {
  test.use({ deviceScaleFactor: 2 });
  test("names and analytic circles stay sharp and aligned at extreme zoom", async ({
    page,
  }, testInfo) => {
    test.setTimeout(60000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.route("**/static/contentIndex.json", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          "articles/quality": {
            slug: "articles/quality",
            title: "English sample text",
            content: "",
            tags: [],
            links: [
              "articles/japanese",
              "articles/distant",
              "articles/reference",
            ],
          },
          "articles/japanese": {
            slug: "articles/japanese",
            title: "日本語の見出し",
            content: "",
            tags: [],
            links: ["articles/quality"],
          },
          "articles/distant": {
            slug: "articles/distant",
            title: "Offscreen title",
            content: "",
            tags: [],
            links: [],
          },
          "articles/reference": {
            slug: "articles/reference",
            title: "Reference name",
            content: "",
            tags: [],
            links: [],
          },
          "articles/narrow": {
            slug: "articles/narrow",
            title: "I",
            content: "",
            tags: [],
            links: [],
          },
          "articles/overhang": {
            slug: "articles/overhang",
            title: "j’",
            content: "",
            tags: [],
            links: [],
          },
          "articles/multiline": {
            slug: "articles/multiline",
            title: "A much wider first line\nI",
            content: "",
            tags: [],
            links: [],
          },
          "articles/spaced": {
            slug: "articles/spaced",
            title: "  Spaced title  ",
            content: "",
            tags: [],
            links: [],
          },
        }),
      }),
    );
    await page.route("**/static/graph/d3.min.js", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          `;{
        const zoom=window.d3.zoom,simulation=window.d3.forceSimulation;
        window.d3.zoom=(...args)=>window.__qualityZoom=zoom(...args);
        window.d3.forceSimulation=(...args)=>window.__qualitySimulation=simulation(...args);
      }`,
      });
    });
    await page.route("**/static/graph/pixi.min.js", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          `;{
        const init=window.PIXI.Application.prototype.init;
        window.PIXI.Application.prototype.init=async function(...args){const result=await init.apply(this,args);window.__qualityApp=this;return result;};
      }`,
      });
    });
    await page.goto("./graph");
    const canvas = page.locator(".graph-page .graph-container canvas");
    await expect(canvas).toBeVisible({ timeout: 20000 });
    await page.evaluate(() => {
      const sim = (window as any).__qualitySimulation;
      sim.stop();
      for (const [index, node] of sim.nodes().entries()) {
        node.x =
          node.id === "articles/quality"
            ? 0
            : node.id === "articles/japanese"
              ? 2000
              : (index + 1) * 4000;
        node.y = 0;
      }
    });
    const focus = async (id: string, zoom: number) => {
      await page.evaluate(
        ({ id, zoom }) => {
          const app = (window as any).__qualityApp,
            d3 = (window as any).d3,
            view = app.canvas;
          const label = app.stage.children[0].children[1].children.find(
            (label: any) => label.label === id,
          );
          const point = label.position;
          d3.select(view).call(
            (window as any).__qualityZoom.transform,
            d3.zoomIdentity
              .translate(
                view.clientWidth / 2 - point.x * zoom,
                view.clientHeight / 2 - point.y * zoom,
              )
              .scale(zoom),
          );
        },
        { id, zoom },
      );
    };
    const quality = (id: string) =>
      page.evaluate((id) => {
        const app = (window as any).__qualityApp,
          canvas = app.canvas;
        const label = app.stage.children[0].children[1].children.find(
          (label: any) => label.label === id,
        );
        const zoom = canvas.__zoom.k,
          scale = label.scale.y * zoom;
        const texture =
          app.renderer.renderPipes.text._gpuText[label.uid]?.texture;
        let horizontalError = Infinity,
          gapInEms = Infinity;
        if (texture) {
          const gpuText = app.renderer.renderPipes.text._gpuText[label.uid];
          const resolution = texture.source.resolution,
            frame = texture.frame;
          const width = Math.round(frame.width * resolution),
            height = Math.round(frame.height * resolution);
          const pixels = texture.source.resource
            .getContext("2d")
            .getImageData(
              Math.round(frame.x * resolution),
              Math.round(frame.y * resolution),
              width,
              height,
            ).data;
          let left = width,
            right = -1,
            top = height;
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              if (pixels[(y * width + x) * 4 + 3]) {
                left = Math.min(left, x);
                right = Math.max(right, x);
                top = Math.min(top, y);
              }
            }
          const node = app.stage.children[0].children[0].children.find(
            (shape: any) => shape.label === id,
          );
          const position = label.getGlobalPosition(),
            center = node.getGlobalPosition();
          const bounds = gpuText.batchableSprite.bounds;
          horizontalError =
            position.x +
            (bounds.minX + (left + right + 1) / (2 * resolution)) * scale -
            center.x;
          const inkTop = position.y + (bounds.minY + top / resolution) * scale;
          gapInEms =
            (inkTop - node.getBounds().maxY) / (label.style.fontSize * scale);
        }
        return {
          horizontalError,
          gapInEms,
          visible: label.renderable,
          alpha: label.alpha,
          resolution: label.resolution,
          required: scale * devicePixelRatio,
          textureResolution: texture?.source.resolution ?? 0,
          pixelHeight: texture?.source.pixelHeight ?? 0,
          height: label.getBounds().height,
          font: label.style.fontSize,
          screenFont: label.style.fontSize * scale,
        };
      }, id);
    const circleQuality = (id: string) =>
      page.evaluate(async (id) => {
        const app = (window as any).__qualityApp,
          pixi = (window as any).PIXI;
        const circle = app.stage.children[0].children[0].children.find(
          (shape: any) => shape.label === id,
        );
        const bounds = circle.getBounds(),
          resolution = app.renderer.resolution;
        const { pixels, width, height } = app.renderer.extract.pixels({
          target: app.stage,
          resolution,
          frame: new pixi.Rectangle(
            bounds.x - 2,
            bounds.y - 2,
            bounds.width + 4,
            bounds.height + 4,
          ),
        });
        const radius = (bounds.width * resolution) / 2;
        const cx = 2 * resolution + radius,
          cy = 2 * resolution + (bounds.height * resolution) / 2;
        // Interpolate around pixel centers to measure the actual GPU-drawn contour.
        const alpha = (x: number, y: number) => {
          x -= 0.5;
          y -= 0.5;
          const ix = Math.floor(x),
            iy = Math.floor(y),
            fx = x - ix,
            fy = y - iy;
          const at = (dx: number, dy: number) =>
            pixels[((iy + dy) * width + ix + dx) * 4 + 3] / 255;
          return (
            at(0, 0) * (1 - fx) * (1 - fy) +
            at(1, 0) * fx * (1 - fy) +
            at(0, 1) * (1 - fx) * fy +
            at(1, 1) * fx * fy
          );
        };
        const errors: number[] = [];
        // Offset the rays from the horizontal graph edges beneath the circles.
        for (let angle = 7.5; angle < 360; angle += 15) {
          const radians = (angle * Math.PI) / 180;
          let low = radius - 2,
            high = radius + 2;
          for (let i = 0; i < 12; i++) {
            const distance = (low + high) / 2;
            if (
              alpha(
                cx + Math.cos(radians) * distance,
                cy + Math.sin(radians) * distance,
              ) > 0.5
            )
              low = distance;
            else high = distance;
          }
          errors.push(Math.abs((low + high) / 2 - radius));
        }
        return {
          image: await app.renderer.extract.base64({
            target: app.stage,
            resolution,
            frame: new pixi.Rectangle(
              bounds.x - 2,
              bounds.y - 2,
              bounds.width + 4,
              bounds.height + 4,
            ),
          }),
          pipe: circle.renderPipeId,
          vertices: circle.geometry.positions.length / 2,
          triangles: circle.geometry.indices.length / 3,
          centerAlpha: alpha(cx, cy),
          maxContourError: Math.max(...errors),
          batches:
            app.renderer.renderPipes.batch._activeBatches["graph-circle"]
              .batchIndex,
        };
      }, id);
    // One connection gives the reference vertex-size factor of 1. Measure the
    // actual scene scale after camera zoom, including when labels are hidden.
    const fontCurve: { zoom: number; size: number }[] = [];
    for (const zoom of [0.15, 1, 2, 4, 8, 16, 20, 32, 45, 50]) {
      await focus("articles/reference", zoom);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
      fontCurve.push({
        zoom,
        size: (await quality("articles/reference")).screenFont,
      });
    }
    for (const sample of fontCurve.slice(0, 3))
      expect(sample.size).toBeCloseTo(8, 2);
    expect(fontCurve.find((sample) => sample.zoom === 32)!.size).toBeCloseTo(
      8.316,
      2,
    );
    expect(fontCurve.at(-1)!.size).toBeCloseTo(9.514, 2);
    const fontGrowth = fontCurve
      .slice(1)
      .map(
        (sample, i) =>
          Math.log(sample.size / fontCurve[i].size) /
          Math.log(sample.zoom / fontCurve[i].zoom),
      );
    expect(fontGrowth[0]).toBeLessThan(0.001);
    expect(fontGrowth.at(-1)!).toBeGreaterThan(0.44);
    expect(fontGrowth.at(-1)!).toBeLessThan(0.5);
    for (let i = 1; i < fontGrowth.length; i++) {
      expect(fontGrowth[i]).toBeGreaterThanOrEqual(fontGrowth[i - 1]);
      expect(fontGrowth[i] - fontGrowth[i - 1]).toBeLessThan(0.4);
    }
    // Normal zoom and high zoom must keep the same font styling and layout rules.
    await focus("articles/quality", 1);
    const normalFont = (await quality("articles/quality")).font;
    for (const id of [
      "articles/quality",
      "articles/japanese",
      "articles/narrow",
      "articles/overhang",
      "articles/multiline",
      "articles/spaced",
    ]) {
      for (const zoom of [16, 50]) {
        // The below-node offset changes with zoom; center again after that update.
        await focus(id, zoom);
        await page.waitForTimeout(80);
        await focus(id, zoom);
        await expect
          .poll(async () => {
            const state = await quality(id);
            return (
              state.visible &&
              state.alpha > 0 &&
              state.resolution >= state.required &&
              state.textureResolution >= state.required &&
              state.pixelHeight >= state.height * 2
            );
          })
          .toBe(true);
        expect((await quality(id)).font).toBe(normalFont);
        expect(Math.abs((await quality(id)).horizontalError)).toBeLessThan(
          0.01,
        );
        expect((await quality(id)).gapInEms).toBeCloseTo(0.7, 3);
        const circle = await circleQuality(id);
        await (
          await import("node:fs/promises")
        ).writeFile(
          testInfo.outputPath("extreme-zoom-circle.png"),
          Buffer.from(circle.image.split(",")[1], "base64"),
        );
        expect(circle.pipe).toBe("graph-circle");
        expect(circle.vertices).toBe(4);
        expect(circle.triangles).toBe(2);
        expect(circle.centerAlpha).toBeGreaterThan(0.99);
        expect(circle.maxContourError).toBeLessThan(0.75);
        expect(circle.batches).toBeLessThanOrEqual(2);
      }
    }
    await canvas.screenshot({ path: testInfo.outputPath("extreme-zoom.png") });
    const offscreen = await quality("articles/distant");
    expect(offscreen.visible).toBe(false);
    expect(offscreen.resolution).toBeLessThanOrEqual(8);
    await focus("articles/quality", 1);
    await page.waitForTimeout(80);
    await focus("articles/quality", 1);
    expect((await quality("articles/quality")).font).toBe(normalFont);
    // Dispose GPU resources on SPA navigation, then create a fresh working graph.
    await page.evaluate(() =>
      window.spaNavigate(
        new URL((document.body.dataset.basepath || "") + "/", location.origin),
      ),
    );
    await expect(page.locator(".graph-page")).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as any).__qualityApp.renderer),
    ).toBeNull();
    await page.evaluate(() =>
      window.spaNavigate(
        new URL(
          (document.body.dataset.basepath || "") + "/graph",
          location.origin,
        ),
      ),
    );
    await expect(canvas).toBeVisible({ timeout: 20000 });
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.values(
            (window as any).__qualityApp.renderer.renderPipes.batch
              ._activeBatches,
          ).some(
            (batch: any) =>
              batch.name === "graph-circle" && batch.batchIndex > 0,
          ),
        ),
      )
      .toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe("Graph pinch sensitivity", () => {
  test.use({ hasTouch: true });
  test("pinch sensitivity tapers smoothly at both extremes", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/static/contentIndex.json", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          "articles/pinch": {
            title: "Pinch",
            content: "",
            tags: [],
            links: [],
          },
        }),
      }),
    );
    await page.route("**/static/graph/d3.min.js", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          `;{
        const zoom=window.d3.zoom;
        window.d3.zoom=(...args)=>window.__pinchZoom=zoom(...args);
      }`,
      });
    });
    await page.goto("./graph");
    const canvas = page.locator(".graph-page .graph-container canvas");
    await expect(canvas).toBeVisible({ timeout: 20000 });
    if (mobile(page)) await page.locator(".explorer-panel > summary").click();
    await canvas.scrollIntoViewIfNeeded();
    const setZoom = (scale: number) =>
      canvas.evaluate((element, scale) => {
        const d3 = (window as any).d3;
        d3.select(element).call(
          (window as any).__pinchZoom.transform,
          d3.zoomIdentity.translate(30, 40).scale(scale),
        );
      }, scale);
    const zoom = () => canvas.evaluate((element) => (element as any).__zoom.k);
    const wheel = (deltaY: number, pinch = true) =>
      canvas.evaluate(
        (element, { deltaY, pinch }) => {
          const box = element.getBoundingClientRect();
          element.dispatchEvent(
            new WheelEvent("wheel", {
              deltaY,
              ctrlKey: pinch,
              bubbles: true,
              cancelable: true,
              clientX: Math.round(box.left + box.width / 2),
              clientY: Math.round(box.top + box.height / 2),
            }),
          );
        },
        { deltaY, pinch },
      );
    const worldCenter = () =>
      canvas.evaluate((element) => {
        const canvas = element as HTMLCanvasElement & { __zoom: any };
        const bounds = canvas.getBoundingClientRect();
        return canvas.__zoom.invert([
          Math.round(bounds.left + bounds.width / 2) - bounds.left,
          Math.round(bounds.top + bounds.height / 2) - bounds.top,
        ]);
      });
    const gain: number[] = [];
    for (const scale of [0.15, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 50]) {
      await setZoom(scale);
      const anchor = await worldCenter(),
        direction = scale <= 8 ? -1 : 1;
      await wheel(direction * 2);
      gain.push(Math.abs(Math.log((await zoom()) / scale)) / (0.04 * Math.LN2));
      const after = await worldCenter();
      expect(after[0]).toBeCloseTo(anchor[0], 7);
      expect(after[1]).toBeCloseTo(anchor[1], 7);
    }
    expect(gain[0]).toBeGreaterThan(0.004);
    expect(gain[0]).toBeLessThan(0.006);
    expect(gain.at(-1)!).toBeGreaterThan(0.65);
    expect(gain.at(-1)!).toBeLessThan(0.7);
    expect(gain[6]).toBeGreaterThan(0.99);
    for (let i = 1; i <= 6; i++) expect(gain[i]).toBeGreaterThan(gain[i - 1]);
    for (let i = 7; i < gain.length; i++)
      expect(gain[i]).toBeLessThan(gain[i - 1]);

    // Mouse-wheel increments retain their existing speed, including at extremes.
    for (const scale of [0.4, 8, 40]) {
      await setZoom(scale);
      await wheel(-50, false);
      expect((await zoom()) / scale).toBeCloseTo(Math.pow(2, 0.1), 7);
    }
    // A single large pinch and a sequence of small events follow the same curve.
    await setZoom(0.4);
    await wheel(-160);
    const batched = await zoom();
    await setZoom(0.4);
    for (let i = 0; i < 40; i++) await wheel(-4);
    expect((await zoom()) / batched).toBeCloseTo(1, 3);
    // Both endpoints remain reachable, with no accumulated overshoot on reversal.
    await wheel(-10000);
    expect(await zoom()).toBe(50);
    await wheel(-20);
    expect(await zoom()).toBe(50);
    await wheel(2);
    expect(await zoom()).toBeLessThan(50);
    await wheel(10000);
    expect(await zoom()).toBe(0.15);
    await wheel(20);
    expect(await zoom()).toBe(0.15);
    await wheel(-2);
    expect(await zoom()).toBeGreaterThan(0.15);

    const touch = (type: string, distance: number, fingers = 2, offset = 0) =>
      canvas.evaluate(
        (element, { type, distance, fingers, offset }) => {
          const box = element.getBoundingClientRect();
          const points = [0, 1].map(
            (identifier) =>
              new Touch({
                identifier,
                target: element,
                clientX:
                  Math.round(box.left + box.width / 2) +
                  ((identifier ? 1 : -1) * distance) / 2 +
                  offset,
                clientY: Math.round(box.top + box.height / 2),
              }),
          );
          const touches = points.slice(0, fingers);
          element.dispatchEvent(
            new TouchEvent(type, {
              touches,
              targetTouches: touches,
              changedTouches:
                type === "touchend" ? points.slice(fingers) : touches,
              bubbles: true,
              cancelable: true,
            }),
          );
        },
        { type, distance, fingers, offset },
      );
    // Native touchscreen pinch follows the same sensitivity as trackpad pinch.
    for (const scale of [0.4, 8, 40]) {
      await setZoom(scale);
      await wheel(-Math.log(1.1) / (0.02 * Math.LN2));
      const trackpad = await zoom();
      await setZoom(scale);
      const anchor = await worldCenter();
      await touch("touchstart", 40);
      await touch("touchmove", 44);
      expect(await zoom()).toBeCloseTo(trackpad, 7);
      const after = await worldCenter();
      expect(after[0]).toBeCloseTo(anchor[0], 7);
      expect(after[1]).toBeCloseTo(anchor[1], 7);
      // Parallel movement pans without altering zoom; one-finger pan remains usable.
      await touch("touchmove", 44, 2, 8);
      expect(await zoom()).toBeCloseTo(trackpad, 7);
      await touch("touchend", 44, 1, 8);
      const beforePan = await canvas.evaluate(
        (element) => (element as any).__zoom.x,
      );
      await touch("touchmove", 44, 1, 18);
      expect(
        await canvas.evaluate((element) => (element as any).__zoom.x),
      ).toBeCloseTo(beforePan + 10, 5);
      await touch("touchend", 44, 0, 18);
    }
    // Touchscreen gestures stop at the same earlier limits and reverse immediately.
    for (const [limit, outward] of [
      [0.15, 36],
      [50, 44],
    ]) {
      await setZoom(limit);
      await touch("touchstart", 40);
      await touch("touchmove", outward);
      expect(await zoom()).toBeCloseTo(limit, 8);
      await touch("touchmove", 40);
      if (limit === 50) expect(await zoom()).toBeLessThan(limit);
      else expect(await zoom()).toBeGreaterThan(limit);
      await touch("touchend", 40, 0);
    }
    // Trackpad pinch retains the existing smooth momentum when motion is enabled.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await setZoom(8);
    await wheel(-20);
    const immediate = await zoom();
    await expect.poll(zoom).toBeGreaterThan(immediate);
    await page.waitForTimeout(1200);
    const settled = await zoom();
    expect(settled).toBeGreaterThan(8);
    await page.waitForTimeout(150);
    expect(await zoom()).toBe(settled);
  });
});
