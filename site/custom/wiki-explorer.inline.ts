// Keep Quartz's generated links, with an always-expanded recent-article group.
const recentArticleLimit = 10;
async function prepareArticleOrder() {
  const index = (await fetchData) as Record<
    string,
    {
      sortRanks?: {
        name: number;
        modified: number | null;
        created: number | null;
      };
    }
  >;
  const recent = Object.entries(index)
    .filter(([slug, note]) => slug.startsWith("articles/") && note.sortRanks)
    .sort(([, a], [, b]) => {
      const x = a.sortRanks!,
        y = b.sortRanks!;
      if (x.modified === null && y.modified !== null) return 1;
      if (y.modified === null && x.modified !== null) return -1;
      return (
        (x.modified === null || y.modified === null
          ? 0
          : y.modified - x.modified) || x.name - y.name
      );
    })
    .slice(0, recentArticleLimit);
  const positions = new Map(recent.map(([slug], position) => [slug, position]));
  for (const explorer of document.querySelectorAll<HTMLElement>(
    ".sidebar.left .explorer",
  )) {
    if (explorer.dataset.articleOrder) continue;
    explorer.dataset.articleOrder = "true";
    const article = (element: Element) => {
      const href = element.querySelector<HTMLAnchorElement>(
        ":scope > a.nav-file-title",
      )?.href;
      if (!href) return null;
      const slug = decodeURIComponent(new URL(href).pathname)
        .replace(document.body.dataset.basepath ?? "", "")
        .replace(/^\//, "")
        .replace(/\.html$/, "");
      return slug.startsWith("articles/") && index[slug]?.sortRanks
        ? slug
        : null;
    };
    const apply = () => {
      // Missing-note placeholders belong in links/search/graph, not the recent-article list.
      for (const folder of explorer.querySelectorAll<HTMLElement>(
        ".folder-container[data-folderpath]",
      ))
        if (!folder.dataset.folderpath?.startsWith("articles/"))
          folder.closest("li")?.remove();
      for (const link of explorer.querySelectorAll<HTMLAnchorElement>(
        "a.nav-file-title",
      ))
        if (!article(link.parentElement!)) link.closest("li")?.remove();
      for (const list of explorer.querySelectorAll<HTMLElement>(
        ".explorer-content ul",
      )) {
        const files = Array.from(list.children).flatMap((element) => {
          const slug = article(element);
          return slug === null ? [] : [{ element, slug }];
        });
        for (const { element, slug } of files)
          if (!positions.has(slug)) element.remove();
        const kept = files.filter(({ slug }) => positions.has(slug));
        const sorted = [...kept].sort(
          (a, b) => positions.get(a.slug)! - positions.get(b.slug)!,
        );
        if (kept.every(({ element }, i) => element === sorted[i].element))
          continue;
        const markers = kept.map(({ element }) => {
          const marker = document.createComment("article-position");
          element.replaceWith(marker);
          return marker;
        });
        markers.forEach((marker, i) => marker.replaceWith(sorted[i].element));
      }
      const heading = explorer.querySelector<HTMLElement>(
        '.folder-container[data-folderpath="articles/index"]',
      );
      if (heading && !heading.dataset.recentLabel) {
        const label = document.createElement("span");
        label.className = "recently-updated-label";
        label.textContent = "Recently updated";
        heading.replaceChildren(label);
        heading.dataset.recentLabel = "true";
      }
      heading?.nextElementSibling?.classList.add("open");
      document.dispatchEvent(
        new CustomEvent("article-sections-changed", { detail: {} }),
      );
    };
    const observer = new MutationObserver(apply);
    observer.observe(explorer, { childList: true, subtree: true });
    apply();
    window.addCleanup(() => {
      observer.disconnect();
      delete explorer.dataset.articleOrder;
    });
  }
}
document.addEventListener("nav", prepareArticleOrder);
document.addEventListener("render", prepareArticleOrder);
