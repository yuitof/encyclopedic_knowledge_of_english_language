import {
  loadQuartzConfig,
  loadQuartzLayout,
} from "./quartz/plugins/loader/config-loader";
import { frameRegistry } from "./quartz/components/frames";
import { EncyclopediaFrame } from "./custom/EncyclopediaFrame";
import { HeaderSearch } from "./custom/HeaderSearch";
import { WikiExplorer } from "./custom/WikiExplorer";
import { ArticleContents } from "./custom/ArticleContents";
import { ArticleSorting } from "./custom/ArticleSorting";
import { Appearance } from "./custom/Appearance";
import { GraphPage } from "./custom/GraphPage";
import { HomeHighlights } from "./custom/HomeHighlights";
import { SiteFooter } from "./custom/SiteFooter";
import { PageTypes } from "./quartz/plugins";
import fs from "node:fs";
import { createElement } from "preact";

frameRegistry.register("encyclopedia", EncyclopediaFrame, "local:encyclopedia");
const config = await loadQuartzConfig();
if (process.env.SITE_BASE_URL)
  config.configuration.baseUrl = process.env.SITE_BASE_URL;
// Replace the default external KaTeX CDN resources with packaged local CSS/fonts.
const latex = config.plugins.transformers.find(
  (plugin) => plugin.name === "Latex",
);
if (latex)
  latex.externalResources = () => ({
    css: [
      {
        content: fs
          .readFileSync("node_modules/katex/dist/katex.min.css", "utf8")
          .replaceAll("url(fonts/", "url(../fonts/"),
        inline: true,
      },
    ],
  });
export default config;
const loaded = await loadQuartzLayout();
const originalHead = loaded.defaults.head!;
const customHead: typeof originalHead = (props) => {
  const node = originalHead(props);
  const originalIcon = (node.props.children as any[])
    .flat()
    .find((child: any) => child?.props?.rel === "icon");
  const children = (node.props.children as any[])
    .flat()
    .filter((child: any) => child?.props?.rel !== "icon");
  return createElement(
    "head",
    {},
    ...children,
    createElement("link", {
      rel: "icon",
      type: "image/svg+xml",
      href: String(originalIcon?.props.href ?? "./static/icon.png").replace(
        /icon\.png$/,
        "favicon.svg",
      ),
    }),
  );
};
loaded.defaults.head = customHead;
loaded.defaults.frame = "encyclopedia";
loaded.defaults.header = [HeaderSearch()];
loaded.defaults.left = [ArticleContents, WikiExplorer];
loaded.defaults.footer = [SiteFooter];
loaded.defaults.afterBody = [HomeHighlights, GraphPage];
for (const page of Object.values(loaded.byPageType)) {
  page.head = customHead;
  page.frame = "encyclopedia";
  page.header = loaded.defaults.header;
  page.left = [ArticleContents, WikiExplorer];
  page.footer = [SiteFooter];
  page.afterBody = [HomeHighlights, GraphPage];
}
const defaultBeforeBody = loaded.defaults.beforeBody ?? [];
for (const page of [loaded.defaults, ...Object.values(loaded.byPageType)]) {
  page.right = [Appearance, ...(page.right ?? [])];
  page.beforeBody = [...(page.beforeBody ?? defaultBeforeBody), ArticleSorting];
}
// loadQuartzConfig creates a dispatcher before TS overrides; rebuild that emitter with our final layout.
config.plugins.emitters = config.plugins.emitters.filter(
  (plugin) => plugin.name !== "PageTypeDispatcher",
);
config.plugins.emitters.push(
  PageTypes.PageTypeDispatcher({
    defaults: loaded.defaults,
    byPageType: loaded.byPageType,
  }),
);
export const layout = loaded;
