function prepareGraphControls() {
  const select = document.querySelector<HTMLSelectElement>("#graph-note");
  const link = document.querySelector<HTMLAnchorElement>(
    ".graph-selected-note",
  );
  if (!select || !link || select.dataset.graphReady) return;
  select.dataset.graphReady = "true";
  const update = () => {
    link.hidden = !select.value;
    if (select.value) link.href = select.value;
    else link.removeAttribute("href");
  };
  select.addEventListener("change", update);
  update();
  window.addCleanup(() => select.removeEventListener("change", update));
}
document.addEventListener("nav", prepareGraphControls);
document.addEventListener("render", prepareGraphControls);
