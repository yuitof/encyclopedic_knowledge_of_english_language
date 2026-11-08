import { Graph } from "@quartz-community/graph";
import type { QuartzComponent } from "../quartz/components/types";
import { pathToRoot } from "../quartz/util/path";
// @ts-ignore: Quartz imports inline scripts as strings.
import windowControls from "./graph-window.inline";

const graphForces = {
  repelForce: 0.025,
  centerForce: 0.6,
  linkDistance: 18,
  enableRadial: true,
  focusOnHover: true,
  opacityScale: 0,
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
// Preserve an explicit zero: labels must stay hidden during zoom and appear
// only through Quartz's existing node-hover behavior.
const opacityDefault = "S.opacityScale||1";
if (!runtime.includes(opacityDefault))
  throw new Error("Graph label-opacity integration requires review");
runtime = runtime.replace(opacityDefault, "S.opacityScale??1");
// Invisible text must not intercept the node underneath it. Dynamic nodes also
// update hover when the force simulation moves them under a stationary cursor.
const labelLayer = "nu.addChild(vu)";
const nodeEvents = 'U.eventMode="static"';
if (!runtime.includes(labelLayer) || !runtime.includes(nodeEvents))
  throw new Error("Graph pointer interaction requires review");
runtime = runtime.replace(labelLayer, `vu.eventMode="none",${labelLayer}`);
runtime = runtime.replace(nodeEvents, 'U.eventMode="dynamic"');
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
  `${zoomSetup};
  function fitGraphCamera(){if(!ru.length)return;
    var fitBounds=ru.reduce(function(bounds,node){
      return [Math.min(bounds[0],node.x),Math.max(bounds[1],node.x),Math.min(bounds[2],node.y),Math.max(bounds[3],node.y)];
    },[Infinity,-Infinity,Infinity,-Infinity]);
    var fitScale=Math.max(.25,Math.min(1,(O-48)/Math.max(1,fitBounds[1]-fitBounds[0]),(G-48)/Math.max(1,fitBounds[3]-fitBounds[2])));
    et.extent([[0,0],[O,G]]);
    o.select(Q.canvas).call(et.transform,o.zoomIdentity.translate(O/2,G/2).scale(fitScale).translate(-O/2-(fitBounds[0]+fitBounds[1])/2,-G/2-(fitBounds[2]+fitBounds[3])/2));
  }
  ou.tick(100);fitGraphCamera();
  var graphResizeObserver=new ResizeObserver(function(){
    var width=_.offsetWidth,height=Math.max(_.offsetHeight,250);
    if(width!==O||height!==G){O=width;G=height;Q.renderer.resize(O,G);fitGraphCamera();}
  });
  graphResizeObserver.observe(_);`,
);
const graphCleanup = "function(){le=!0,ou.stop();";
if (!runtime.includes(graphCleanup))
  throw new Error("Graph resize cleanup integration requires review");
runtime = runtime.replace(
  graphCleanup,
  "function(){graphResizeObserver&&graphResizeObserver.disconnect();le=!0,ou.stop();",
);
export const GraphPage: QuartzComponent = (props) => {
  if (props.fileData.slug !== "graph") return null;
  return (
    <section class="graph-page" aria-label="Published note connections">
      <div class="graph-window">
        {stock(props)}
        <button
          type="button"
          class="graph-expand-button"
          hidden
          aria-label="Expand graph to fill window"
          title="Expand graph to fill window"
          aria-expanded="false"
          aria-haspopup="dialog"
          aria-controls="graph-window-dialog"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <path
              class="graph-expand-icon"
              d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"
            />
            <path
              class="graph-restore-icon"
              d="M3 8h5V3M16 3v5h5M8 21v-5H3M21 16h-5v5"
            />
          </svg>
        </button>
      </div>
      <dialog
        id="graph-window-dialog"
        class="graph-window-dialog"
        aria-label="Expanded graph view"
      />
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
  windowControls,
];
