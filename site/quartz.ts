import {
  loadQuartzConfig,
  loadQuartzLayout,
} from "./quartz/plugins/loader/config-loader";
import { frameRegistry } from "./quartz/components/frames";
import { EncyclopediaFrame } from "./custom/EncyclopediaFrame";
import { HeaderSearch } from "./custom/HeaderSearch";
import { CatalogueNav } from "./custom/CatalogueNav";
import { PageTypes } from "./quartz/plugins";
import fs from "node:fs";

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
loaded.defaults.frame = "encyclopedia";
loaded.defaults.header = [HeaderSearch()];
loaded.defaults.left = [CatalogueNav, ...(loaded.defaults.left ?? [])];
for (const page of Object.values(loaded.byPageType)) {
  page.frame = "encyclopedia";
  page.header = loaded.defaults.header;
  page.left = [
    CatalogueNav,
    ...(page.left ??
      loaded.defaults.left?.filter((component) => component !== CatalogueNav) ??
      []),
  ];
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
