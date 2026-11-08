async function prepareHighlights() {
  const section = document.querySelector<HTMLElement>(".home-highlights");
  if (!section || section.dataset.ready) return;
  section.dataset.ready = "true";
  const notes = Object.entries(
    (await fetchData) as Record<string, { title: string; content: string }>,
  ).filter(
    ([slug]) => slug.startsWith("articles/") && !slug.endsWith("/index"),
  );
  const count = section.querySelector(".collection-note-count");
  if (count)
    count.textContent = `${notes.length.toLocaleString("en-US")} notes in the collection.`;
  const entries = notes.filter(([, note]) => note.content.trim());
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  const container = section.querySelector(".highlight-cards")!;
  for (const [slug, note] of entries.slice(
    0,
    Number(section.dataset.maximum),
  )) {
    const card = document.createElement("article"),
      heading = document.createElement("h2"),
      link = document.createElement("a"),
      excerpt = document.createElement("p");
    link.href = `${document.body.dataset.basepath ?? ""}/${slug}`;
    link.textContent = note.title;
    heading.append(link);
    excerpt.textContent =
      note.content.replace(/\s+/g, " ").slice(0, 240) +
      (note.content.length > 240 ? "…" : "");
    card.append(heading, excerpt);
    container.append(card);
  }
}
document.addEventListener("nav", prepareHighlights);
document.addEventListener("render", prepareHighlights);
