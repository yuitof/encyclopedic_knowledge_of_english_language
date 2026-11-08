// Reorder existing file nodes; Quartz retains its tree, links and folder handlers.
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
  for (const explorer of document.querySelectorAll<HTMLElement>(
    ".sidebar.left .explorer",
  )) {
    if (explorer.dataset.articleOrder) continue;
    explorer.dataset.articleOrder = "true";
    const rank = (element: Element) => {
      const href = element.querySelector<HTMLAnchorElement>(
        ":scope > a.nav-file-title",
      )?.href;
      if (!href) return null;
      const slug = decodeURIComponent(new URL(href).pathname)
        .replace(document.body.dataset.basepath ?? "", "")
        .replace(/^\//, "")
        .replace(/\.html$/, "");
      return index[slug]?.sortRanks ?? null;
    };
    const apply = () => {
      for (const list of explorer.querySelectorAll<HTMLElement>(
        ".explorer-content ul",
      )) {
        const files = Array.from(list.children).filter(
          (element) => rank(element) !== null,
        );
        if (files.length < 2) continue;
        const sorted = [...files].sort((a, b) => {
          const x = rank(a)!,
            y = rank(b)!,
            av = x.modified,
            bv = y.modified;
          if (av === null && bv !== null) return 1;
          if (bv === null && av !== null) return -1;
          const delta = av === null || bv === null ? 0 : av - bv;
          return -delta || x.name - y.name;
        });
        if (files.every((element, i) => element === sorted[i])) continue;
        const positions = files.map((element) => {
          const marker = document.createComment("article-position");
          element.replaceWith(marker);
          return marker;
        });
        positions.forEach((marker, i) => marker.replaceWith(sorted[i]));
      }
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
