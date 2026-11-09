import { graphMomentum, graphZoomLimits } from "./graph-momentum";
import { graphCircles } from "./graph-circles";
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
// Disable the stock label reveal; close-up labels follow the custom zoom curve.
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
const graphLayers =
  "var te=new a.Container,re=new a.Container,vu=new a.Container;nu.addChild(te),nu.addChild(re),nu.addChild(vu)";
const edgeCreation = 'U.eventMode="none",te.addChild(U)';
if (!runtime.includes(graphLayers) || !runtime.includes(edgeCreation))
  throw new Error("Graph highlight layer integration requires review");
// Shared parent keeps Pixi's hover tracking intact while zIndex orders all shapes.
runtime = runtime.replace(
  graphLayers,
  `
  var te=new a.Container,re=te,vu=new a.Container;
  te.label="graph-shapes";te.sortableChildren=true;vu.label="graph-labels";
  vu.eventMode="none";nu.addChild(te,vu)`,
);
runtime = runtime.replace(edgeCreation, 'U.label="graph-edge",' + edgeCreation);
runtime = runtime.replace(nodeEvents, 'U.eventMode="dynamic"');
// Keep graph shapes opaque and interpolate their colors on the existing frame loop.
const nodeFocus =
  "function Ke(){for(var i=0;i<P.length;i++){var l=P[i],F=1;_u!==null&&Oe&&(F=l.active?1:.2),l.gfx.alpha=F}}";
const linkFocus =
  "function Ve(){for(var i=0;i<I.length;i++){var l=I[i],F=1;_u!==null&&(F=l.active?1:.2),l.alpha=F,l.color=l.active?ue:ee}}";
const nodeCircle =
  "var U=new a.Graphics;U.circle(0,0,Tu),U.fill({color:ie?He:De}),ie&&U.stroke({width:2,color:Qu})";
const circleSetup = "var P=[],I=[],_u=null";
const frameLoop = "function se(){if(!le){";
for (const fragment of [
  nodeFocus,
  linkFocus,
  frameLoop,
  nodeCircle,
  circleSetup,
])
  if (!runtime.includes(fragment))
    throw new Error("Graph color transition integration requires review");
