import type { QuartzComponent } from "../quartz/components/types";
// @ts-ignore: Quartz imports inline scripts as strings.
import state from "./contents-state.inline";
type Entry = { depth: number; text: string; slug: string };
export const ArticleContents: QuartzComponent = ({ fileData }) => {
  const entries = (fileData.toc ?? []) as Entry[];
  return (
    <nav class="article-contents" aria-label="Article contents">
      <a class="contents-top" href="#main-content">
        (Top)
      </a>
      {entries.length > 0 && (
        <details open>
          <summary>On this page</summary>
          <ul>
            {entries.map((entry) => (
              <li
                style={{
                  paddingLeft: `${Math.max(0, entry.depth - entries[0].depth)}rem`,
                }}
              >
                <a href={`#${entry.slug}`} data-section={entry.slug}>
                  {entry.text}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </nav>
  );
};
ArticleContents.afterDOMLoaded = state;
