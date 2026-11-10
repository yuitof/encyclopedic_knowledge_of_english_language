import { test, expect, type Page } from "@playwright/test";

async function prepareGraph(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem("graph-visited", JSON.stringify(["articles/alpha"]));
    localStorage.setItem(
      "reading-appearance",
      JSON.stringify({ color: "light" }),
    );
  });
  await page.route("**/static/contentIndex.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        Object.fromEntries(
          [
            ["articles/alpha", ["articles/beta", "articles/gamma"]],
            ["articles/beta", ["articles/delta"]],
            ["articles/gamma", ["articles/delta"]],
            ["articles/delta", []],
            ["graph", []],
          ].map(([slug, links]) => [
            slug as string,
            { slug, title: slug, links, tags: [], content: "" },
          ]),
        ),
      ),
    }),
  );
  await page.route("**/static/graph/d3.min.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `;{
      const simulation=window.d3.forceSimulation,zoom=window.d3.zoom;
      window.d3.forceSimulation=(...args)=>window.__themeSimulation=simulation(...args);
      window.d3.zoom=(...args)=>window.__themeZoom=zoom(...args);
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
      window.__themeApps=[];
      window.PIXI.Application.prototype.init=async function(...args){
        const result=await init.apply(this,args);window.__themeApp=this;window.__themeApps.push(this);return result;
      };
    }`,
    });
  });
  await page.goto("./graph");
  const canvas = page.locator(".graph-page canvas");
  await expect(canvas).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) <= 800)
    await page.locator(".explorer-panel > summary").click();
  await canvas.scrollIntoViewIfNeeded();
  await arrange(page);
  return { errors, canvas };
}

async function arrange(page: Page) {
  await page.locator(".graph-page canvas").scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const w = window as any,
      app = w.__themeApp;
    w.__themeSimulation.stop();
    for (const [i, node] of w.__themeSimulation.nodes().entries()) {
      node.x = [-60, 60, -60, 60, 0][i];
      node.y = [-55, -55, 55, 55, 90][i];
    }
    w.d3.select(app.canvas).call(w.__themeZoom.transform, w.d3.zoomIdentity);
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(180);
}

const scene = (page: Page) =>
  page.evaluate(() => {
    const app = (window as any).__themeApp;
    const shapes = app?.stage?.children[0]?.children[0]?.children ?? [];
    return {
      nodes: shapes
        .filter((s: any) => s.label !== "graph-edge")
        .map((s: any) => ({ id: s.label, tint: s.tint, z: s.zIndex })),
      edges: shapes
        .filter((s: any) => s.label === "graph-edge")
        .map((s: any) => ({ color: s.context.strokeStyle.color, z: s.zIndex })),
    };
  });

async function hover(page: Page, id: string) {
  const point = await page.evaluate((id) => {
    const app = (window as any).__themeApp;
    const node = app.stage.children[0].children[0].children.find(
      (s: any) => s.label === id,
    );
    const position = node.getGlobalPosition(),
      box = app.canvas.getBoundingClientRect();
    return { x: box.x + position.x, y: box.y + position.y };
  }, id);
  await page.mouse.move(point.x, point.y);
  await expect
    .poll(
      async () => (await scene(page)).nodes.find((n: any) => n.id === id)?.tint,
    )
    .toBe(0x577fd9);
}

// Extract the actual mixed circle/edge render, rather than only checking the
// Graphics stroke properties, which can remain correct while its batch fails.
async function edgePixels(page: Page) {
  return page.evaluate(() => {
    const app = (window as any).__themeApp,
      pixi = (window as any).PIXI;
    const graph = app.stage.children[0];
    const nodes = graph.children[0].children;
    const a = nodes
      .find((s: any) => s.label === "articles/alpha")
      .getGlobalPosition();
    const b = nodes
      .find((s: any) => s.label === "articles/beta")
      .getGlobalPosition();
    const { pixels } = app.renderer.extract.pixels({
      target: app.stage,
      resolution: 1,
      frame: new pixi.Rectangle(
        Math.floor((a.x + b.x) / 2) - 3,
        Math.floor((a.y + b.y) / 2) - 3,
        6,
        6,
      ),
    });
    return Array.from(pixels as Uint8Array).filter(
      (_value, i) => i % 4 === 3 && pixels[i] > 0,
    ).length;
  });
}

test("visited and current graph vertices stay neutral before and after hover", async ({
  page,
}) => {
  const { errors } = await prepareGraph(page);
  const neutral = 0x101418;
  await expect
    .poll(async () => (await scene(page)).nodes.map((n: any) => n.tint))
    .toEqual(Array(5).fill(neutral));
  await hover(page, "articles/alpha");
  await page.mouse.move(0, 0);
  await expect
    .poll(async () => (await scene(page)).nodes.map((n: any) => n.tint))
    .toEqual(Array(5).fill(neutral));
  expect(errors).toEqual([]);
});

test("theme switches preserve rendered edges and repeated hover recovery", async ({
  page,
}) => {
  test.setTimeout(60000);
  const { errors, canvas } = await prepareGraph(page);
  const applications = await page.evaluate(
    () => (window as any).__themeApps.length,
  );
  expect(await edgePixels(page)).toBeGreaterThan(0);
  for (const theme of ["dark", "light", "dark", "light"]) {
    await page
      .locator(`input[name="appearance-color"][value="${theme}"]`)
      .check();
    await expect(page.locator("html")).toHaveAttribute("saved-theme", theme);
    await expect(canvas).toHaveCount(1);
    await arrange(page);
    const neutral = theme === "dark" ? 0xf8f9fa : 0x101418;
    await expect
      .poll(async () => (await scene(page)).nodes.map((n: any) => n.tint))
      .toEqual(Array(5).fill(neutral));
    expect(await page.evaluate(() => (window as any).__themeApps.length)).toBe(
      applications,
    );
    for (const id of ["articles/alpha", "articles/beta", "articles/alpha"]) {
      await hover(page, id);
      await expect.poll(() => edgePixels(page)).toBeGreaterThan(0);
      await page.mouse.move(0, 0);
      await expect
        .poll(async () =>
          (await scene(page)).edges.every((e: any) => e.z === 0),
        )
        .toBe(true);
      await expect.poll(() => edgePixels(page)).toBeGreaterThan(0);
      await expect
        .poll(async () => (await scene(page)).nodes.map((n: any) => n.tint))
        .toEqual(Array(5).fill(neutral));
    }
  }
  await page
    .locator('input[name="appearance-color"][value="automatic"]')
    .check();
  await arrange(page);
  await hover(page, "articles/alpha");
  const camera = await canvas.evaluate((element: any) => ({
    x: element.__zoom.x,
    y: element.__zoom.y,
    k: element.__zoom.k,
  }));
  // Automatic theme changes must also repaint while the pointer stays put.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("saved-theme", "dark");
  await expect
    .poll(
      async () =>
        (await scene(page)).nodes.find((n: any) => n.id === "articles/alpha")
          ?.tint,
    )
    .toBe(0x577fd9);
  await expect.poll(() => edgePixels(page)).toBeGreaterThan(0);
  expect(
    await canvas.evaluate((element: any) => ({
      x: element.__zoom.x,
      y: element.__zoom.y,
      k: element.__zoom.k,
    })),
  ).toEqual(camera);
  await page.mouse.move(0, 0);
  await expect
    .poll(async () => (await scene(page)).nodes.map((n: any) => n.tint))
    .toEqual(Array(5).fill(0xf8f9fa));
  expect(await page.evaluate(() => (window as any).__themeApps.length)).toBe(
    applications,
  );
  expect(errors).toEqual([]);
});