runtime = runtime.replace(circleSetup, `${graphCircles};${circleSetup}`);
// Tag nodes are disabled above; article nodes use a shared analytic-circle batch.
runtime = runtime.replace(
  nodeCircle,
  "var U=graphCreateCircle(Tu*.45);U.tint=ie?He:De",
);
runtime = runtime.replace(
  nodeFocus,
  `
var graphReducedMotion=window.matchMedia("(prefers-reduced-motion: reduce)");
function graphColor(value){return new a.Color(value).toNumber()}
// Blend the previous theme blue with the OGP blue (#255aca).
var graphEarlierBlue=graphColor(Ie);
var graphHoverBlue=(Math.round(((graphEarlierBlue>>16&255)+37)/2)<<16)
  |(Math.round(((graphEarlierBlue>>8&255)+90)/2)<<8)
  |Math.round(((graphEarlierBlue&255)+202)/2);
var graphBaseEdge=graphColor(ee),graphBackground=graphColor(He);
var graphDimEdge=(Math.round((graphBaseEdge>>16&255)*.25+(graphBackground>>16&255)*.75)<<16)
  |(Math.round((graphBaseEdge>>8&255)*.25+(graphBackground>>8&255)*.75)<<8)
  |Math.round((graphBaseEdge&255)*.25+(graphBackground&255)*.75);
function graphFade(item,current,target){
  item.fadeFrom=graphColor(current);item.fadeTo=graphColor(target);item.fadeStart=performance.now();
}
function graphBlend(item,now){
  if(item.fadeTo===undefined)return null;
  var progress=graphReducedMotion.matches?1:Math.min(1,(now-item.fadeStart)/100);
  var eased=progress*progress*(3-2*progress),from=item.fadeFrom,to=item.fadeTo;
  var color=(Math.round((from>>16&255)+((to>>16&255)-(from>>16&255))*eased)<<16)
    |(Math.round((from>>8&255)+((to>>8&255)-(from>>8&255))*eased)<<8)
    |Math.round((from&255)+((to&255)-(from&255))*eased);
  if(progress===1)item.fadeTo=undefined;
  return color;
}
function Ke(){for(var i=0;i<P.length;i++){
  var node=P[i],target=_u!==null&&Oe&&!node.active?ee:node.color;
  if(node.simulationData.id===_u)target=graphHoverBlue;
  node.gfx.zIndex=_u!==null&&node.active?(node.simulationData.id===_u?4:3):1;
  node.hoverFrom=node.hoverAmount||0;node.hoverTarget=node.simulationData.id===_u?1:0;
  node.gfx.alpha=1;graphFade(node,node.gfx.tint,target);
}}`,
);
runtime = runtime.replace(
  linkFocus,
  `function Ve(){for(var i=0;i<I.length;i++){
  var link=I[i];link.gfx.zIndex=_u!==null&&link.active?2:0;
  link.alpha=1;graphFade(link,link.color,link.active?graphHoverBlue:_u!==null?graphDimEdge:ee);
}}`,
);
runtime = runtime.replace(
  frameLoop,
  `${frameLoop}
  var graphFrameTime=performance.now(),graphLayoutScale=graphNodeSize(j.k)/j.k;
  for(var graphNode of P){
    var previousHover=graphNode.hoverAmount||0;
    var nodeColor=graphBlend(graphNode,graphFrameTime);if(nodeColor!==null)graphNode.gfx.tint=nodeColor;
    var hoverProgress=graphReducedMotion.matches?1:Math.min(1,(graphFrameTime-graphNode.fadeStart)/100);
    hoverProgress=hoverProgress*hoverProgress*(3-2*hoverProgress);
    graphNode.hoverAmount=graphNode.hoverFrom+(graphNode.hoverTarget-graphNode.hoverFrom)*hoverProgress;
    graphNode.gfx.scale.set(graphLayoutScale*(1+.06*graphNode.hoverAmount));
    if(graphNode.hoverAmount!==previousHover)graphSetTitleSize(graphNode);
  }
  for(var graphLink of I){var linkColor=graphBlend(graphLink,graphFrameTime);if(linkColor!==null)graphLink.color=linkColor;}
`,
);
// Nodes scale gently at low/medium zoom, then proportionally for close inspection.
// Edge strokes and the extra drag tolerance remain fixed in screen pixels.
const zoomPosition = "nu.position.set(j.x,j.y);";
const edgeStroke = "C.gfx.stroke({alpha:C.alpha,width:1,color:C.color})";
const dragHit = "if(J<gu+5)";
const zoomExtent = ".scaleExtent([.25,4])";
for (const fragment of [zoomPosition, edgeStroke, dragHit, zoomExtent])
  if (!runtime.includes(fragment))
    throw new Error("Graph zoom geometry integration requires review");
