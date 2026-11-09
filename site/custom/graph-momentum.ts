export const graphZoomLimits = { minimum: 0.15, maximum: 50 };

/** Runs inside the guarded Quartz graph renderer, sharing its D3 camera. */
export const graphMomentum = String.raw`
  var graphZoomSelection=o.select(Q.canvas),graphZoomFrame=0,graphZoomLastFrame=0;
  var graphZoomTarget=Math.log(j.k),graphZoomDirection=0,graphZoomLastInput=0;
  var graphZoomPoint=[0,0],graphZoomAnchor=[0,0];
  var graphZoomMinimum=Math.log(${graphZoomLimits.minimum}),graphZoomMaximum=Math.log(${graphZoomLimits.maximum});
  var graphPinchSlope=Math.log(49)/2;
  function graphPinchSensitivity(logScale){
    // Keep the accepted sensitivity curve independent of the hard zoom limits.
    var stops=logScale/Math.LN2;
    return 1/((1+Math.exp(-stops*graphPinchSlope))*(1+Math.exp((stops-6)*graphPinchSlope)));
  }
  function graphPinchTarget(logScale,change){
    // Integrate across the curve so a large gesture cannot skip its shoulders.
    // Small midpoint steps also keep event batching from changing the feel.
    var steps=Math.max(1,Math.ceil(Math.abs(change)/(.25*Math.LN2))),step=change/steps;
    for(var i=0;i<steps;i++){
      var midpoint=logScale+step*.5*graphPinchSensitivity(logScale);
      logScale=Math.max(graphZoomMinimum,Math.min(graphZoomMaximum,logScale+step*graphPinchSensitivity(midpoint)));
      if(logScale===graphZoomMinimum||logScale===graphZoomMaximum)break;
    }
    return logScale;
  }
  var graphStopMomentum=function(){
    cancelAnimationFrame(graphZoomFrame);graphZoomFrame=0;graphZoomLastFrame=0;
    graphZoomTarget=Math.log(o.zoomTransform(Q.canvas).k);graphZoomDirection=0;
  };
  function graphApplyZoom(logScale){
    var scale=logScale===graphZoomMaximum?${graphZoomLimits.maximum}:logScale===graphZoomMinimum?${graphZoomLimits.minimum}:Math.exp(logScale);
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
    graphZoomTarget=event.ctrlKey?graphPinchTarget(graphZoomTarget,change)
      :Math.max(graphZoomMinimum,Math.min(graphZoomMaximum,graphZoomTarget+change));
    var bounds=Q.canvas.getBoundingClientRect();
    graphZoomPoint=[event.clientX-bounds.left,event.clientY-bounds.top];
    graphZoomAnchor=current.invert(graphZoomPoint);
    if(graphReducedMotion.matches){var target=graphZoomTarget;graphStopMomentum();graphApplyZoom(target);return;}
    if(!graphZoomFrame){graphZoomLastFrame=now;graphZoomFrame=requestAnimationFrame(graphAdvanceZoom);}
  }
  // Touchscreen pinch uses the same curve. Keep D3's native one-finger pan,
  // gesture lifecycle and touch anchors; only adjust two-finger camera changes.
  var graphTouchPinch=null,graphApplyingPinch=false,graphNativeZoom=et.on("zoom");
  function graphTouchPoints(event){
    if(event.touches.length!==2)return null;
    var first=event.touches[0],second=event.touches[1],bounds=Q.canvas.getBoundingClientRect();
    var distance=Math.hypot(second.clientX-first.clientX,second.clientY-first.clientY);
    return distance>0?{distance:distance,point:[(first.clientX+second.clientX)/2-bounds.left,(first.clientY+second.clientY)/2-bounds.top]}:null;
  }
  function graphResetTouchPinch(event){graphTouchPinch=graphTouchPoints(event);}
  et.on("zoom",function(event){
    var source=event.sourceEvent;
    if(!graphApplyingPinch&&source?.type==="touchmove"&&source.touches.length===2){
      var next=graphTouchPoints(source),previous=graphTouchPinch;graphTouchPinch=next;
      if(next&&previous){
        var scale=Math.exp(graphPinchTarget(Math.log(j.k),Math.log(next.distance/previous.distance)));
        var anchor=j.invert(previous.point),transform=o.zoomIdentity
          .translate(next.point[0]-anchor[0]*scale,next.point[1]-anchor[1]*scale).scale(scale);
        graphApplyingPinch=true;
        try{graphZoomSelection.call(et.transform,transform);}finally{graphApplyingPinch=false;}
        return;
      }
    }
    graphNativeZoom.call(this,event);
  });
  function graphHideMomentum(){if(document.hidden)graphStopMomentum();}
  // Trackpad pinch arrives as ctrl+wheel; ordinary mouse wheels keep their curve.
  graphZoomSelection.on("wheel.zoom",null);
  Q.canvas.addEventListener("wheel",graphWheelZoom,{passive:false});
  Q.canvas.addEventListener("pointerdown",graphStopMomentum);
  Q.canvas.addEventListener("touchstart",graphStopMomentum,{passive:true});
  for(var type of ["touchstart","touchend","touchcancel"])Q.canvas.addEventListener(type,graphResetTouchPinch,{capture:true,passive:true});
  window.addEventListener("graph-window-change",graphStopMomentum);
  document.addEventListener("visibilitychange",graphHideMomentum);
  graphReducedMotion.addEventListener("change",graphStopMomentum);
  var graphDisposeMomentum=function(){
    graphStopMomentum();
    Q.canvas.removeEventListener("wheel",graphWheelZoom);
    Q.canvas.removeEventListener("pointerdown",graphStopMomentum);
    Q.canvas.removeEventListener("touchstart",graphStopMomentum);
    for(var type of ["touchstart","touchend","touchcancel"])Q.canvas.removeEventListener(type,graphResetTouchPinch,true);
    et.on("zoom",graphNativeZoom);graphTouchPinch=null;
    window.removeEventListener("graph-window-change",graphStopMomentum);
    document.removeEventListener("visibilitychange",graphHideMomentum);
    graphReducedMotion.removeEventListener("change",graphStopMomentum);
  };
`;
