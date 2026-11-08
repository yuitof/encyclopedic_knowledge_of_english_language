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
  await expect(
    page.locator(
      '.folder-container[data-folderpath="articles/index"] + .folder-outer > ul > li:last-child > a',
    ),
  ).toHaveText("Show more");
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
  await expect(page.locator(".nav-show-more")).toHaveCount(1);
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
            element.lastElementChild!.getBoundingClientRect().bottom,
        ),
      ),
    ).toBeLessThan(2);
  }
  await page.mouse.move(
    page.viewportSize()!.width / 2,
    page.viewportSize()!.height - 100,
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
  for (const [mode, label] of articleModes) {
    const expected = await expectedArticleList(page, mode);
    orders.set(mode, expected);
    await select.selectOption(mode);
    await expect.poll(() => articleListOrder(page)).toEqual(expected);
    await expect(page.locator("#article-sort-status")).toHaveText(
      `Sorted by ${label}.`,
    );
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
    await expect(
      staticPage.getByRole("combobox", { name: "Sort articles" }),
    ).toBeDisabled();
    await expect(
      staticPage.locator(".article-list-sort noscript"),
    ).toHaveJSProperty(
      "textContent",
      "Enable JavaScript to change the article order.",
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
    for (const note of Object.values(index) as any[])
      if (note.sortDetails)
        note.sortDetails = {
          ...note.sortDetails,
          modified: null,
          created: null,
        };
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
  const from = calendar.getByLabel("From", { exact: true }),
    to = calendar.getByLabel("To", { exact: true });
  await from.fill("2020-01-10");
  await to.fill("2020-01-20");
  await expect
    .poll(() => articleListOrder(page))
    .toEqual(["articles/caimans", "articles/crocodile"]);
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

test("empty Contents and Explorer close automatically and reopen when content appears", async ({
  page,
}) => {
  await page.goto("./articles/?sort=name-asc");
  const select = page.getByRole("combobox", { name: "Sort articles" });
  await expect(select).toBeEnabled();
  const contents = page.locator(".contents-panel"),
    explorer = page.locator(".explorer-panel");
  await expect(explorer).toHaveAttribute("data-empty", "true");
  await expect(explorer).not.toHaveAttribute("open", "");
  await expect(contents).toHaveAttribute("open", "");
  await select.selectOption("modified-desc");
  await expect(contents).toHaveAttribute("data-empty", "true");
  await expect(contents).not.toHaveAttribute("open", "");
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
  await expect(contents).toHaveAttribute("data-empty", "true");
  await expect(contents).not.toHaveAttribute("open", "");
  await expect(page.locator(".contents-top")).toHaveCount(1);
  await expect(explorer).toHaveAttribute("open", "");
});
