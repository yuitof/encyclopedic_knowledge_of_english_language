import { cloneElement, type VNode } from "preact";
import { Explorer } from "@quartz-community/explorer";
import type { QuartzComponent } from "../quartz/components/types";
import { CatalogueNav } from "./CatalogueNav";
// @ts-ignore: Quartz imports inline scripts as strings.
import behavior from "./wiki-explorer.inline";
const stock = Explorer() as QuartzComponent;
const options = [
  ["name-asc", "File name(A-Z)"],
  ["name-desc", "File name(Z-A)"],
  ["modified-desc", "Modified time(new to old)"],
  ["modified-asc", "Modified time(old to new)"],
  ["created-desc", "Created time(new to old)"],
  ["created-asc", "Created time(old to new)"],
];
export const WikiExplorer: QuartzComponent = (props) => {
  const tree = stock(props) as VNode<{ children: VNode[] }>;
  return cloneElement(
    tree,
    {},
    ...tree.props.children.map((child) => {
      if ((child?.props as { class?: string })?.class !== "explorer-content")
        return child;
      return cloneElement(
        child,
        {},
        <CatalogueNav {...props} />,
        props.fileData.slug === "articles/index" ? (
          <label class="article-sort-label">
            Arrange articles
            <select class="article-sort" defaultValue="modified-desc">
              {options.map(([value, label]) => (
                <option value={value}>{label}</option>
              ))}
            </select>
          </label>
        ) : null,
        ...[child.props.children].flat(),
      );
    }),
  );
};
WikiExplorer.css = stock.css;
WikiExplorer.afterDOMLoaded = [
  ...[stock.afterDOMLoaded ?? ""].flat(),
  ...[CatalogueNav.afterDOMLoaded ?? ""].flat(),
  behavior,
];
