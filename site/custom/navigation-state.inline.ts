function closeEmptyNavigationPanels() {
  for (const panel of document.querySelectorAll<HTMLDetailsElement>(
    ".sidebar.left > .navigation-panel",
  )) {
    const hasContent = panel.classList.contains("contents-panel")
      ? !!panel.querySelector("a[data-section]")
      : !!panel.querySelector(
          ".article-date-filter:not([hidden]), .explorer-content a.nav-file-title, .nav-show-more",
        );
    if (!hasContent) panel.open = false;
    else if (panel.dataset.empty === "true") panel.open = true;
    panel.dataset.empty = String(!hasContent);
  }
}

// Native disclosures provide independent mouse/keyboard controls for both sections.
function prepareNavigationPanels() {
  const mobile = window.matchMedia("(max-width: 800px)").matches;
  const sidebar = document.querySelector<HTMLElement>(".sidebar.left");
  if (sidebar && !sidebar.dataset.stickyNavigation) {
    sidebar.dataset.stickyNavigation = "ready";
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
      delete sidebar.dataset.stickyNavigation;
      document.documentElement.style.removeProperty("--navigation-height");
    });
  }
  for (const panel of document.querySelectorAll<HTMLDetailsElement>(
    ".sidebar.left > .navigation-panel",
  )) {
    if (panel.dataset.navigationPanel) continue;
    panel.dataset.navigationPanel = "ready";
    if (mobile) panel.open = false;
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
