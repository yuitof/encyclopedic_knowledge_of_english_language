import { cloneElement, type VNode } from "preact";
import { pathToRoot } from "../quartz/util/path";
import { Explorer } from "@quartz-community/explorer";
import type { QuartzComponent } from "../quartz/components/types";
// @ts-ignore: Quartz imports inline scripts as strings.
import navigationState from "./navigation-state.inline";
// @ts-ignore: Quartz imports inline scripts as strings.
import behavior from "./wiki-explorer.inline";

// Quartz owns the tree and folder controls; the shared native panel owns collapse.
const stock = Explorer() as QuartzComponent;
type TreeChild = VNode<{ class?: string; "aria-expanded"?: boolean | string }>;
export const WikiExplorer: QuartzComponent = (props) => {
  const graphLink = props.allFiles.some((file) => file.slug === "graph") ? (
    <nav class="graph-navigation" aria-label="Graph navigation">
      <a
        class="graph-view-link"
        href={`${pathToRoot(props.fileData.slug!)}/graph`}
      >
        Graph view
      </a>
    </nav>
  ) : null;
  if (props.fileData.slug === "articles/index")
    return (
      <details class="navigation-panel explorer-panel">
        <summary>Explorer</summary>
        {graphLink}
        <form
          class="article-date-filter"
          hidden
          aria-label="Article date range"
        >
          <p class="date-filter-title" />
          <label for="article-date-from">From</label>
          <input
            id="article-date-from"
            type="date"
            aria-describedby="article-date-help"
          />
          <label for="article-date-to">To</label>
          <input
            id="article-date-to"
            type="date"
            aria-describedby="article-date-help"
          />
          <button type="reset">Clear dates</button>
          <p id="article-date-help">
            Includes both dates (UTC). Articles with unknown dates are excluded
            while filtering.
          </p>
          <p class="date-filter-status" role="status" />
        </form>
      </details>
    );
  const tree = stock(props) as VNode<{ children: TreeChild[] }>;
  const children = tree.props.children
    .filter((child) => child.type !== "button")
    .map((child) =>
      child.props.class === "explorer-content"
        ? cloneElement(child, { "aria-expanded": undefined })
        : child,
    );
  return (
    <details class="navigation-panel explorer-panel" open>
      <summary>Explorer</summary>
      {graphLink}
      {cloneElement(tree, {}, ...children)}
    </details>
  );
};
WikiExplorer.css = stock.css;
WikiExplorer.afterDOMLoaded = [
  ...[stock.afterDOMLoaded ?? ""].flat(),
  navigationState,
  behavior,
];
