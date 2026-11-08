import { cloneElement, type VNode } from "preact";
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
