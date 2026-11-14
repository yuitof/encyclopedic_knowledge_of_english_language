function closeEmptyNavigationPanels() {
  for (const panel of document.querySelectorAll<HTMLDetailsElement>(
    ".sidebar.left > .navigation-panel",
  )) {
    const hasContent = panel.classList.contains("contents-panel")
      ? !!panel.querySelector(".article-contents a")
      : !!panel.querySelector(
          ".article-date-filter:not([hidden]), .explorer-content a.nav-file-title, .nav-show-more, .graph-view-link",
        );
    if (!hasContent) panel.open = false;
    else if (
      panel.dataset.empty === "true" &&
      !window.matchMedia("(max-width: 800px)").matches
    )
      panel.open = true;
    panel.dataset.empty = String(!hasContent);
  }
}

// Native disclosures provide independent mouse/keyboard controls for both sections.
function prepareNavigationPanels() {
  const sidebar = document.querySelector<HTMLElement>(".sidebar.left");
  const media = window.matchMedia("(max-width: 800px)");
  if (sidebar && !sidebar.dataset.stickyNavigation) {
    sidebar.dataset.stickyNavigation = "ready";
    const appearance =
      document.querySelector<HTMLDetailsElement>(".appearance-panel");
    const origin = document.createComment("appearance-desktop-position");
    appearance?.before(origin);
    const navigation = Array.from(
      sidebar.querySelectorAll<HTMLDetailsElement>(
        ":scope > .navigation-panel",
      ),
    );
    const panels = [...navigation, ...(appearance ? [appearance] : [])];
    const layout = () => {
      if (appearance) {
        if (media.matches) sidebar.append(appearance);
        else origin.after(appearance);
      }
      for (const panel of panels)
        panel.open = !media.matches && panel.dataset.empty !== "true";
    };
    layout();
    media.addEventListener("change", layout);
    const close = () => {
      for (const panel of panels) panel.open = false;
    };
    const toggle = (event: Event) => {
      const panel = event.currentTarget as HTMLDetailsElement;
      if (media.matches && panel.open)
        for (const other of panels) if (other !== panel) other.open = false;
    };
    for (const panel of panels) panel.addEventListener("toggle", toggle);
    const outside = (event: PointerEvent) => {
      if (media.matches && !sidebar.contains(event.target as Node)) close();
    };
    const select = (event: MouseEvent) => {
      if (
        media.matches &&
        !event.button &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !event.altKey &&
        (event.target as Element).closest(".navigation-panel-body a")
      )
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (!media.matches || event.key !== "Escape") return;
      const open = panels.find((panel) => panel.open);
      if (open) {
        close();
        open.querySelector<HTMLElement>(":scope > summary")?.focus();
        event.preventDefault();
      }
    };
    document.addEventListener("pointerdown", outside);
    sidebar.addEventListener("click", select);
    document.addEventListener("keydown", escape);
    const updateInset = () =>
      document.documentElement.style.setProperty(
        "--navigation-height",
        `${sidebar.getBoundingClientRect().height}px`,
      );
    const observer = new ResizeObserver(updateInset);
    observer.observe(sidebar);
    updateInset();
    window.addCleanup(() => {
      observer.disconnect();
      media.removeEventListener("change", layout);
      for (const panel of panels) panel.removeEventListener("toggle", toggle);
      document.removeEventListener("pointerdown", outside);
      sidebar.removeEventListener("click", select);
      document.removeEventListener("keydown", escape);
      if (appearance && origin.parentNode) origin.replaceWith(appearance);
      delete sidebar.dataset.stickyNavigation;
      document.documentElement.style.removeProperty("--navigation-height");
    });
  }
  for (const panel of document.querySelectorAll<HTMLDetailsElement>(
    ".sidebar.left > .navigation-panel",
  )) {
    if (panel.dataset.navigationPanel) continue;
    panel.dataset.navigationPanel = "ready";
    window.addCleanup(() => {
      delete panel.dataset.navigationPanel;
      delete panel.dataset.empty;
    });
  }
  closeEmptyNavigationPanels();
}
document.addEventListener("nav", prepareNavigationPanels);
document.addEventListener("render", prepareNavigationPanels);

document.addEventListener(
  "article-sections-changed",
  closeEmptyNavigationPanels,
);