runtime = runtime.replace(
  zoomPosition,
  `${zoomPosition}
  for(var zoomNode of P)zoomNode.gfx.scale.set(graphNodeSize(j.k)/j.k*(1+.06*(zoomNode.hoverAmount||0)));`,
);
runtime = runtime.replace(
  "function Ke(){",
  `function graphNodeSize(zoom){
    // Smoothly increase logarithmic growth from 1/2 to 1 around 12x.
    return Math.sqrt(zoom)*Math.pow((144+zoom*zoom)/145,.25);
  }
  // Hovered font size in screen pixels: a low-zoom floor, smoothly becoming linear.
  function graphTitleSize(zoom){return 8*Math.sqrt(1+Math.pow(zoom/12,2));}
  // Unhovered font size in screen pixels, using the requested eighth-root curve.
  function graphDefaultTitleSize(zoom){return 8*Math.pow(1+Math.pow(zoom/12,8),1/8);}
  function graphSetTitleSize(node){
    var normal=graphDefaultTitleSize(j.k),hover=graphTitleSize(j.k);
    var size=normal+(hover-normal)*(node.hoverAmount||0);
    // Use the base radius; only the hovered name receives the font enlargement.
    node.label.scale.set(size/(j.k*node.label.style.fontSize)*Math.pow(node.radius/1.35,Math.log2(1.3)));
  }
  var graphLabelTextureLimit=Q.renderer.gl?Q.renderer.gl.getParameter(Q.renderer.gl.MAX_TEXTURE_SIZE)
    :Q.renderer.gpu?.device?.limits?.maxTextureDimension2D||8192;
  function graphRefreshLabelQuality(){
    var pixelRatio=window.devicePixelRatio||1,baseResolution=pixelRatio*4;
    for(var node of P){
      var label=node.label,screenScale=label.scale.x*j.k;
      var x=j.x+label.position.x*j.k,y=j.y+label.position.y*j.k;
      var halfWidth=node.titleWidth*screenScale/2,height=node.titleHeight*screenScale;
      var visible=label.alpha>0&&x+halfWidth>=-16&&x-halfWidth<=O+16&&y+height>=-16&&y<=G+16;
      if(label.renderable!==visible)label.renderable=visible;
      if(!visible)continue;
      var needed=Math.max(baseResolution,Math.pow(2,Math.ceil(Math.log2(pixelRatio*screenScale*1.25))));
      var limit=graphLabelTextureLimit/Math.ceil(Math.max(node.titleWidth,node.titleHeight)+4);
      var resolution=Math.min(needed,limit);
      // Increase detail before bitmap magnification; retain a little headroom
      // when zooming out so wheel movement near a boundary does not thrash textures.
      if(label.resolution<resolution||label.resolution>resolution*2.5)label.resolution=resolution;
    }
  }
  function graphLabelOpacity(zoom){
    var progress=Math.max(0,Math.min(1,Math.log2(zoom/8)/Math.log2(12/8)));
    return progress*progress*(3-2*progress);
  }function Ke(){`,
);

runtime = runtime.replace(
  edgeStroke,
  "C.gfx.stroke({alpha:C.alpha,width:1/j.k,color:C.color})",
);
runtime = runtime.replace(
  dragHit,
  "if(J<(gu*.45*graphNodeSize(j.k)*(1+.06*(P[v].hoverAmount||0))+5)/j.k)",
);
runtime = runtime.replace(
  zoomExtent,
  `.scaleExtent([${graphZoomLimits.minimum},${graphZoomLimits.maximum}])`,
);
const labelFocus =
  "function qe(){for(var i=1/Vu,l=i*1.1,F=0;F<P.length;F++){var v=P[F];_u===v.simulationData.id?(v.label.alpha=1,v.label.scale.set(l)):v.label.scale.set(i)}}";
const zoomLabels =
  "for(var l=j.k*Me,F=Math.max((l-1)/3.75,0),v=[],C=0;C<P.length;C++)P[C].active&&v.push(P[C].label);for(var C=0;C<vu.children.length;C++){var T=vu.children[C];v.indexOf(T)===-1&&(T.alpha=F)}";
for (const fragment of [labelFocus, zoomLabels])
  if (!runtime.includes(fragment))
    throw new Error("Graph title scaling integration requires review");
runtime = runtime.replace(
  labelFocus,
  `function qe(){
  var opacity=graphLabelOpacity(j.k);
  for(var i=0;i<P.length;i++){
    var node=P[i],hovered=_u===node.simulationData.id;
    node.label.alpha=hovered?1:opacity;
    graphSetTitleSize(node);
  }
}`,
);
runtime = runtime.replace(zoomLabels, "qe();");
// Center the visible glyphs, including multiline titles, rather than the text
// texture's empty margins. Leave 0.7em below the circle; hover travel remains a
// fixed zoom-scaled distance, independent of vertex size or connectivity.
const titleFont = "fontSize:We*15";
const titleAnchor = "Du.anchor.set(.5,1.2)";
const titlePosition = "l.label.position.set(F+O/2,v+G/2)";
const nodeRecord =
  "P.push({simulationData:iu,gfx:U,label:Du,color:De,alpha:1,active:!1})";
