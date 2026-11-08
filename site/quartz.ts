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
import { createElement, Fragment } from "preact";

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
const socialImageMeta = new Set([
  "og:image",
  "og:image:url",
  "og:image:secure_url",
  "og:image:type",
  "og:image:width",
  "og:image:height",
  "og:image:alt",
  "twitter:image",
  "twitter:image:alt",
]);
const customHead: typeof originalHead = (props) => {
  const node = originalHead(props);
  // Quartz groups social tags inside Preact fragments; unwrap them before
  // replacing the shared image so old/default tags cannot be duplicated.
  const flatten = (value: any): any[] =>
    Array.isArray(value)
      ? value.flatMap(flatten)
      : value?.type === Fragment
        ? flatten(value.props.children)
        : [value];
  const head = flatten(node.props.children);
  const originalIcon = head.find((child) => child?.props?.rel === "icon");
  const children = head.filter(
    (child) =>
      child?.props?.rel !== "icon" &&
      !socialImageMeta.has(child?.props?.property ?? child?.props?.name),
  );
  const base =
    `https://${props.cfg.baseUrl || "example.invalid"}`.replace(/\/+$/u, "") +
    "/";
  const image = new URL("static/english-encyclopedia-og.png", base).href;
  const alt = "English Encyclopedia — Words, usage, and connections";
  const metadata = {
    "og:image": image,
    "og:image:url": image,
    "og:image:secure_url": image,
    "og:image:type": "image/png",
    "og:image:width": "1200",
    "og:image:height": "630",
    "og:image:alt": alt,
    "twitter:image": image,
    "twitter:image:alt": alt,
  };
  return createElement(
    "head",
    {},
    ...children,
    createElement("link", {
      rel: "icon",
      type: "image/svg+xml",
      href: String(originalIcon?.props.href ?? "./static/icon.png").replace(
        /icon\.png$/u,
        "favicon.svg",
      ),
    }),
    ...Object.entries(metadata).map(([key, content]) =>
      createElement("meta", {
        [key.startsWith("twitter:") ? "name" : "property"]: key,
        content,
      }),
    ),
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
