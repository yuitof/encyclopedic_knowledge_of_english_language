import { Graph } from "@quartz-community/graph";
import type { QuartzComponent } from "../quartz/components/types";
import { pathToRoot } from "../quartz/util/path";
// @ts-ignore: Quartz imports inline scripts as strings.
import controls from "./graph-page.inline";

const stock = Graph({
  localGraph: { depth: -1, showTags: false, enableRadial: false },
  globalGraph: { showTags: false },
}) as QuartzComponent;
// Adapt the pinned official plugin's two runtime URLs; keep its graph engine unchanged.
let runtime = [stock.afterDOMLoaded ?? ""].flat().join("\n");
for (const [remote, local] of [
  ["https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js", "d3.min.js"],
  ["https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.js", "pixi.min.js"],
]) {
  const literal = JSON.stringify(remote);
  if (!runtime.includes(literal))
    throw new Error("Graph runtime changed: review the local asset adapter");
  runtime = runtime.replace(
    literal,
    `((document.body.dataset.basepath || "") + "/static/graph/${local}")`,
  );
}
const resizeHook = 'document.addEventListener("themechange",R)';
if (!runtime.includes(resizeHook))
  throw new Error("Graph resize integration requires review");
runtime = runtime.replace(
  resizeHook,
  `${resizeHook};var resizeTimer;window.addEventListener("resize",function(){clearTimeout(resizeTimer);resizeTimer=setTimeout(R,200)})`,
);
export const GraphPage: QuartzComponent = (props) => {
  if (props.fileData.slug !== "graph") return null;
  const notes = props.allFiles
    .filter(
      (file) =>
        file.slug?.startsWith("articles/") && file.slug !== "articles/index",
    )
    .sort((a, b) =>
      String(a.frontmatter?.title).localeCompare(
        String(b.frontmatter?.title),
        "en",
      ),
    );
  return (
    <section class="graph-page" aria-label="Published note connections">
      {stock(props)}
      <p class="graph-help">
        Drag to move notes, scroll to zoom, and click a note to open it. Blank
        pages represent missing notes referenced by published articles.
      </p>
      <div class="graph-note-browser">
        <label for="graph-note">Open a note with the keyboard</label>
        <select id="graph-note">
          <option value="">Choose a note</option>
          {notes.map((note) => (
            <option value={`${pathToRoot(props.fileData.slug!)}/${note.slug}`}>
              {note.frontmatter?.title}
            </option>
          ))}
        </select>
        <a class="graph-selected-note" hidden>
          Open selected note
        </a>
      </div>
      <noscript>
        <p>
          The interactive graph needs JavaScript.{" "}
          <a href={`${pathToRoot(props.fileData.slug!)}/articles/`}>
            Browse all articles
          </a>
          .
        </p>
      </noscript>
    </section>
  );
};
GraphPage.css = stock.css;
// Load the graph's runtime only after entering this page, including through SPA navigation.
GraphPage.afterDOMLoaded = [
  `let graphRuntimeStarted=false;function startGraphRuntime(){if(!graphRuntimeStarted&&document.querySelector(".graph-page")){graphRuntimeStarted=true;(function(){${runtime} })();}}document.addEventListener("nav",startGraphRuntime);document.addEventListener("render",startGraphRuntime);startGraphRuntime();`,
  controls,
];
