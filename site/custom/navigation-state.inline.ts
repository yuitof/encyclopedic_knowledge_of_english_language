// Quartz owns toggle clicks. Mirror its state onto the visible native buttons.
function synchronizeNavigationState() {
  for (const explorer of document.querySelectorAll<HTMLElement>(
    ".sidebar.left .explorer",
  )) {
    if (explorer.dataset.navigationState) continue;
    explorer.dataset.navigationState = "true";
    const content = explorer.querySelector<HTMLElement>(".explorer-content");
    const update = () => {
      const expanded = String(!explorer.classList.contains("collapsed"));
      for (const button of explorer.querySelectorAll<HTMLButtonElement>(
        ".explorer-toggle",
      )) {
        button.setAttribute("aria-expanded", expanded);
        if (content?.id) button.setAttribute("aria-controls", content.id);
      }
      content?.setAttribute("aria-expanded", expanded);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(explorer, {
      attributes: true,
      attributeFilter: ["class"],
    });
    window.addCleanup(() => {
      observer.disconnect();
      delete explorer.dataset.navigationState;
    });
  }
}
document.addEventListener("nav", synchronizeNavigationState);
document.addEventListener("render", synchronizeNavigationState);
