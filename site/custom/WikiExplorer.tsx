import { Explorer } from "@quartz-community/explorer";
import type { QuartzComponent } from "../quartz/components/types";
// @ts-ignore: Quartz imports inline scripts as strings.
import navigationState from "./navigation-state.inline";
// @ts-ignore: Quartz imports inline scripts as strings.
import behavior from "./wiki-explorer.inline";

// Keep Quartz's native tree and controls. Sidebar order is always newest modified first.
const stock = Explorer() as QuartzComponent;
export const WikiExplorer: QuartzComponent = (props) => stock(props);
WikiExplorer.css = stock.css;
WikiExplorer.afterDOMLoaded = [
  ...[stock.afterDOMLoaded ?? ""].flat(),
  navigationState,
  behavior,
];
