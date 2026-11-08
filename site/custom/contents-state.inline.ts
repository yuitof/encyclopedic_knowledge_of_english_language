function prepareContents() {
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      ".article-contents a[data-section]",
    ),
  );
  const top = document.querySelector<HTMLAnchorElement>(".contents-top");
  const markActive = (active?: HTMLAnchorElement) => {
    if (top) {
      top.classList.toggle("active-section", !active);
      if (!active) top.setAttribute("aria-current", "location");
      else top.removeAttribute("aria-current");
    }
    for (const link of links) {
      link.classList.toggle("active-section", link === active);
      if (link === active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  };
  const update = () => {
    const sidebarBottom = window.matchMedia("(max-width: 800px)").matches
      ? (document.querySelector(".sidebar.left")?.getBoundingClientRect()
          .bottom ?? 0)
      : 0;
    const readingEdge = Math.max(180, sidebarBottom + 32);
    let active: HTMLAnchorElement | undefined;
    for (const link of links) {
      const target = document.getElementById(link.dataset.section!);
      if (target && target.getBoundingClientRect().top < readingEdge)
        active = link;
    }
    if (
      links.length &&
      window.scrollY > 0 &&
      window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 2
    )
      active = links[links.length - 1];
    if (document.documentElement.scrollHeight <= window.innerHeight + 1)
      active = links.find((link) => link.hash === window.location.hash);
    markActive(active);
  };
  for (const link of [...links, ...(top ? [top] : [])]) {
    const selectVisibleSection = (event: MouseEvent) => {
      if (
        event.button ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      if (document.documentElement.scrollHeight <= window.innerHeight + 1)
        markActive(link === top ? undefined : link);
    };
    link.addEventListener("click", selectVisibleSection);
    window.addCleanup(() =>
      link.removeEventListener("click", selectVisibleSection),
    );
  }
  window.addEventListener("scroll", update, { passive: true });
  update();
  window.addCleanup(() => window.removeEventListener("scroll", update));
}
document.addEventListener("nav", prepareContents);
document.addEventListener("render", prepareContents);