for (const fragment of [titleFont, titleAnchor, titlePosition, nodeRecord])
  if (!runtime.includes(fragment))
    throw new Error("Graph title placement integration requires review");
runtime = runtime.replace(
  nodeRecord,
  "P.push({simulationData:iu,gfx:U,label:Du,color:De,alpha:1,active:!1,radius:Tu*.45,titleWidth:Du.getLocalBounds().width,titleHeight:Du.getLocalBounds().height})",
);
runtime = runtime.replace(titleFont, 'fontSize:We*5.04,align:"center",trim:!0');
runtime = runtime.replace(titleAnchor, "Du.label=ae,Du.anchor.set(.5,0)");
runtime = runtime.replace(
  titlePosition,
  "l.label.position.set(F+O/2,v+G/2+(l.radius+1.5*(l.hoverAmount||0))*graphLayoutScale+.7*l.label.style.fontSize*l.label.scale.y)",
);

// Refresh after positions and zoom transforms, before the next render frame.
const labelFrame = "requestAnimationFrame(se)}}";
if (!runtime.includes(labelFrame))
  throw new Error("Graph adaptive text rendering integration requires review");
runtime = runtime.replace(
  labelFrame,
  "graphRefreshLabelQuality();requestAnimationFrame(se)}}",
);

// Quartz's radial mode targets a ring. A zero-radius target provides inward
// gravity instead, balanced by the existing charge and collision forces.
const radialForce = /\.forceRadial\([^()]+\)\.strength\(\.2\)/gu;
if ([...runtime.matchAll(radialForce)].length !== 1)
  throw new Error("Graph gravity integration requires review");
runtime = runtime.replace(radialForce, ".forceRadial(0).strength(.12)");
// Fit the initial camera once after a short force warm-up. Subsequent pan/zoom
// remains owned by Quartz. Size changes refit the collection around its center.
const zoomSetup = "o.select(Q.canvas).call(et)";
if (!runtime.includes(zoomSetup))
  throw new Error("Graph camera integration requires review");
runtime = runtime.replace(
  zoomSetup,
  `${zoomSetup};
  function fitGraphCamera(){
    if(typeof graphStopMomentum==="function")graphStopMomentum();
    if(!ru.length)return;
    var fitBounds=ru.reduce(function(bounds,node){
      return [Math.min(bounds[0],node.x),Math.max(bounds[1],node.x),Math.min(bounds[2],node.y),Math.max(bounds[3],node.y)];
    },[Infinity,-Infinity,Infinity,-Infinity]);
    var fitScale=Math.max(${graphZoomLimits.minimum},Math.min(1,(O-48)/Math.max(1,fitBounds[1]-fitBounds[0]),(G-48)/Math.max(1,fitBounds[3]-fitBounds[2])));
    et.extent([[0,0],[O,G]]);
    o.select(Q.canvas).call(et.transform,o.zoomIdentity.translate(O/2,G/2).scale(fitScale).translate(-O/2-(fitBounds[0]+fitBounds[1])/2,-G/2-(fitBounds[2]+fitBounds[3])/2));
  }
  ou.tick(100);fitGraphCamera();
  var graphResizeObserver=new ResizeObserver(function(){
    var width=_.offsetWidth,height=Math.max(_.offsetHeight,250);
    if(width!==O||height!==G){O=width;G=height;Q.renderer.resize(O,G);fitGraphCamera();}
  });
  graphResizeObserver.observe(_);
  var graphRefit=function(){requestAnimationFrame(function(){if(!le)fitGraphCamera();})};
  window.addEventListener("graph-window-change",graphRefit);
  ${graphMomentum}`,
);
const graphCleanup = "function(){le=!0,ou.stop();";
if (!runtime.includes(graphCleanup))
  throw new Error("Graph resize cleanup integration requires review");
runtime = runtime.replace(
  graphCleanup,
  'function(){typeof graphDisposeMomentum==="function"&&graphDisposeMomentum();graphResizeObserver&&graphResizeObserver.disconnect();graphRefit&&window.removeEventListener("graph-window-change",graphRefit);le=!0,ou.stop();graphDisposeCircles();',
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
