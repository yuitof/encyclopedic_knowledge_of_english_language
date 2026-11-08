import type { QuartzComponent } from "../quartz/components/types";
import { articleBacklinks } from "./article-backlinks";
// @ts-ignore: Quartz imports inline scripts as strings.
import state from "./contents-state.inline";
type Entry = {
  depth: number;
  text: string;
  slug: string;
  isBacklinks?: boolean;
};
export const ArticleContents: QuartzComponent = (data) => {
  const entries = [...((data.fileData.toc ?? []) as Entry[])];
  const backlinks = articleBacklinks(data);
  if (backlinks)
    entries.push({
      depth: entries[0]?.depth ?? 0,
      text: "Backlinks",
      slug: backlinks.id,
      isBacklinks: true,
    });
  return (
    <details class="navigation-panel contents-panel" open>
      <summary>Contents</summary>
      <nav class="article-contents" aria-label="Article contents">
        <a class="contents-top" href="#quartz-root">
          (Top)
        </a>
        {(entries.length > 0 || data.fileData.slug === "articles/index") && (
          <ul>
            {entries.map((entry) => (
              <li
                style={{
                  paddingLeft: `${Math.max(0, entry.depth - entries[0].depth)}rem`,
                }}
              >
                <a
                  href={`#${entry.slug}`}
                  data-section={entry.slug}
                  data-backlinks={entry.isBacklinks ? "true" : undefined}
                >
                  {entry.text}
                </a>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </details>
  );
};
ArticleContents.afterDOMLoaded = state;
