/** Analytic circles inside the pinned Pixi renderer, batched as four-vertex quads. */
export const graphCircles = String.raw`
  var graphCircleName="graph-circle";
  if(!a.BatcherPipe._availableBatchers[graphCircleName]){
    class GraphCircleBatcher extends a.DefaultBatcher{
      constructor(){
        super({maxTextures:1});this.name=graphCircleName;
        this.vertexSize=7;
        for(var attribute of Object.values(this.geometry.attributes))attribute.stride=28;
        this.geometry.addAttribute("aCircleWidth",{buffer:this.geometry.buffers[0],format:"float32",stride:28,offset:24});
        var gpuCoverage={name:"circle-coverage",vertex:{
          header:"@in aCircleWidth: f32;\n@out vCircleWidth: f32;",
          main:"vCircleWidth = aCircleWidth;"
        },fragment:{header:"@in vCircleWidth: f32;",end:
          "let circleDistance = length(vUV * 2.0 - 1.0) - 1.0;\n"+
          "let circleWidth = max(vCircleWidth, 0.00001);\n"+
          "finalColor *= 1.0 - smoothstep(-0.5 * circleWidth, 0.5 * circleWidth, circleDistance);"
        }};
        this.shader=new a.Shader({
          // Explicit high precision also works on WebGL 1: the AA width is
          // supplied per circle, so no fragment-derivative extension is needed.
          glProgram:a.GlProgram.from({name:graphCircleName,vertex:
            "precision highp float;\n"+
            "in vec2 aPosition; in vec2 aUV; in vec4 aColor; in float aCircleWidth;\n"+
            "uniform mat3 uProjectionMatrix; uniform mat3 uWorldTransformMatrix; uniform vec4 uWorldColorAlpha;\n"+
            "out vec2 vUV; out vec4 vColor; out float vCircleWidth;\n"+
            "void main(){\n"+
            "gl_Position=vec4((uProjectionMatrix*uWorldTransformMatrix*vec3(aPosition,1.0)).xy,0.0,1.0);\n"+
            "vUV=aUV; vColor=vec4(aColor.rgb*aColor.a,aColor.a)*uWorldColorAlpha; vCircleWidth=aCircleWidth;\n}",
            fragment:
            "precision highp float;\n"+
            "in vec2 vUV; in vec4 vColor; in float vCircleWidth; uniform sampler2D uTextures[1]; out vec4 finalColor;\n"+
            "void main(){\n"+
            "float distance=length(vUV*2.0-1.0)-1.0; float width=max(vCircleWidth,0.00001);\n"+
            "float coverage=1.0-smoothstep(-0.5*width,0.5*width,distance);\n"+
            "finalColor=texture(uTextures[0],vec2(0.5))*vColor*coverage;\n}"
          }),
          gpuProgram:a.compileHighShaderGpuProgram({name:graphCircleName,bits:[a.colorBit,a.generateTextureBatchBit(1),a.roundPixelsBit,gpuCoverage]}),
          resources:{batchSamplers:a.getBatchSamplersUniformGroup(1)}
        });
      }
      packAttributes(element,floats,colors,index,textureId){
        var transform=element.transform,radius=element.renderable.graphCircleRadius;
        // Leave room beyond the mathematical boundary for a one-pixel AA fringe.
        // Bounds and hit testing still describe the exact, unpadded circle.
        var scale=Math.min(Math.hypot(transform.a,transform.b),Math.hypot(transform.c,transform.d));
        var padding=1/(element.renderable.graphCircleResolution*Math.max(scale,.000001));
        var positions=element.positions,argb=element.color;
        for(var vertex=0;vertex<4;vertex++){
          var x=positions[vertex*2]+Math.sign(positions[vertex*2])*padding;
          var y=positions[vertex*2+1]+Math.sign(positions[vertex*2+1])*padding;
          floats[index++]=transform.a*x+transform.c*y+transform.tx;
          floats[index++]=transform.b*x+transform.d*y+transform.ty;
          floats[index++]=.5+x/(2*radius);floats[index++]=.5+y/(2*radius);
          colors[index++]=argb;colors[index++]=textureId<<16;
          floats[index++]=padding/radius;
        }
      }
      destroy(){
        // Packed entries have already been released by Batcher.break().
        this._elements=[];super.destroy();this.geometry.destroy();this.shader.destroy();
      }
    }
    GraphCircleBatcher.extension={type:a.ExtensionType.Batcher,name:graphCircleName};
    a.extensions.add(GraphCircleBatcher);
  }
  // A dedicated pipe avoids modifying Pixi's mesh/sprite pipes or their pools.
  class GraphCirclePipe{
    constructor(renderer){
      this.renderer=renderer;this._circles=Object.create(null);
      this._destroyBound=this.destroyRenderable.bind(this);
      renderer.renderableGC.addManagedHash(this,"_circles");
    }
    element(mesh){
      if(this._circles[mesh.uid])return this._circles[mesh.uid];
      var element=new a.BatchableMesh;
      element.batcherName=graphCircleName;element.renderable=mesh;
      element.geometry=mesh.geometry;element.texture=a.Texture.WHITE;
      element.transform=mesh.groupTransform;this._circles[mesh.uid]=element;
      mesh.on("destroyed",this._destroyBound);return element;
    }
    addRenderable(mesh,instructions){this.renderer.renderPipes.batch.addToBatch(this.element(mesh),instructions);}
    updateRenderable(mesh){var element=this.element(mesh);element._batcher.updateElement(element);}
    validateRenderable(){return false;}
    destroyRenderable(mesh){
      var element=this._circles[mesh.uid];if(element)element.reset();
      delete this._circles[mesh.uid];mesh.off("destroyed",this._destroyBound);
    }
    destroy(){
      for(var id in this._circles)this.destroyRenderable(this._circles[id].renderable);
      this.renderer=null;
    }
  }
  var graphCirclePipe=new GraphCirclePipe(Q.renderer),graphCircleGeometries=new Map;
  Q.renderer.renderPipes[graphCircleName]=graphCirclePipe;
  function graphCreateCircle(radius){
    var geometry=graphCircleGeometries.get(radius);
    if(!geometry){
      geometry=new a.MeshGeometry({positions:new Float32Array([-radius,-radius,radius,-radius,radius,radius,-radius,radius])});
      graphCircleGeometries.set(radius,geometry);
    }
    var circle=new a.Mesh({geometry:geometry});circle.renderPipeId=graphCircleName;
    circle.graphCircleRadius=radius;circle.graphCircleResolution=Q.renderer.resolution;
    circle.hitArea=new a.Circle(0,0,radius);return circle;
  }
  function graphDisposeCircles(){
    graphCirclePipe.destroy();delete Q.renderer.renderPipes[graphCircleName];
    for(var groups of Object.values(Q.renderer.renderPipes.batch._batchersByInstructionSet)){
      if(groups[graphCircleName]){groups[graphCircleName].destroy();delete groups[graphCircleName];}
    }
    for(var geometry of graphCircleGeometries.values())geometry.destroy();
    graphCircleGeometries.clear();
  }
`;
