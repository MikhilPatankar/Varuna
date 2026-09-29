import React, { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';

// ─── Voxel Provider ───────────────────────────────────────────────────────────
class OceanVoxelProvider {
  constructor(baseUrl, depthCount, maxDepthMeters) {
    this.baseUrl = baseUrl;
    this.depthCount = depthCount;
    this.globalTransform = Cesium.Matrix4.IDENTITY;
    this.shapeTransform  = Cesium.Matrix4.IDENTITY;
    this.shape = Cesium.VoxelShapeType.ELLIPSOID;

    // Bounds: ocean floor (z=-maxDepthMeters) UP to sea surface (z=0).
    // Cesium auto-applies scene.verticalExaggeration to these bounds.
    this.minBounds = new Cesium.Cartesian3(-Cesium.Math.PI, -Cesium.Math.PI_OVER_TWO, -maxDepthMeters);
    this.maxBounds = new Cesium.Cartesian3( Cesium.Math.PI,  Cesium.Math.PI_OVER_TWO, 0);

    this.dimensions     = new Cesium.Cartesian3(256, 256, depthCount);
    this.paddingBefore  = new Cesium.Cartesian3(0, 0, 0);
    this.paddingAfter   = new Cesium.Cartesian3(0, 0, 0);
    this.names          = ['temperature'];
    this.types          = [Cesium.MetadataType.SCALAR];
    this.componentTypes = [Cesium.MetadataComponentType.UINT8];
    this.minimumValues  = [[1]];
    this.maximumValues  = [[255]];
    this.maximumTileCount = 1;
    this.availableLevels  = 1; 
  }
  
  async requestData(options) {
    // Force fetch 0/0/0 which covers the full globe
    const url = this.baseUrl
        .replace('{z}', 0)
        .replace('{x}', 0)
        .replace('{y}', 0);
        
    try {
        const res = await fetch(url);
        if (!res.ok) return undefined;
        
        const buf = await new Response(
          res.body.pipeThrough(new DecompressionStream('gzip'))
        ).arrayBuffer();
        
        const data = new Uint8Array(buf);
        
        // Data flip: align backend depth ordering with Cesium's Z-to-altitude mapping.
        const gridXY = 256 * 256;
        const flippedData = new Uint8Array(data.length);
        for (let d = 0; d < this.depthCount; d++) {
          const src = this.depthCount - 1 - d;
          flippedData.set(data.subarray(src * gridXY, (src + 1) * gridXY), d * gridXY);
        }
        
        return new Cesium.VoxelContent({ metadata: [flippedData] });
    } catch(e) {
        console.warn(`[VOL] Failed to load tile ${tileLevel}/${tileX}/${tileY}:`, e);
        return undefined;
    }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function VolumetricOcean({ viewer, variable, timeKey, opacity = 100, oceanDepth = 0, oceanDensity = 25, colormapSettings }) {
  const primitiveRef = useRef(null);
  const [primitiveReady, setPrimitiveReady] = React.useState(false);

  useEffect(() => {
    if (!viewer) return;
    let active = true;
    setPrimitiveReady(false);

    if (primitiveRef.current) {
      viewer.scene.primitives.remove(primitiveRef.current);
      primitiveRef.current = null;
    }

    const baseUrl = `/api/v1/data/${variable}/daily/${timeKey}/tile/{z}/{x}/{y}`;
    const initialUrl = baseUrl.replace('{z}', 0).replace('{x}', 0).replace('{y}', 0);
    console.log('[VOL] Initializing provider from:', initialUrl);

    (async () => {
      try {
        // Fetch 0/0/0 just to get the metadata headers (min/max, depth layers)
        const res = await fetch(initialUrl, { method: 'HEAD' });
        if (!res.ok || !active) return;

        // ── Parse headers ────────────────────────────────────────────────
        const depthCount  = parseInt(res.headers.get('X-Depth-Count') || '48', 10);
        const depthLevels = (res.headers.get('X-Depth-Levels') || '')
          .split(',').map(Number).filter(isFinite);
        const actualMaxDepth = depthLevels.length > 0 ? Math.max(...depthLevels) : 5000;

        console.log('[VOL] depthCount:', depthCount, '| maxDepth:', actualMaxDepth, 'm');

        // ── Build primitive ──────────────────────────────────────────────
        const provider  = new OceanVoxelProvider(baseUrl, depthCount, actualMaxDepth);
        
        // CRITICAL: Without modelMatrix scaling, the ellipsoid defaults to 1 meter in size.
        // We must apply the WGS84 radii to match the globe.
        const primitive = new Cesium.VoxelPrimitive({ 
          provider,
          modelMatrix: Cesium.Matrix4.fromScale(Cesium.Ellipsoid.WGS84.radii)
        });
        
        // --- PERFORMANCE OPTIMIZATIONS ---
        // 1. maximumScreenSpaceError: Controls level of detail. Higher = faster, coarser LODs.
        primitive.maximumScreenSpaceError = 512; 
        
        // 2. stepSize: Controls raymarching step distance. By default Cesium computes this automatically,
        // which can result in thousands of steps if the depth is exaggerated. 
        // We scale stepSize linearly with depthFactor so performance stays locked at 60fps regardless of depth.
        const maxExpectedSteps = 64.0;
        primitive.stepSize = Math.max(0.5, (actualMaxDepth / 1000.0) / maxExpectedSteps);

        // Underground: enable depth test against terrain.
        // The globe has bathymetry (ocean floor is at z < 0, land is z > 0).
        // By rendering the voxel from -maxDepth to 0, and testing against terrain,
        // the voxel will perfectly fill the bathymetry valleys and be occluded by land!
        if (viewer.scene.globe) {
          viewer.scene.globe.depthTestAgainstTerrain = true;
          viewer.scene.globe.translucency.enabled = false;
        }

        // ── Custom shader ────────────────────────────────────────────────
        const backendVMin = parseFloat(res.headers.get('X-Value-Min') || '0');
        const backendVMax = parseFloat(res.headers.get('X-Value-Max') || '30');

        // Store these so we can use them in the fast-path useEffect
        if (primitiveRef.current) {
          primitiveRef.current.backendVMin = backendVMin;
          primitiveRef.current.backendVMax = backendVMax;
        }

        const baseOpacity = opacity > 1.0 ? opacity / 100.0 : opacity;
        // Non-linear mapping: 100% = 1.5 (fully opaque), 25% = ~0.023 (fine control)
        const baseDensity = Math.pow(oceanDensity / 100.0, 3) * 1.5;

        // Determine default colors if colormapSettings aren't fully loaded yet
        const colors = colormapSettings?.colors || ['#000080', '#0000ff', '#00ffff', '#ffff00', '#ff0000'];
        const c1 = Cesium.Color.fromCssColorString(colors[0] || '#000000');
        const c2 = Cesium.Color.fromCssColorString(colors[1] || '#000000');
        const c3 = Cesium.Color.fromCssColorString(colors[2] || '#000000');
        const c4 = Cesium.Color.fromCssColorString(colors[3] || '#000000');
        const c5 = Cesium.Color.fromCssColorString(colors[4] || '#000000');
        const uMin = colormapSettings?.uMin ?? backendVMin;
        const uMax = colormapSettings?.uMax ?? backendVMax;
        const uClipMin = (colormapSettings?.clipMin ?? 0) / 100.0;
        const uClipMax = (colormapSettings?.clipMax ?? 100) / 100.0;

        primitive.customShader = new Cesium.CustomShader({
          uniforms: { 
            u_opacity: { type: Cesium.UniformType.FLOAT, value: baseOpacity },
            u_density: { type: Cesium.UniformType.FLOAT, value: baseDensity },
            u_color1: { type: Cesium.UniformType.VEC3, value: new Cesium.Cartesian3(c1.red, c1.green, c1.blue) },
            u_color2: { type: Cesium.UniformType.VEC3, value: new Cesium.Cartesian3(c2.red, c2.green, c2.blue) },
            u_color3: { type: Cesium.UniformType.VEC3, value: new Cesium.Cartesian3(c3.red, c3.green, c3.blue) },
            u_color4: { type: Cesium.UniformType.VEC3, value: new Cesium.Cartesian3(c4.red, c4.green, c4.blue) },
            u_color5: { type: Cesium.UniformType.VEC3, value: new Cesium.Cartesian3(c5.red, c5.green, c5.blue) },
            u_backendMin: { type: Cesium.UniformType.FLOAT, value: backendVMin },
            u_backendMax: { type: Cesium.UniformType.FLOAT, value: backendVMax },
            u_userMin: { type: Cesium.UniformType.FLOAT, value: uMin },
            u_userMax: { type: Cesium.UniformType.FLOAT, value: uMax },
            u_clipMin: { type: Cesium.UniformType.FLOAT, value: uClipMin },
            u_clipMax: { type: Cesium.UniformType.FLOAT, value: uClipMax }
          },
          fragmentShaderText: `
            void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
              float val = fsInput.metadata.temperature;
              // 0 = land / NaN sentinel => fully transparent
              if (val < 0.002) { material.alpha = 0.0; return; }
              
              // 1. Decode byte to [0, 1] relative to the BACKEND's min/max bounds
              float t_byte = clamp((val * 255.0 - 1.0) / 254.0, 0.0, 1.0);
              
              // 2. Reconstruct the physical real-world value (e.g., actual temperature in °C)
              float physVal = mix(u_backendMin, u_backendMax, t_byte);
              
              // 3. Normalize the physical value against the USER's selected scale (from Dashboard UI)
              // This is how the min/max auto works exactly like dynamic adjustment!
              float t_user = clamp((physVal - u_userMin) / (u_userMax - u_userMin), 0.0, 1.0);
              
              // Isosurface clipping: if the value is outside the dual-slider range, make it invisible
              if (t_user < u_clipMin || t_user > u_clipMax) {
                material.alpha = 0.0;
                return;
              }
              
              // 4. Sample the active colormap (5 evenly spaced colors)
              vec3 color;
              if (t_user < 0.25) {
                color = mix(u_color1, u_color2, t_user * 4.0);
              } else if (t_user < 0.5) {
                color = mix(u_color2, u_color3, (t_user - 0.25) * 4.0);
              } else if (t_user < 0.75) {
                color = mix(u_color3, u_color4, (t_user - 0.5) * 4.0);
              } else {
                color = mix(u_color4, u_color5, (t_user - 0.75) * 4.0);
              }
              
              vec3 bright = pow(color + 0.001, vec3(0.35));
              material.diffuse = bright;
              // Dynamic alpha multiplier based on UI density slider
              material.alpha   = u_density * u_opacity;
            }
          `
        });

        viewer.scene.primitives.add(primitive);
        primitiveRef.current = primitive;
        setPrimitiveReady(true);

        // VoxelPrimitive needs ~60 render frames to warm up its GPU shaders
        let frames = 0;
        const forceRender = () => {
          if (frames++ < 60 && primitiveRef.current) {
            viewer.scene.requestRender();
            requestAnimationFrame(forceRender);
          }
        };
        requestAnimationFrame(forceRender);

        // Debug: call window.debugVol() in the browser console at any time
        window.debugVol = () => {
          console.log('=== VOL DEBUG ===');
          console.log('minBounds.z :', provider.minBounds.z, 'm  (sea floor depth, negative)');
          console.log('maxBounds.z :', provider.maxBounds.z, 'm  (sea surface)');
          console.log('actualMaxDepth:', actualMaxDepth, 'm');
          console.log('depthCount  :', depthCount);
          console.log('depthTest   :', viewer.scene.globe?.depthTestAgainstTerrain);
          console.log('vertExagg   :', viewer.scene.verticalExaggeration);
          console.log('SceneMode (3=3D):', viewer.scene.mode);
        };
        setTimeout(() => window.debugVol?.(), 400);

      } catch (err) { console.error('[VOL] Error:', err); }
    })();

    return () => {
      active = false;
      if (primitiveRef.current && viewer && !viewer.isDestroyed() && viewer.scene) {
        viewer.scene.primitives.remove(primitiveRef.current);
        primitiveRef.current = null;
      }
      // Restore globe to fully opaque when layer is turned off
      if (viewer && !viewer.isDestroyed() && viewer.scene?.globe) {
        viewer.scene.globe.translucency.enabled = false;
        viewer.scene.globe.depthTestAgainstTerrain = true;
        viewer.scene.requestRender();
      }
    };
  }, [viewer, variable, timeKey]);

  // Settings fast-path — updates visuals without re-downloading volume data
  useEffect(() => {
    if (!primitiveRef.current?.customShader) return;
    const v = opacity > 1.0 ? opacity / 100.0 : opacity;
    const d = Math.pow(oceanDensity / 100.0, 3) * 1.5;
    primitiveRef.current.customShader.setUniform('u_opacity', v);
    primitiveRef.current.customShader.setUniform('u_density', d);
    
    if (colormapSettings) {
      const colors = colormapSettings.colors || ['#000000', '#000000', '#000000', '#000000', '#000000'];
      const c1 = Cesium.Color.fromCssColorString(colors[0] || '#000000');
      const c2 = Cesium.Color.fromCssColorString(colors[1] || '#000000');
      const c3 = Cesium.Color.fromCssColorString(colors[2] || '#000000');
      const c4 = Cesium.Color.fromCssColorString(colors[3] || '#000000');
      const c5 = Cesium.Color.fromCssColorString(colors[4] || '#000000');
      
      const bMin = primitiveRef.current.backendVMin || 0;
      const bMax = primitiveRef.current.backendVMax || 30;
      const uMin = colormapSettings.uMin ?? bMin;
      const uMax = colormapSettings.uMax ?? bMax;
      const uClipMin = (colormapSettings.clipMin ?? 0) / 100.0;
      const uClipMax = (colormapSettings.clipMax ?? 100) / 100.0;
      
      primitiveRef.current.customShader.setUniform('u_color1', new Cesium.Cartesian3(c1.red, c1.green, c1.blue));
      primitiveRef.current.customShader.setUniform('u_color2', new Cesium.Cartesian3(c2.red, c2.green, c2.blue));
      primitiveRef.current.customShader.setUniform('u_color3', new Cesium.Cartesian3(c3.red, c3.green, c3.blue));
      primitiveRef.current.customShader.setUniform('u_color4', new Cesium.Cartesian3(c4.red, c4.green, c4.blue));
      primitiveRef.current.customShader.setUniform('u_color5', new Cesium.Cartesian3(c5.red, c5.green, c5.blue));
      primitiveRef.current.customShader.setUniform('u_userMin', uMin);
      primitiveRef.current.customShader.setUniform('u_userMax', uMax);
      primitiveRef.current.customShader.setUniform('u_clipMin', uClipMin);
      primitiveRef.current.customShader.setUniform('u_clipMax', uClipMax);
    }
    
    viewer?.scene.requestRender();
  }, [opacity, oceanDensity, colormapSettings, viewer, primitiveReady]);

  // Depth slice fast-path — clips the top of the volume dynamically
  useEffect(() => {
    if (!primitiveRef.current) return;
    
    // VoxelPrimitive uses maxClippingBounds to slice away data.
    // By keeping X and Y at Math.PI bounds, and setting Z to the negative depth,
    // we slice the volume horizontally at the specified depth.
    primitiveRef.current.maxClippingBounds = new Cesium.Cartesian3(
      Cesium.Math.PI,
      Cesium.Math.PI_OVER_TWO,
      oceanDepth
    );
    viewer?.scene.requestRender();
  }, [oceanDepth, viewer]);

  return null;
}

