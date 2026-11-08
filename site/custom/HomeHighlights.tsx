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
export const HomeHighlights: QuartzComponent = ({ fileData }) =>
  fileData.slug === "index" ? (
    <section
      class="home-highlights"
      aria-label="From the notebook"
      data-maximum={Math.max(0, Math.floor(settings.homepageMaximumNotes))}
    >
      <p class="collection-note-count" aria-live="polite" />
      <div class="highlight-cards" aria-live="polite" />
      <noscript>
        <p>
          Browse the{" "}
          <a href={`${pathToRoot(fileData.slug!)}/articles/`}>article list</a>{" "}
          to explore all notes.
        </p>
      </noscript>
    </section>
  ) : null;
HomeHighlights.afterDOMLoaded = behavior;
