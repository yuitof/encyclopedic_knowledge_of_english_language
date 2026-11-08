function prepareContents() {
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      ".article-contents a[data-section]",
    ),
  );
  const top = document.querySelector<HTMLAnchorElement>(".contents-top");
  const update = () => {
    let active: HTMLAnchorElement | undefined;
    for (const link of links) {
      const target = document.getElementById(link.dataset.section!);
      if (target && target.getBoundingClientRect().top < 180) active = link;
    }
    if (
      links.length &&
      window.scrollY > 0 &&
      window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 2
    )
      active = links[links.length - 1];
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
  window.addEventListener("scroll", update, { passive: true });
  update();
  window.addCleanup(() => window.removeEventListener("scroll", update));
}
document.addEventListener("nav", prepareContents);
document.addEventListener("render", prepareContents);
