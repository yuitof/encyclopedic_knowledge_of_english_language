// Reorder Quartz's existing list; keep its links, metadata and no-JavaScript fallback.
async function prepareArticleSorting() {
  const control = document.querySelector<HTMLElement>(".article-list-sort");
  const select = control?.querySelector<HTMLSelectElement>("select");
  const list = document.querySelector<HTMLElement>(
    "#main-content .page-listing .section-ul",
  );
  if (!control || !select || !list || control.dataset.sortReady) return;
  control.dataset.sortReady = "loading";
  let cancelled = false;
  window.addCleanup(() => {
    cancelled = true;
    delete control.dataset.sortReady;
  });
  const status = control.querySelector<HTMLElement>("[role=status]")!;
  type Ranks = {
    name: number;
    modified: number | null;
    created: number | null;
  };
  let index: Record<string, { sortRanks?: Ranks }>;
  try {
    index = await fetchData;
  } catch {
    if (!cancelled)
      status.textContent =
        "Sorting could not load. The full article list is still available.";
    return;
  }
  if (cancelled || !control.isConnected) return;
  const base = document.body.dataset.basepath ?? "";
  const entries = Array.from(list.children).map((element, position) => {
    const link = element.querySelector<HTMLAnchorElement>(".desc a.internal");
    const slug = link
      ? decodeURIComponent(new URL(link.href).pathname)
          .slice(base.length)
          .replace(/^\//, "")
          .replace(/\.html$/, "")
      : "";
    return { element, position, ranks: index[slug]?.sortRanks };
  });
  const allowed = new Set(Array.from(select.options, (option) => option.value));
  const storageKey = "article-list-order";
  let initial = "name-asc";
  try {
    initial = localStorage.getItem(storageKey) ?? initial;
  } catch {}
  select.value = allowed.has(initial) ? initial : "name-asc";
  const apply = () => {
    if (!allowed.has(select.value)) return;
    const [field, direction] = select.value.split("-") as [keyof Ranks, string];
    const sorted = [...entries].sort((a, b) => {
      const x = a.ranks?.[field] ?? null,
        y = b.ranks?.[field] ?? null;
      if (x === null && y !== null) return 1;
      if (y === null && x !== null) return -1;
      return (
        (x === null || y === null
          ? 0
          : (x - y) * (direction === "desc" ? -1 : 1)) ||
        (a.ranks?.name ?? Number.MAX_SAFE_INTEGER) -
          (b.ranks?.name ?? Number.MAX_SAFE_INTEGER) ||
        a.position - b.position
      );
    });
    const fragment = document.createDocumentFragment();
    for (const { element } of sorted) fragment.append(element);
    list.append(fragment);
    status.textContent = `Sorted by ${select.selectedOptions[0].textContent}.`;
  };
  const change = () => {
    apply();
    try {
      localStorage.setItem(storageKey, select.value);
    } catch {}
  };
  apply();
  select.disabled = false;
  control.dataset.sortReady = "ready";
  select.addEventListener("change", change);
  window.addCleanup(() => select.removeEventListener("change", change));
}
document.addEventListener("nav", prepareArticleSorting);
document.addEventListener("render", prepareArticleSorting);
