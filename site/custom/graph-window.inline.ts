function prepareGraphWindow() {
  const frame = document.querySelector<HTMLElement>(".graph-window");
  const dialog = document.querySelector<HTMLDialogElement>(
    ".graph-window-dialog",
  );
  const button = frame?.querySelector<HTMLButtonElement>(
    ".graph-expand-button",
  );
  if (
    !frame ||
    !dialog ||
    !button ||
    frame.dataset.windowReady ||
    typeof dialog.showModal !== "function"
  )
    return;
  frame.dataset.windowReady = "true";
  button.hidden = false;
  const origin = document.createComment("graph-window-position");
  frame.before(origin);
  let expanded = false,
    disposed = false,
    previousOverflow = "";
  const updateButton = () => {
    const label = expanded
      ? "Restore graph size"
      : "Expand graph to fill window";
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-label", label);
    button.title = label;
  };
  // Quartz handles its canvas resize and refits the current collection.
  const redraw = () => window.dispatchEvent(new Event("resize"));
  const restore = () => {
    if (!expanded) return;
    expanded = false;
    origin.after(frame);
    document.documentElement.style.overflow = previousOverflow;
    updateButton();
    if (!disposed) {
      redraw();
      button.focus({ preventScroll: true });
    }
  };
  const toggle = () => {
    if (dialog.open) {
      dialog.close();
      return;
    }
    previousOverflow = document.documentElement.style.overflow;
    expanded = true;
    dialog.append(frame);
    dialog.showModal();
    document.documentElement.style.overflow = "hidden";
    updateButton();
    button.focus({ preventScroll: true });
    redraw();
  };
  button.addEventListener("click", toggle);
  dialog.addEventListener("close", restore);
  window.addCleanup(() => {
    disposed = true;
    if (dialog.open) dialog.close();
    restore();
    button.removeEventListener("click", toggle);
    dialog.removeEventListener("close", restore);
    origin.remove();
    delete frame.dataset.windowReady;
  });
}
document.addEventListener("nav", prepareGraphWindow);
document.addEventListener("render", prepareGraphWindow);
