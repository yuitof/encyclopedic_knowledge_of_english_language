import { Search } from "@quartz-community/search";
import type { QuartzComponent } from "../quartz/components/types";
// @ts-ignore: Quartz's esbuild loader imports inline scripts as strings.
import adapter from "./search-accessibility.inline";

/** The stock Quartz search engine and UI, with a visible input and a small accessibility adapter. */
export function HeaderSearch(): QuartzComponent {
  const StockSearch = Search({ enablePreview: false }) as QuartzComponent;
  const Component: QuartzComponent = (props) => (
    <div class="header-search" role="search">
      <StockSearch {...props} />
    </div>
  );
  Component.css = StockSearch.css;
  Component.afterDOMLoaded = `${StockSearch.afterDOMLoaded ?? ""}
${adapter}`;
  return Component;
}
