/** Runs inside the guarded Quartz graph renderer, sharing its D3 camera. */
export const graphMomentum = String.raw`
  var graphZoomSelection=o.select(Q.canvas),graphZoomFrame=0,graphZoomLastFrame=0;
  var graphZoomTarget=Math.log(j.k),graphZoomDirection=0,graphZoomLastInput=0;
  var graphZoomPoint=[0,0],graphZoomAnchor=[0,0];
  var graphZoomMinimum=Math.log(.25),graphZoomMaximum=Math.log(256);
  var graphStopMomentum=function(){
    cancelAnimationFrame(graphZoomFrame);graphZoomFrame=0;graphZoomLastFrame=0;
    graphZoomTarget=Math.log(o.zoomTransform(Q.canvas).k);graphZoomDirection=0;
  };
  function graphApplyZoom(logScale){
    var scale=logScale===graphZoomMaximum?256:logScale===graphZoomMinimum?.25:Math.exp(logScale);
    var transform=o.zoomIdentity.translate(graphZoomPoint[0]-graphZoomAnchor[0]*scale,graphZoomPoint[1]-graphZoomAnchor[1]*scale).scale(scale);
    graphZoomSelection.call(et.transform,transform);
  }
  function graphAdvanceZoom(now){
    graphZoomFrame=0;
    if(le)return;
    var current=Math.log(o.zoomTransform(Q.canvas).k),remaining=graphZoomTarget-current;
    var elapsed=Math.min(64,Math.max(0,now-graphZoomLastFrame));graphZoomLastFrame=now;
    if(graphReducedMotion.matches||Math.abs(remaining)<.0005){graphApplyZoom(graphZoomTarget);return;}
    graphApplyZoom(current+remaining*(1-Math.exp(-elapsed/105)));
    graphZoomFrame=requestAnimationFrame(graphAdvanceZoom);
  }
  function graphWheelZoom(event){
    if(!event.deltaY)return;
    event.preventDefault();event.stopPropagation();
    var change=-event.deltaY*(event.deltaMode===1?.05:event.deltaMode===2?1:.002)*(event.ctrlKey?10:1)*Math.LN2;
    var now=performance.now(),direction=Math.sign(change),current=o.zoomTransform(Q.canvas);
    // Reversing direction cancels queued motion rather than fighting its tail.
    if(!graphZoomFrame||direction!==graphZoomDirection||now-graphZoomLastInput>220)graphZoomTarget=Math.log(current.k);
    graphZoomDirection=direction;graphZoomLastInput=now;
    graphZoomTarget=Math.max(graphZoomMinimum,Math.min(graphZoomMaximum,graphZoomTarget+change));
    var bounds=Q.canvas.getBoundingClientRect();
    graphZoomPoint=[event.clientX-bounds.left,event.clientY-bounds.top];
    graphZoomAnchor=current.invert(graphZoomPoint);
    if(graphReducedMotion.matches){graphStopMomentum();graphApplyZoom(Math.max(graphZoomMinimum,Math.min(graphZoomMaximum,Math.log(current.k)+change)));return;}
    if(!graphZoomFrame){graphZoomLastFrame=now;graphZoomFrame=requestAnimationFrame(graphAdvanceZoom);}
  }
  function graphHideMomentum(){if(document.hidden)graphStopMomentum();}
  // Keep native D3 dragging/touch pinch; replace only its immediate wheel zoom.
  graphZoomSelection.on("wheel.zoom",null);
  Q.canvas.addEventListener("wheel",graphWheelZoom,{passive:false});
  Q.canvas.addEventListener("pointerdown",graphStopMomentum);
  Q.canvas.addEventListener("touchstart",graphStopMomentum,{passive:true});
  window.addEventListener("graph-window-change",graphStopMomentum);
  document.addEventListener("visibilitychange",graphHideMomentum);
  graphReducedMotion.addEventListener("change",graphStopMomentum);
  var graphDisposeMomentum=function(){
    graphStopMomentum();
    Q.canvas.removeEventListener("wheel",graphWheelZoom);
    Q.canvas.removeEventListener("pointerdown",graphStopMomentum);
    Q.canvas.removeEventListener("touchstart",graphStopMomentum);
    window.removeEventListener("graph-window-change",graphStopMomentum);
    document.removeEventListener("visibilitychange",graphHideMomentum);
    graphReducedMotion.removeEventListener("change",graphStopMomentum);
  };
`;
