import settings from "../site-settings.json";
import type { QuartzComponent } from "../quartz/components/types";
import { pathToRoot } from "../quartz/util/path";
// @ts-ignore: Quartz imports inline scripts as strings.
import behavior from "./home-highlights.inline";
if (
  !Number.isInteger(settings.homepageMaximumNotes) ||
  settings.homepageMaximumNotes < 0
)
  throw new Error("homepageMaximumNotes must be a nonnegative integer");
export const HomeHighlights: QuartzComponent = ({ fileData, allFiles }) => {
  if (fileData.slug !== "index") return null;
  const noteCount = allFiles.filter(
    (file) =>
      file.slug?.startsWith("articles/") && !file.slug.endsWith("/index"),
  ).length;
  return (
    <section
      class="home-highlights"
      aria-label="From the notebook"
      data-maximum={Math.max(0, Math.floor(settings.homepageMaximumNotes))}
    >
      <p class="collection-note-count">{`${noteCount.toLocaleString("en-US")} notes in the collection.`}</p>
      <div class="highlight-cards" aria-live="polite" />
      <noscript>
        <p>
          Browse the{" "}
          <a href={`${pathToRoot(fileData.slug!)}/articles/`}>article list</a>{" "}
          to explore all notes.
        </p>
      </noscript>
    </section>
  );
};
HomeHighlights.afterDOMLoaded = behavior;
