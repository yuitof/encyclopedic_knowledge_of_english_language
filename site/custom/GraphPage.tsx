import { Graph } from "@quartz-community/graph";
import type { QuartzComponent } from "../quartz/components/types";
import { pathToRoot } from "../quartz/util/path";

const graphForces = {
  repelForce: 0.025,
  centerForce: 0.6,
  linkDistance: 18,
  enableRadial: true,
};
const stock = Graph({
  localGraph: { ...graphForces, depth: -1, showTags: false },
  globalGraph: { ...graphForces, showTags: false },
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
// Quartz's radial mode targets a ring. A zero-radius target provides inward
// gravity instead, balanced by the existing charge and collision forces.
const radialForce = /\.forceRadial\([^()]+\)\.strength\(\.2\)/gu;
if ([...runtime.matchAll(radialForce)].length !== 1)
  throw new Error("Graph gravity integration requires review");
runtime = runtime.replace(radialForce, ".forceRadial(0).strength(.12)");
// Fit the initial camera once after a short force warm-up. Subsequent pan/zoom
// remains owned by Quartz, so interacting with the graph never resets the view.
const zoomSetup = "o.select(Q.canvas).call(et)";
if (!runtime.includes(zoomSetup))
  throw new Error("Graph camera integration requires review");
runtime = runtime.replace(
  zoomSetup,
  `${zoomSetup};if(ru.length){
  ou.tick(100);
  var fitBounds=ru.reduce(function(bounds,node){
    return [Math.min(bounds[0],node.x),Math.max(bounds[1],node.x),Math.min(bounds[2],node.y),Math.max(bounds[3],node.y)];
  },[Infinity,-Infinity,Infinity,-Infinity]);
  var fitScale=Math.max(.25,Math.min(1,(O-48)/Math.max(1,fitBounds[1]-fitBounds[0]),(G-48)/Math.max(1,fitBounds[3]-fitBounds[2])));
  o.select(Q.canvas).call(et.transform,o.zoomIdentity.translate(O/2,G/2).scale(fitScale).translate(-O/2-(fitBounds[0]+fitBounds[1])/2,-G/2-(fitBounds[2]+fitBounds[3])/2));
}`,
);
const resizeHook = 'document.addEventListener("themechange",R)';
if (!runtime.includes(resizeHook))
  throw new Error("Graph resize integration requires review");
runtime = runtime.replace(
  resizeHook,
  `${resizeHook};var resizeTimer;window.addEventListener("resize",function(){clearTimeout(resizeTimer);resizeTimer=setTimeout(R,200)})`,
);
export const GraphPage: QuartzComponent = (props) => {
  if (props.fileData.slug !== "graph") return null;
  return (
    <section class="graph-page" aria-label="Published note connections">
      {stock(props)}
      <p class="graph-help">
        Drag to move notes, scroll to zoom, and click a note to open it. Blank
        pages represent missing notes referenced by published articles.
      </p>
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
];
