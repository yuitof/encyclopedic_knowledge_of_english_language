import type { QuartzComponent } from "../quartz/components/types";
// @ts-ignore: Quartz imports inline scripts as strings.
import behavior from "./article-sorting.inline";

export const ArticleSorting: QuartzComponent = ({ fileData }) =>
  fileData.slug === "articles/index" ? (
    <div class="article-list-sort">
      <label for="article-list-order">Sort articles</label>
      <select id="article-list-order" disabled>
        <option value="name-asc">File name (A-Z)</option>
        <option value="name-desc">File name (Z-A)</option>
        <option value="modified-desc">Modified time (new to old)</option>
        <option value="modified-asc">Modified time (old to new)</option>
        <option value="created-desc">Created time (new to old)</option>
        <option value="created-asc">Created time (old to new)</option>
      </select>
      <span
        id="article-sort-error"
        class="article-sort-error"
        role="alert"
        hidden
      />
      <noscript>Enable JavaScript to change the article order.</noscript>
    </div>
  ) : null;
ArticleSorting.afterDOMLoaded = behavior;
