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
  type Details = {
    group: string;
    modified: string | null;
    created: string | null;
  };
  let index: Record<string, { sortRanks?: Ranks; sortDetails?: Details }>;
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
    return {
      element,
      position,
      ranks: index[slug]?.sortRanks,
      details: index[slug]?.sortDetails,
    };
  });
  const allowed = new Set(Array.from(select.options, (option) => option.value));
  const storageKey = "article-list-order";
  let initial = "name-asc";
  try {
    initial = localStorage.getItem(storageKey) ?? initial;
  } catch {}
  select.value = allowed.has(initial) ? initial : "name-asc";
  const calendar = document.querySelector<HTMLFormElement>(
    ".article-date-filter",
  )!;
  const from = calendar.querySelector<HTMLInputElement>("#article-date-from")!;
  const to = calendar.querySelector<HTMLInputElement>("#article-date-to")!;
  const contents = document.querySelector<HTMLElement>(
    ".article-contents > ul",
  )!;
  const groups = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "symbols", "other"];
  const label = (group: string) =>
    group === "symbols"
      ? "Symbols and numbers"
      : group === "other"
        ? "日本語 and other scripts"
        : group;
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
    const byName = field === "name";
    calendar.hidden = byName;
    calendar.querySelector(".date-filter-title")!.textContent =
      field === "created" ? "Created date" : "Modified date";
    const dates = byName
      ? []
      : entries
          .flatMap(({ details }) => (details?.[field] ? [details[field]!] : []))
          .sort();
    for (const input of [from, to]) {
      input.min = dates[0] ?? "";
      input.max = dates.at(-1) ?? "";
    }
    const invalid =
      !byName && !!from.value && !!to.value && from.value > to.value;
    to.setCustomValidity(
      invalid ? "Choose an end date on or after the start date." : "",
    );
    const filtered =
      byName || invalid
        ? sorted
        : sorted.filter(({ details }) => {
            if (!from.value && !to.value) return true;
            const day = details?.[field];
            return (
              !!day &&
              (!from.value || day >= from.value) &&
              (!to.value || day <= to.value)
            );
          });
    const fragment = document.createDocumentFragment();
    contents.replaceChildren();
    if (byName) {
      const letters =
        direction === "desc"
          ? groups.slice(0, 26).reverse()
          : groups.slice(0, 26);
      for (const group of [...letters, "symbols", "other"]) {
        const members = filtered.filter(
          ({ details }) => (details?.group ?? "other") === group,
        );
        if (!members.length) continue;
        const headingRow = document.createElement("li"),
          heading = document.createElement("h2");
        headingRow.className = "article-group-heading";
        heading.id = `article-group-${group.toLowerCase()}`;
        heading.textContent = label(group);
        headingRow.append(heading);
        fragment.append(headingRow);
        const item = document.createElement("li"),
          link = document.createElement("a");
        link.href = `#${heading.id}`;
        link.dataset.section = heading.id;
        link.textContent = label(group);
        item.append(link);
        contents.append(item);
        for (const { element } of members) fragment.append(element);
      }
    } else for (const { element } of filtered) fragment.append(element);
    if (!filtered.length) {
      const empty = document.createElement("li");
      empty.className = "article-empty";
      empty.textContent = "No articles match this date range.";
      fragment.append(empty);
    }
    list.replaceChildren(fragment);
    const dateStatus = calendar.querySelector(".date-filter-status")!;
    dateStatus.textContent = invalid
      ? "Choose an end date on or after the start date."
      : `${filtered.length.toLocaleString()} of ${entries.length.toLocaleString()} articles.`;
    status.textContent = `Sorted by ${select.selectedOptions[0].textContent}.`;
    document.dispatchEvent(
      new CustomEvent("article-sections-changed", { detail: {} }),
    );
  };
  const change = () => {
    apply();
    try {
      localStorage.setItem(storageKey, select.value);
    } catch {}
  };
  const reset = () => {
    from.value = "";
    to.value = "";
    apply();
  };
  const preventSubmit = (event: Event) => event.preventDefault();
  calendar.addEventListener("input", apply);
  calendar.addEventListener("reset", reset);
  calendar.addEventListener("submit", preventSubmit);
  window.addCleanup(() => {
    calendar.removeEventListener("input", apply);
    calendar.removeEventListener("reset", reset);
    calendar.removeEventListener("submit", preventSubmit);
  });
  apply();
  select.disabled = false;
  control.dataset.sortReady = "ready";
  select.addEventListener("change", change);
  window.addCleanup(() => select.removeEventListener("change", change));
}
document.addEventListener("nav", prepareArticleSorting);
document.addEventListener("render", prepareArticleSorting);
