// Native disclosures provide independent mouse/keyboard controls for both sections.
function prepareNavigationPanels() {
  const mobile = window.matchMedia("(max-width: 800px)").matches;
  for (const panel of document.querySelectorAll<HTMLDetailsElement>(
    ".sidebar.left > .navigation-panel",
  )) {
    if (panel.dataset.navigationPanel) continue;
    panel.dataset.navigationPanel = "ready";
    if (mobile) panel.open = false;
    window.addCleanup(() => {
      delete panel.dataset.navigationPanel;
    });
  }
}
document.addEventListener("nav", prepareNavigationPanels);
document.addEventListener("render", prepareNavigationPanels);
