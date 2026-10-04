// Force Vite HMR reload
import { useEffect, useRef, useState } from 'react'
import cycloneIcon from '../assets/cyclone.png'
import {
  Viewer,
  createWorldTerrainAsync,
  Color,
  Cartesian3,
  Math as CesiumMath,
  Rectangle,
  SingleTileImageryProvider,
  ImageryLayer,
  CesiumTerrainProvider,
  CameraEventType,
  KeyboardEventModifier,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  EasingFunction,
  EllipsoidTerrainProvider,
  CustomDataSource,
  HeightReference,
  NearFarScalar,
  VerticalOrigin,
  PolylineDashMaterialProperty,
  PolylineGlowMaterialProperty,
  ClassificationType,
} from 'cesium'
import { Navigation, Plus, Minus, X } from 'lucide-react'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { OceanTileProvider } from '../utils/OceanTileProvider'
import VolumetricOcean from './VolumetricOcean'
import CesiumWind from "cesium-wind"
import './GlobeView.css'
import { API_BASE_URL } from '../config';

// ─── Main Globe Component ─────────────────────────────────────────────────────
export default function GlobeView() {
  const containerRef = useRef(null)
  const viewerRef    = useRef(null)

  const [isCompassMenuOpen, setIsCompassMenuOpen] = useState(false)
  const compassMenuRef = useRef(null)
  const [volumeConfig, setVolumeConfig] = useState(null)
  const [viewerReady, setViewerReady] = useState(false)
  const pendingVolumeConfig = useRef(null) // queued if viewer not ready yet

  // ── GLOBAL API: exposed to Dashboard.jsx via window ─────────────────────────
  // Defined during render so it always exists — but stores config via state so
  // VolumetricOcean re-renders correctly once the async viewer is ready.
  if (typeof window !== 'undefined') {
    window.activeOceanLayer = null;
    window.setOceanVariable = async (varName, isActive, options = {}) => {
      console.log(`[VOL-API] setOceanVariable varName=${varName} isActive=${isActive}`);

      if (!isActive) {
        pendingVolumeConfig.current = null;
        setVolumeConfig(null);
        if (viewerRef.current) viewerRef.current.scene.requestRender();
        return;
      }

      const variableMap = {
        'Temperature': 'temperature', 'Sea Surface Temperature': 'temperature',
        'Salinity': 'salinity', 'Currents': 'currents', 'Chlorophyll': 'chlorophyll',
        'Oxygen': 'dissolved_oxygen', 'Nitrate': 'nitrate', 'Phosphate': 'phosphate', 'Silicate': 'silicate'
      };
      const variable = variableMap[varName] || 'temperature';

      let timeKey = new Date().toISOString().split('T')[0]; // Fallback to today
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/data/${variable}/daily/latest_key`);
        if (res.ok) {
          const data = await res.json();
          if (data.time_key) timeKey = data.time_key;
        }
      } catch (e) {
        console.error(`Failed to fetch latest time key for ${variable}`, e);
      }
      const savedDepthStr = localStorage.getItem('varuna_oceanDepth');
      const oceanDepth = savedDepthStr ? parseInt(JSON.parse(savedDepthStr)) : 0;
      const savedExaggStr = localStorage.getItem('varuna_vertExagg');
      const vertExagg = savedExaggStr ? parseInt(JSON.parse(savedExaggStr)) : 80;

      const config = { 
        variable, 
        timeKey, 
        opacity: options.opacity !== undefined ? options.opacity : 100, 
        oceanDepth: options.oceanDepth !== undefined ? options.oceanDepth : oceanDepth,
        oceanDensity: options.oceanDensity !== undefined ? options.oceanDensity : 25,
        colormapSettings: options.colormapSettings || null,
        vertExagg 
      };

      if (!viewerRef.current) {
        // Viewer still initialising — queue the config; a useEffect will apply it
        console.log('[VOL-API] Viewer not ready yet — queuing config:', config);
        pendingVolumeConfig.current = config;
        return;
      }

      pendingVolumeConfig.current = null;
      setVolumeConfig(config);
      viewerRef.current.scene.requestRender();
    };
    window.active2DLayers = window.active2DLayers || {};
    window.set2DLayer = async (varName, isActive, options = {}) => {
      if (!viewerRef.current) return;
      const viewer = viewerRef.current;
      
      const variableMap = {
        'Sea Surface Temperature': 'temperature',
        'Sea Surface Height': 'ssh',
        'Surface Currents': 'currents',
        'Temperature Anomaly': 'anomaly_temperature',
        'Ocean Plastics Anomaly': 'plastics'
      };
      const variable = variableMap[varName];
      if (!variable) return;

      if (window.active2DLayers[varName]) {
        if (!isActive) {
          const oldLyr = window.active2DLayers[varName];
          if (oldLyr.remove) {
             oldLyr.remove();
          } else {
             viewer.scene.imageryLayers.remove(oldLyr);
          }
          delete window.active2DLayers[varName];
          viewer.scene.requestRender();
          return;
        }
      }

      if (isActive) {
        let timeKey = new Date().toISOString().split('T')[0]; // Fallback to today
        let checkVar = variable === 'currents' ? 'u_current' : variable;
        
        // Append years to anomaly_temperature variable name
        if (variable === 'anomaly_temperature') {
          checkVar = `anomaly_temperature_${options.years || 5}`;
        }
        
        try {
          let fetchUrl = `${API_BASE_URL}/api/v1/data/${checkVar}/daily/latest_key`;
          const res = await fetch(fetchUrl);
          if (res.ok) {
            const data = await res.json();
            if (data.time_key) timeKey = data.time_key;
          }
        } catch (e) {
          console.error(`Failed to fetch latest time key for ${variable}`, e);
        }

        if (varName === 'Surface Currents' || varName === 'Ocean Plastics Anomaly') {
          let reqVar = 'currents';
          // we use the currents vector json for both
          try {
             fetch(`${API_BASE_URL}/api/v1/data/currents/daily/${timeKey}/vector_json`)
               .then(res => res.ok ? res.json() : null)
               .then(data => {
                  if (!data || data.error || !Array.isArray(data)) {
                    console.error("Vector data unavailable for this date");
                    return;
                  }
                  let windOptions = {};
                  if (varName === 'Surface Currents') {
                    windOptions = {
                      colorScale: [
                        "rgb(36,104, 180)", "rgb(60,157, 194)", "rgb(128,205,193 )",
                        "rgb(151,218,168 )", "rgb(198,231,181)", "rgb(238,247,217)",
                        "rgb(255,238,159)", "rgb(252,217,125)", "rgb(255,182,100)",
                        "rgb(252,150,75)", "rgb(250,112,52)", "rgb(245,64,32)",
                        "rgb(237,45,28)", "rgb(220,24,32)", "rgb(180,0,35)"
                      ],
                      frameRate: 16,
                      maxAge: 120,
                      globalAlpha: options.opacity !== undefined ? options.opacity : 0.9,
                      velocityScale: 1 / 15,
                      paths: 4000
                    };
                  } else {
                    // Ocean Plastics Anomaly Particle Drift
                    windOptions = {
                      colorScale: [
                        "rgba(255, 255, 255, 0.3)", 
                        "rgba(255, 255, 255, 0.6)", 
                        "rgba(236, 72, 153, 0.8)",
                        "rgba(219, 39, 119, 1.0)",
                        "rgba(157, 23, 77, 1.0)"
                      ],
                      frameRate: 20,
                      maxAge: 300, // Very long life to simulate accumulation
                      globalAlpha: options.opacity !== undefined ? options.opacity : 1.0,
                      velocityScale: 1 / 25, // Slow drift
                      paths: 18000, // Dense plastic count
                      lineWidth: 2.5
                    };
                  }
                  const windLayer = new CesiumWind(data, { windOptions });
                  windLayer.addTo(viewer);
                  
                  const oldLayer = window.active2DLayers[varName];
                  window.active2DLayers[varName] = windLayer;
                  if (oldLayer) {
                     if (oldLayer.remove) oldLayer.remove();
                     else viewer.scene.imageryLayers.remove(oldLayer);
                  }
               });
          } catch(e) {
             console.error('Failed to load currents layer', e);
          }
          return;
        }

        if (varName === 'Ocean Plastics Anomaly') return; // Handled above as particles

        let fetchVar = variable === 'anomaly_temperature' ? `anomaly_temperature_${options.years || 5}` : variable;
        let urlTemplate = `${API_BASE_URL}/api/v1/data/${fetchVar}/daily/${timeKey}/tile/{z}/{x}/{y}?depth=0`;

        try {
          const provider = new OceanTileProvider({
            url: urlTemplate,
            vmin: options.vmin !== null ? options.vmin : undefined,
            vmax: options.vmax !== null ? options.vmax : undefined,
            colormapSettings: options.colormapSettings,
            opacity: options.opacity !== undefined ? options.opacity : 1.0,
            maximumLevel: 4
          });
          
          const newLayer = new ImageryLayer(provider, {
            alpha: options.opacity !== undefined ? options.opacity : 1.0
          });
          
          // To prevent visual flashing, we add the new layer first, 
          // and then remove the old layer after a short delay (allowing new tiles to decode from browser cache)
          const oldLayer = window.active2DLayers[varName];
          window.active2DLayers[varName] = newLayer;
          viewer.scene.imageryLayers.add(newLayer);
          
          if (oldLayer) {
            setTimeout(() => {
              if (viewer.scene.imageryLayers.contains(oldLayer)) {
                viewer.scene.imageryLayers.remove(oldLayer);
                viewer.scene.requestRender();
              }
            }, 300); // 300ms is usually enough for cached tiles to pop in
          }
          
          viewer.scene.requestRender();
        } catch (e) {
          console.error('[POLARIS] Failed to load 2D layer:', e);
        }
      }
      viewer.scene.requestRender();

    };
  }

  useEffect(() => {
    function handleClickOutside(event) {
      if (compassMenuRef.current && !compassMenuRef.current.contains(event.target)) {
        setIsCompassMenuOpen(false)
      }
    }
    if (isCompassMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [isCompassMenuOpen])

  // Flush any config that was queued before the viewer finished initialising
  useEffect(() => {
    if (!viewerReady || !pendingVolumeConfig.current) return;
    console.log('[VOL-API] Viewer now ready — flushing pending config:', pendingVolumeConfig.current);
    setVolumeConfig(pendingVolumeConfig.current);
    pendingVolumeConfig.current = null;
  }, [viewerReady])

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return

    let destroyed = false
    const isActive = () => !destroyed && !viewerRef.current?.isDestroyed()

    ;(async () => {
      // 1. (No 35MB fetch needed anymore! GPU Shader handles it directly from terrain data)

      // 2. Load the perfect Quantized Mesh terrain from Cesium Ion!
      let terrainProvider
      try {
        terrainProvider = await CesiumTerrainProvider.fromIonAssetId(5936056)
        window.bathyTerrainProvider = terrainProvider;
      } catch (err) {
        console.warn('[POLARIS] Failed to load Cesium Ion terrain:', err.message)
      }
      if (!isActive()) return

      // 3. Viewer
      const viewer = new Viewer(containerRef.current, {
        terrainProvider,
        baseLayerPicker:         false,
        baseLayer:               false,
        imageryProvider:         false,
        geocoder:                false,
        homeButton:              false,
        sceneModePicker:         false,
        navigationHelpButton:    false,
        animation:               false,
        timeline:                false,
        fullscreenButton:        false,
        infoBox:                 false,
        selectionIndicator:      false,
        requestRenderMode:       true,
        maximumRenderTimeChange: Infinity,
        msaaSamples:             4,
        creditContainer:         document.createElement('div'),
        // Removed skyBox: false so Cesium loads its default starry cosmic background
        skyAtmosphere:           false,
      })

      // Prevent double-clicking from changing the camera's reference frame (locking onto entities)
      viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

      viewerRef.current = viewer
      setViewerReady(true) // triggers re-render + pending config flush
      window.cesiumViewer = viewer // Expose globally for the Dashboard UI
      const { scene, camera } = viewer
      const globe = scene.globe

      // 1. VERTICAL EXAGGERATION
      scene.verticalExaggeration = 80.0
      scene.verticalExaggerationRelativeHeight = 0.0

      // 2. GLOBE APPEARANCE
      globe.enableLighting           = false
      globe.showGroundAtmosphere     = false // Prevents the globe from looking hazy when zoomed out
      globe.atmosphereLightIntensity = 8.0
      globe.baseColor                = Color.fromCssColorString('#020d1a')
      globe.undergroundColor         = Color.fromCssColorString('#011428')
      globe.depthTestAgainstTerrain  = true  // Required for vertical exaggeration to work correctly
      
      // Disable MSAA for massive FPS boost; we rely on FXAA post-processing instead.
      scene.msaaSamples = 1

      // 3. LEVEL OF DETAIL & CACHING
      // Expand cache limit to hold thousands of tiles so it remembers them once loaded.
      globe.tileCacheSize = 25000

      // --- PROGRESSIVE OVERDRIVE ---
      // Start with lightweight limits so the globe snaps onto the screen instantly.
      globe.maximumScreenSpaceError  = 2.0
      globe.preloadSiblings = false
      globe.loadingDescendantLimit = 20
      
      // After 5 seconds, unleash the GPU and crank all settings to maximum!
      // After 5 seconds, unleash the GPU and crank all settings to maximum (if user hasn't overridden)!
      setTimeout(() => {
        if (!isActive() || window.varunaHasCustomLOD) return
        globe.maximumScreenSpaceError = 0.45
        globe.preloadSiblings = true
        globe.loadingDescendantLimit = 200
      }, 4000)
      
      scene.backgroundColor = Color.BLACK
      scene.fog.enabled     = false
      
      // Reverting HDR and Bloom - they were mathematically crushing the faint stars to black!
      scene.highDynamicRange = false
      scene.postProcessStages.fxaa.enabled = true

      // Camera (Initial View: 2D Top-down over India)
      camera.setView({
        destination: Cartesian3.fromDegrees(78.9629, 20.5937, 10000000),
        orientation: {
          heading: 0,
          pitch:   CesiumMath.toRadians(-90),
          roll:    0,
        },
      })
      
      window.is3DView = false;
      
      window.setVisualQuality = (val) => {
        if (!viewerRef.current) return;
        window.varunaHasCustomLOD = true;
        
        // Exponential scale: 1 -> 5.0 (Fast), 10 -> 0.05 (Extreme Quality)
        // 5.0 * 10^(-(val - 1) / 4.5)
        const error = 5.0 * Math.pow(10, -(val - 1) / 4.5);
        viewerRef.current.scene.globe.maximumScreenSpaceError = error;
        
        // Also boost descendant limits at high quality to allow massive tile loading
        viewerRef.current.scene.globe.loadingDescendantLimit = val * 100;
        
        viewerRef.current.scene.requestRender();
      };

      window.setTileCacheLimit = (val) => {
        if (!viewerRef.current) return;
        // Direct value from 1000 to 15000
        viewerRef.current.scene.globe.tileCacheSize = val;
      };

      window.varunaSunlightEnabled = false;
      window.varunaAtmosphereGlow = 10;
      window.varunaSunlightEnabled = false;
      window.varunaAtmosphereGlow = 10;

      window.updateAtmosphereAndSunlight = async () => {
        if (!viewerRef.current) return;
        const { ClockStep, JulianDate, SkyAtmosphere } = await import('cesium');
        
        // IMPORTANT: Read state AFTER the await to avoid race conditions during rapid state changes (like Reset Settings)
        if (!viewerRef.current) return;
        const scene = viewerRef.current.scene;
        const globe = scene.globe;
        const enableSun = window.varunaSunlightEnabled;
        const glow = window.varunaAtmosphereGlow;

        // 1. Lighting & Shadows
        globe.enableLighting = enableSun;
        viewerRef.current.shadows = enableSun;
        
        if (enableSun) {
          viewerRef.current.clock.clockStep = ClockStep.SYSTEM_CLOCK;
          viewerRef.current.clock.currentTime = JulianDate.now();
          viewerRef.current.clock.shouldAnimate = true;
          viewerRef.current.clock.multiplier = 1.0;
        } else {
          viewerRef.current.clock.shouldAnimate = false;
        }
        
        // 2. Atmosphere
        if (enableSun && glow > 0) {
          if (!scene.skyAtmosphere) {
            scene.skyAtmosphere = new SkyAtmosphere();
          }
          scene.skyAtmosphere.show = true;
          globe.showGroundAtmosphere = true;
          globe.atmosphereLightIntensity = glow * 0.16;
        } else {
          if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
          globe.showGroundAtmosphere = false;
        }
        
        scene.requestRender();
      };

      window.setAtmosphereGlow = (val) => {
        window.varunaAtmosphereGlow = val;
        window.updateAtmosphereAndSunlight();
      };

      window.clearCesiumCache = (activeMap) => {
        if (!viewerRef.current) return;
        const globe = viewerRef.current.scene.globe;
        
        // 1. Flush the WebGL tile geometry cache
        const currentSize = globe.tileCacheSize;
        globe.tileCacheSize = 0; 
        
        // 2. Brutally destroy and recreate the imagery layer to flush the texture cache
        if (window.currentBaseLayer) {
            viewerRef.current.imageryLayers.remove(window.currentBaseLayer);
            window.currentBaseLayer = null;
        }
        
        if (window.changeMapLayer && activeMap) {
            window.changeMapLayer(activeMap);
        }

        viewerRef.current.scene.requestRender();
        
        setTimeout(() => {
          if (viewerRef.current && !viewerRef.current.isDestroyed()) {
             globe.tileCacheSize = currentSize;
          }
        }, 500);
      };
      window.toggle2D3D = async () => {
        if (!viewerRef.current) return;
        const { Cartesian2, Cartesian3, Cartographic, BoundingSphere, HeadingPitchRange, Math: CesiumMath } = await import('cesium');
        const cam = viewerRef.current.camera;
        const scene = viewerRef.current.scene;
        
        // Raycast to find the exact coordinate the user is looking at in the center of the screen
        const canvas = scene.canvas;
        const center = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
        let lookAtTarget = cam.pickEllipsoid(center, scene.globe.ellipsoid);
        
        // CRITICAL FALLBACK: If the raycast misses the earth (zoomed out or looking at horizon),
        // we use the point on the ground directly beneath the camera as our orbital pivot point!
        if (!lookAtTarget) {
          const groundCarto = cam.positionCartographic.clone();
          groundCarto.height = 0;
          lookAtTarget = Cartographic.toCartesian(groundCarto);
        }
        
        const distance = Cartesian3.distance(cam.position, lookAtTarget);
        
        if (window.is3DView) {
          // Switch to flat 2D (Top-down)
          cam.flyToBoundingSphere(new BoundingSphere(lookAtTarget, 0), {
            offset: new HeadingPitchRange(cam.heading, CesiumMath.toRadians(-90), distance),
            duration: 1.5
          });
          window.is3DView = false;
        } else {
          // Switch to immersive 3D (Tilted)
          // Orbit around the target point, keeping it perfectly centered in the screen
          cam.flyToBoundingSphere(new BoundingSphere(lookAtTarget, 0), {
            offset: new HeadingPitchRange(cam.heading, CesiumMath.toRadians(-25), distance),
            duration: 1.5
          });
          window.is3DView = true;
        }
      }

      camera.moveEnd.addEventListener(() => {
        updateHUD()
      })

      // 🛠 High-Performance HUD Updater (Vanilla DOM manipulation avoids slow React re-renders)
      const updateHUD = () => {
        if (!viewerRef.current) return
        const cam = viewerRef.current.camera
        
        const compassIcon = document.getElementById('hud-compass-icon')
        if (compassIcon) {
          // If camera looks East (90deg), North is to the left (-90deg relative to screen)
          const headingDeg = CesiumMath.toDegrees(cam.heading)
          compassIcon.style.transform = `rotate(${-headingDeg}deg)`
        }

        const tiltSlider = document.getElementById('compass-tilt-slider')
        const tiltVal = document.getElementById('compass-tilt-val')
        if (tiltSlider && document.activeElement !== tiltSlider) {
          const p = CesiumMath.toDegrees(cam.pitch)
          const alt = cam.positionCartographic.height
          const R = viewerRef.current.scene.globe.ellipsoid.maximumRadius
          // Mathematically calculate the dip angle of the Earth's physical horizon from this altitude
          const horizonPitch = alt > 0 ? CesiumMath.toDegrees(-Math.acos(R / (R + alt))) : 0
          
          // Map Cesium's internal pitch [-90, horizonPitch] to our UI's perfect [0, 90] scale
          let uiTilt = ((p + 90) / (horizonPitch + 90)) * 90
          uiTilt = Math.max(0, Math.min(90, uiTilt))
          
          tiltSlider.value = uiTilt
          tiltSlider.style.setProperty('--val', `${((uiTilt - tiltSlider.min) / (tiltSlider.max - tiltSlider.min)) * 100}%`)
          if (tiltVal) tiltVal.textContent = Math.round(uiTilt) + '°'
        }
        
        const headingSlider = document.getElementById('compass-heading-slider')
        const headingVal = document.getElementById('compass-heading-val')
        if (headingSlider && document.activeElement !== headingSlider) {
          let hdg = CesiumMath.toDegrees(cam.heading)
          if (hdg > 180) hdg -= 360 // Convert 0-360 into -180 to 180
          headingSlider.value = hdg
          headingSlider.style.setProperty('--val', `${((hdg + 180) / 360) * 100}%`)
          if (headingVal) headingVal.textContent = Math.round(hdg) + '°'
        }

        const altText = document.getElementById('hud-alt')
        if (altText) {
          const alt = cam.positionCartographic.height
          if (alt >= 1000) {
            altText.textContent = `${(alt / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`
          } else {
            altText.textContent = `${alt.toLocaleString(undefined, { maximumFractionDigits: 0 })} m`
          }
        }
        
        const scaleBox = document.getElementById('hud-scale-box')
        const scaleText = document.getElementById('hud-scale-val')
        if (scaleBox && scaleText) {
          const frustum = cam.frustum
          const alt = cam.positionCartographic.height
          const canvasWidth = viewerRef.current.scene.canvas.clientWidth || 1000
          
          let distanceForPixels;
          // In 2D mode, the frustum is Orthographic and has no fov! We use the frustum width instead.
          if (scene.mode === 2 || !frustum.fov) {
            distanceForPixels = (frustum.right - frustum.left) * (125 / canvasWidth)
          } else {
            distanceForPixels = (2 * alt * Math.tan(frustum.fov / 2)) * (125 / canvasWidth)
          }
          
          // Find a clean, rounded metric scale (10, 50, 100, etc.)
          const magnitude = Math.pow(10, Math.floor(Math.log10(distanceForPixels)))
          const firstDigit = distanceForPixels / magnitude
          let niceMultiplier = firstDigit < 2 ? 1 : (firstDigit < 5 ? 2 : 5)
          const niceDistance = niceMultiplier * Math.max(1, magnitude)
          
          // Calculate exact pixel width needed to represent the clean scale
          const actualPixelWidth = (niceDistance / distanceForPixels) * 125
          
          scaleBox.style.width = `${Math.max(10, actualPixelWidth)}px`
          scaleText.textContent = niceDistance >= 1000 ? `${(niceDistance / 1000).toLocaleString()} km` : `${niceDistance.toLocaleString()} m`
        }
      }
      
      // Wire directly into the raw physics clock for 100% real-time synchronization during aggressive mouse drag
      viewerRef.current.clock.onTick.addEventListener(updateHUD)
      
      // HUD Cursor Coordinate Tracker
      const handler = new ScreenSpaceEventHandler(scene.canvas)
      handler.setInputAction((movement) => {
        const coordsText = document.getElementById('hud-coords')
        if (!coordsText || !viewerRef.current) return
        
        const cartesian = viewerRef.current.camera.pickEllipsoid(movement.endPosition, scene.globe.ellipsoid)
        if (cartesian) {
          const cartographic = scene.globe.ellipsoid.cartesianToCartographic(cartesian)
          const latDeg = CesiumMath.toDegrees(cartographic.latitude)
          const lonDeg = CesiumMath.toDegrees(cartographic.longitude)
          
          // Convert to scientific DMS format with strict padding to guarantee fixed string length
          const toDMS = (deg, isLat) => {
            const abs = Math.abs(deg)
            const d = Math.floor(abs)
            const minFloat = (abs - d) * 60
            const m = Math.floor(minFloat)
            const s = ((minFloat - m) * 60).toFixed(2)
            const dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W')
            
          // Pad degrees: Lat gets 2 digits, Lon gets 3 digits. We use '0' to keep width identical.
            const padDeg = isLat ? 2 : 3
            return `${d.toString().padStart(padDeg, '0')}°${m.toString().padStart(2, '0')}'${s.padStart(5, '0')}"${dir}`
          }
          
          coordsText.textContent = `${toDMS(latDeg, true)} ${toDMS(lonDeg, false)}`

          if (window.varunaActiveTool === 'mark') {
            window.dispatchEvent(new CustomEvent('varuna-mark-hover', { 
              detail: { lat: latDeg, lon: lonDeg, x: movement.endPosition.x, y: movement.endPosition.y } 
            }));
          }
        } else {
          coordsText.textContent = `Deep Space`
          if (window.varunaActiveTool === 'mark') {
            window.dispatchEvent(new CustomEvent('varuna-mark-hover', { detail: null }));
          }
        }
      }, ScreenSpaceEventType.MOUSE_MOVE)

      // FIX FOR CESIUM-WIND SYNCHRONIZATION DURING ZOOM/PAN
      camera.moveStart.addEventListener(() => {
        const windLayer = window.active2DLayers && window.active2DLayers['Surface Currents'];
        if (windLayer && windLayer.wind) {
          windLayer.wind.stop();
          if (windLayer.wind.clearCanvas) windLayer.wind.clearCanvas();
        }
      });
      
      camera.moveEnd.addEventListener(() => {
        const windLayer = window.active2DLayers && window.active2DLayers['Surface Currents'];
        if (windLayer && windLayer.wind) {
          windLayer.wind.start();
        }
      });

      // Interaction tuning
      scene.screenSpaceCameraController.inertiaSpin      = 0.94
      scene.screenSpaceCameraController.inertiaTranslate = 0.94
      scene.screenSpaceCameraController.inertiaZoom      = 0.85
      
      // FIX TRACKPAD PINCHING: 
      // Cesium often misinterprets trackpad pinches as "tilt" gestures instead of zoom.
      // By strictly removing PINCH from tilt mapping, it restores trackpad zoom!
      scene.screenSpaceCameraController.zoomEventTypes = [
        CameraEventType.WHEEL, 
        CameraEventType.PINCH,
        // Trackpad pinches on laptops are sent by browsers as Ctrl + Wheel!
        { eventType: CameraEventType.WHEEL, modifier: KeyboardEventModifier.CTRL }
      ]
      scene.screenSpaceCameraController.tiltEventTypes = [
        CameraEventType.RIGHT_DRAG, 
        CameraEventType.MIDDLE_DRAG
      ]

      // ── TOOLBAR INTERACTION MODES ────────────────────────────
      window.varunaActiveTool = 'select';

      // Store Cesium's default event type arrays so we can restore them
      const defaultRotate   = [CameraEventType.LEFT_DRAG];
      const defaultTranslate = [CameraEventType.RIGHT_DRAG];
      const defaultTilt     = [CameraEventType.RIGHT_DRAG, CameraEventType.MIDDLE_DRAG];
      const defaultLook     = null; // disabled by default

      window.addEventListener('varuna-tool-changed', (e) => {
        const tool = e.detail;
        window.varunaActiveTool = tool;
        if (!viewerRef.current) return;
        const scc = viewerRef.current.scene.screenSpaceCameraController;
        
        if (tool === 'pan') {
          // LEFT_DRAG pans; disable rotate and tilt entirely so nothing fights the pan
          scc.rotateEventTypes   = null;
          scc.tiltEventTypes     = null;
          scc.translateEventTypes = CameraEventType.LEFT_DRAG;
          scc.lookEventTypes     = null;
          viewerRef.current.canvas.style.cursor = 'grab';
        } else if (tool === 'rotate') {
          // LEFT_DRAG rotates; disable translate so globe spins in place
          scc.rotateEventTypes   = [CameraEventType.LEFT_DRAG];
          scc.tiltEventTypes     = [CameraEventType.RIGHT_DRAG, CameraEventType.MIDDLE_DRAG];
          scc.translateEventTypes = null;
          scc.lookEventTypes     = null;
          viewerRef.current.canvas.style.cursor = 'all-scroll';
        } else {
          // Default (select / mark / box) – restore Cesium defaults
          scc.rotateEventTypes   = defaultRotate;
          scc.translateEventTypes = defaultTranslate;
          scc.tiltEventTypes     = defaultTilt;
          scc.lookEventTypes     = defaultLook;
          viewerRef.current.canvas.style.cursor = (tool === 'mark' || tool === 'box') ? 'crosshair' : 'default';
        }
      });

      // --- SMART ZOOM HARDWARE DETECTION ---
      // Dynamically swaps the zoom speed depending on whether you used a mouse or a trackpad.
      // Browsers flag trackpad pinches with `ctrlKey=true` on wheel events!
      scene.screenSpaceCameraController.zoomFactor = 4.0 // Default for mouse
      
      const handleWheel = (e) => {
        if (e.ctrlKey) {
          // It's a trackpad pinch! Inject massive 32x multiplier.
          scene.screenSpaceCameraController.zoomFactor = 32.0
        } else {
          // It's a physical mouse wheel! Keep it smooth at 4x.
          scene.screenSpaceCameraController.zoomFactor = 3.0
        }
      }
      viewer.canvas.addEventListener('wheel', handleWheel, { passive: true })

      // 4. STATIC BATHYMETRY OVERLAY (Loaded FIRST for maximum priority)
      // Loads a tiny 2MB pre-rendered WebP image. 
      // By loading this before the satellite map, it gets absolute priority in the network queue!
      try {
        const meta = await fetch('/bathymetry_meta.json').then(r => r.json())
        const bathyProvider = await SingleTileImageryProvider.fromUrl('/bathymetry.webp', {
          rectangle: Rectangle.fromDegrees(
            meta.lon_min, meta.lat_min, meta.lon_max, meta.lat_max
          ),
        })
        if (!isActive()) return
        
        const layer = viewer.imageryLayers.addImageryProvider(bathyProvider)
        layer.alpha = 1.0
        layer.show = false // Hide by default until Dashboard.jsx syncs the user's settings!
        window.bathyLayer = layer;
      } catch (e) {
        console.error('[POLARIS] Failed to load static bathymetry WebP:', e)
      }

      // Expose API for UI
      // ── OCEAN VARIABLES ──────────────────────────────────────────────
      // (API is now hoisted to the top of the component for guaranteed availability)
      // ─────────────────────────────────────────────────────────────────

      window.updateOceanOpacity = (opacityVal) => {
        setVolumeConfig(prev => prev ? { ...prev, opacity: opacityVal } : null);
        if (viewerRef.current) viewerRef.current.scene.requestRender();
      }
      
      window.updateOceanDepth = (depthVal) => {
        setVolumeConfig(prev => prev ? { ...prev, oceanDepth: depthVal } : null);
        if (viewerRef.current) viewerRef.current.scene.requestRender();
      }

      window.updateOceanDensity = (densityVal) => {
        setVolumeConfig(prev => prev ? { ...prev, oceanDensity: densityVal } : null);
        if (viewerRef.current) viewerRef.current.scene.requestRender();
      }

      window.updateOceanColormap = (settings) => {
        setVolumeConfig(prev => prev ? { ...prev, colormapSettings: settings } : null);
        if (viewerRef.current) viewerRef.current.scene.requestRender();
      }

      window.setBathyEnabled = (isEnabled, currentExagg = 80.0) => {
        if (window.bathyLayer && viewerRef.current) {
          window.bathyLayer.show = isEnabled;
          
          if (window.bathyTerrainProvider) {
            viewerRef.current.terrainProvider = isEnabled ? window.bathyTerrainProvider : new EllipsoidTerrainProvider();
          }
          
          // Restore user's exaggeration when enabled (since we no longer use it as a hack to flatten)
          viewerRef.current.scene.verticalExaggeration = isEnabled ? currentExagg : 1.0;
          
          // Request a single render frame to kickoff the QuadTree update
          viewerRef.current.scene.requestRender();
        }
      }

      window.setBathyOpacity = (opacityVal) => {
        if (window.bathyLayer && viewerRef.current) {
          window.bathyLayer.brightness = opacityVal / 100;
          window.bathyLayer.alpha = 1.0;
          viewerRef.current.scene.requestRender();
        }
      }
      
      window.setGlobeExaggeration = (exaggVal) => {
        if (viewerRef.current) {
          viewerRef.current.scene.verticalExaggeration = exaggVal;
          // Sync with volume config so the raymarcher updates instantly
          setVolumeConfig(prev => prev ? { ...prev, vertExagg: exaggVal } : null);
          viewerRef.current.scene.requestRender();
        }
      }

      // 5. BASE MAP (Loaded SECOND to yield bandwidth to the ocean)
      // Native Cesium Ion Satellite Map (AERIAL only, no messy labels or roads).
      const { createWorldImageryAsync, IonWorldImageryStyle } = await import('cesium')
      
      const satelliteMap = await createWorldImageryAsync({
        style: IonWorldImageryStyle.AERIAL
      })
      
      if (!isActive()) return
      
      // Inject the satellite map at z-index 0 so it stays UNDER the bathymetry layer!
      window.currentBaseLayer = viewer.imageryLayers.addImageryProvider(satelliteMap, 0)
      
      // --- SATELLITE VISUAL SETTINGS ---
      window.currentBaseLayer.alpha = 1.0
      window.currentBaseLayer.brightness = 1.0
      window.currentBaseLayer.contrast = 1.0
      window.currentBaseLayer.saturation = 1.0
      window.currentBaseLayer.gamma = 1.0
      window.currentBaseLayer.hue = 0.0

      // Map swapper API for the Dashboard
      window.changeMapLayer = async (mapName) => {
        if (!viewerRef.current) return
        
        const { 
          createWorldImageryAsync, 
          IonWorldImageryStyle, 
          IonImageryProvider,
          OpenStreetMapImageryProvider
        } = await import('cesium')

        // Remove existing base imagery layer
        if (window.currentBaseLayer) {
          viewerRef.current.imageryLayers.remove(window.currentBaseLayer)
        }
        
        let newProvider;
        if (mapName === 'Bing Aerial with Labels') {
          newProvider = await createWorldImageryAsync({ style: IonWorldImageryStyle.AERIAL_WITH_LABELS })
        } else if (mapName === 'Roads') {
          newProvider = await createWorldImageryAsync({ style: IonWorldImageryStyle.ROAD })
        } else if (mapName === 'OpenStreetMap') {
          newProvider = new OpenStreetMapImageryProvider({ url : 'https://a.tile.openstreetmap.org/' })
        } else if (mapName === 'Natural Earth II') {
          // Asset ID 2 is a universally accessible, beautiful low-res terrain map
          newProvider = await IonImageryProvider.fromAssetId(2)
        } else {
          // Default fallback (Bing Aerial)
          newProvider = await createWorldImageryAsync({ style: IonWorldImageryStyle.AERIAL })
        }
        
        window.currentBaseLayer = viewerRef.current.imageryLayers.addImageryProvider(newProvider, 0)
        window.currentBaseLayer.alpha = 1.0
      }
      
      // Star/Skybox swapper API
      window.toggleStars = (showStars) => {
        if (!viewerRef.current) return
        if (viewerRef.current.scene.skyBox) {
          viewerRef.current.scene.skyBox.show = showStars
        }
      }
      
      // Sunlight & Shadows API
      window.toggleSunlight = (enable) => {
        window.varunaSunlightEnabled = enable;
        if (window.updateAtmosphereAndSunlight) {
           window.updateAtmosphereAndSunlight();
        }
      }
      
      // Auto-Rotate API
      let rotationListener = null
      window.toggleAutoRotate = (enable) => {
        if (!viewerRef.current) return
        
        const clock = viewerRef.current.clock
        const camera = viewerRef.current.scene.camera
        
        if (enable) {
          if (!rotationListener) {
            rotationListener = () => {
              // Spin the globe slowly (only noticeable if in 3D)
              camera.rotate(Cartesian3.UNIT_Z, -0.0008)
            }
            clock.onTick.addEventListener(rotationListener)
          }
        } else {
          if (rotationListener) {
            clock.onTick.removeEventListener(rotationListener)
            rotationListener = null
          }
        }
      }
    })()

    return () => {
      destroyed = true
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy()
      }
      viewerRef.current = null
    }
  }, [])
  
  // ── FETCH AND MANAGE INSTRUMENTS ──────────────────────────────────────────
  useEffect(() => {
    if (!viewerReady) return;
    const viewer = viewerRef.current;
    
    const instrumentsDataSource = new CustomDataSource('instruments');
    viewer.dataSources.add(instrumentsDataSource);
    
    let allInstruments = [];
    
    const fetchInstruments = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/instruments`);
        const data = await res.json();
        allInstruments = data.data;
        updateVisibility();
      } catch (err) {
        console.error("Failed to fetch instruments", err);
      }
    };
    
    const updateVisibility = () => {
      instrumentsDataSource.entities.removeAll();
      const stored = localStorage.getItem('varuna_instruments');
      const toggles = stored ? JSON.parse(stored) : {};
      
      const typeMap = {
        'Argo float': 'Argo float',
        'Thermosalinometer': 'Thermosalinometer',
        'Mooring': 'Mooring',
        'Glider': 'Glider',
        'CTD': 'CTD',
        'Drifter - SVP': 'SVP',
        'Drifter - SVPB': 'SVPB',
        'Drifter - SVPBV': 'SVPBV'
      };
      
      const activeTypes = Object.entries(toggles)
        .filter(([k, v]) => v)
        .map(([k, v]) => typeMap[k]);
        
      if (activeTypes.length === 0) return;
      
      const createIcon = (colorHex, type) => {
        let svg = '';
        if (type === 'Argo float' || type === 'Glider') {
          // A cylinder/glider-like icon
          svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="31" viewBox="0 0 24 31">
                   <rect x="6" y="10" width="12" height="20" rx="6" fill="${colorHex}" stroke="black" stroke-width="2"/>
                   <rect x="10" y="2" width="4" height="8" fill="gray" stroke="black" stroke-width="1"/>
                 </svg>`;
        } else if (type === 'Mooring') {
          // A buoy-like icon
          svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="26" viewBox="0 0 30 26">
                   <path d="M5,15 L25,15 L15,25 Z" fill="${colorHex}" stroke="black" stroke-width="2"/>
                   <circle cx="15" cy="10" r="5" fill="white" stroke="black" stroke-width="2"/>
                 </svg>`;
        } else {
          // Generic sensor teardrop
          svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="33" viewBox="0 0 24 33">
                   <path d="M12 2 C6.48 2 2 6.48 2 12 C2 19.5 12 32 12 32 C12 32 22 19.5 22 12 C22 6.48 17.52 2 12 2 Z" fill="${colorHex}" stroke="black" stroke-width="2"/>
                   <circle cx="12" cy="12" r="4" fill="white"/>
                 </svg>`;
        }
        return 'data:image/svg+xml;base64,' + btoa(svg);
      };

      allInstruments.forEach(inst => {
        if (activeTypes.includes(inst.instrument_type)) {
          const colorMap = {
            'Argo float': '#00FFFF',      // Aqua
            'Thermosalinometer': '#FFA500',// Orange
            'Mooring': '#32CD32',         // Lime
            'Glider': '#FF00FF',          // Magenta
            'CTD': '#FFFF00',             // Yellow
            'SVP': '#FF0000',             // Red
            'SVPB': '#FF0000',            
            'SVPBV': '#FF0000',           
          };
          const colorHex = colorMap[inst.instrument_type] || '#FFFFFF';
          const iconUrl = createIcon(colorHex, inst.instrument_type);
          
          instrumentsDataSource.entities.add({
            id: 'inst_' + inst.instrument_id,
            position: Cartesian3.fromDegrees(inst.lon, inst.lat, 2000), // 2km altitude to clear exaggerated terrain
            billboard: {
              image: iconUrl,
              heightReference: HeightReference.RELATIVE_TO_GROUND,
              sizeInMeters: true,
              width: 30000,   // 30km physical width
              height: 45000,  // 45km physical height
              verticalOrigin: VerticalOrigin.BOTTOM,
            },
            properties: {
              isInstrument: true,
              ...inst
            }
          });
        }
      });
      viewer.scene.requestRender();
    };
    
    fetchInstruments();
    
    const handleStorageEvent = (e) => {
      if (e.detail && e.detail.key === 'varuna_instruments') {
        updateVisibility();
      }
    };
    window.addEventListener('varuna-storage', handleStorageEvent);
    
    // Add Path Data Source
    const pathDataSource = new CustomDataSource('instrumentPath');
    viewer.dataSources.add(pathDataSource);

    // Add Click Handler for Instruments
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click) => {
      // Check if 'mark' tool is active
      if (window.varunaActiveTool === 'mark') {
        const cartesian = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
        if (cartesian) {
          const carto = viewer.scene.globe.ellipsoid.cartesianToCartographic(cartesian);
          const lat = CesiumMath.toDegrees(carto.latitude);
          const lon = CesiumMath.toDegrees(carto.longitude);
          window.dispatchEvent(new CustomEvent('varuna-mark-click', { detail: { lat, lon, position: click.position, worldPos: cartesian } }));
        }
        return;
      }

      const pickedObject = viewer.scene.pick(click.position);
      if (CesiumMath && pickedObject && pickedObject.id && pickedObject.id.properties?.isInstrument) {
        const inst = pickedObject.id.properties;
        const instId = inst.instrument_id.getValue();
        console.log("Clicked instrument:", instId);
        
        // Dispatch event for UI Modal to listen to
        window.dispatchEvent(new CustomEvent('varuna-instrument-select', { detail: instId }));

        // Dim other instruments
        instrumentsDataSource.entities.values.forEach(e => {
          if (e.id === 'inst_' + instId) {
            e.billboard.color = Color.WHITE;
          } else {
            e.billboard.color = Color.WHITE.withAlpha(0.2);
          }
        });
        viewer.scene.requestRender();

        // Clear previous path
        pathDataSource.entities.removeAll();

        fetch(`${API_BASE_URL}/api/v1/instruments/${instId}/profile`)
          .then(res => res.json())
          .then(data => {
            // Dispatch event for UI Modal to listen to, passing the rich data
            window.dispatchEvent(new CustomEvent('varuna-instrument-select', { detail: data }));
            
            if (!data.profiles || data.profiles.length === 0) return;
            
            const uniqueCoords = [];
            const seen = new Set();
            const reversedProfiles = [...data.profiles].reverse();
            
            reversedProfiles.forEach(p => {
              const key = `${p.lat},${p.lon}`;
              if (!seen.has(key)) {
                seen.add(key);
                uniqueCoords.push({ lat: parseFloat(p.lat), lon: parseFloat(p.lon) });
              }
            });

            const currentLat = typeof inst.lat === 'object' && inst.lat.getValue ? inst.lat.getValue() : inst.lat;
            const currentLon = typeof inst.lon === 'object' && inst.lon.getValue ? inst.lon.getValue() : inst.lon;
            
            const lastCoord = uniqueCoords[uniqueCoords.length - 1];
            if (!lastCoord || lastCoord.lat !== currentLat || lastCoord.lon !== currentLon) {
              uniqueCoords.push({ lat: currentLat, lon: currentLon });
            }

            if (uniqueCoords.length > 1) {
              pathDataSource.entities.add({
                polyline: {
                  positions: uniqueCoords.map(p => Cartesian3.fromDegrees(p.lon, p.lat, 2000)),
                  width: 1,
                  material: Color.LIGHTGRAY.withAlpha(0.6)
                }
              });

              uniqueCoords.slice(0, -1).forEach(p => {
                pathDataSource.entities.add({
                  position: Cartesian3.fromDegrees(p.lon, p.lat, 2000),
                  point: {
                    pixelSize: 6,
                    color: Color.DARKGRAY,
                    scaleByDistance: new NearFarScalar(1.0e4, 1.0, 1.0e7, 0.0),
                    heightReference: HeightReference.RELATIVE_TO_GROUND
                  }
                });
              });
            }
            viewer.scene.requestRender();
          })
          .catch(err => console.error("Failed to fetch profile for path", err));
          
      } else if (CesiumMath && pickedObject && pickedObject.id && pickedObject.id.properties?.isDisaster) {
        const dist = pickedObject.id.properties;
        const type = dist.disasterType?.getValue();
        
        if (type === 'Cyclone Tracking') {
           const sid = dist.cyclone_id?.getValue();
           fetch(`${API_BASE_URL}/api/v1/hazards/cyclone/${sid}`)
             .then(res => res.json())
             .then(data => {
                window.dispatchEvent(new CustomEvent('varuna-disaster-select', { detail: { ...data, hazardType: 'Cyclone Tracking' } }));
             })
             .catch(err => console.error("Failed to fetch cyclone details", err));
        } else {
           window.dispatchEvent(new CustomEvent('varuna-disaster-select', { 
             detail: { 
               hazardType: type,
               event_id: dist.event_id?.getValue(),
               name: dist.name?.getValue(),
               severity: dist.severity?.getValue(),
               start_time: dist.start_time?.getValue(),
               end_time: dist.end_time?.getValue(),
               source: dist.source?.getValue(),
               lat: dist.lat?.getValue(),
               lon: dist.lon?.getValue()
             }
           }));
        }
      } else {
        // Clicked off an instrument or disaster, reset
        window.dispatchEvent(new CustomEvent('varuna-instrument-deselect'));
        window.dispatchEvent(new CustomEvent('varuna-disaster-deselect'));
        pathDataSource.entities.removeAll();
        instrumentsDataSource.entities.values.forEach(e => {
          e.billboard.color = Color.WHITE;
        });
        viewer.scene.requestRender();
      }
    }, ScreenSpaceEventType.LEFT_CLICK);
    
    return () => {
      window.removeEventListener('varuna-storage', handleStorageEvent);
      if (viewer && !viewer.isDestroyed()) {
        viewer.dataSources.remove(instrumentsDataSource);
        viewer.dataSources.remove(pathDataSource);
      }
      if (!handler.isDestroyed()) {
        handler.destroy();
      }
    };
  }, [viewerReady]);

  // ── FETCH AND MANAGE DISASTERS ──────────────────────────────────────────
  useEffect(() => {
    if (!viewerReady) return;
    const viewer = viewerRef.current;
    
    const disastersDataSource = new CustomDataSource('disasters');
    viewer.dataSources.add(disastersDataSource);
    
    // Cache to avoid refetching
    const loadedDisasters = {};
    const loadedTracks = {};
    let updateGen = 0;
    
    const updateDisasters = async () => {
      const currentGen = ++updateGen;
      disastersDataSource.entities.removeAll();
      const stored = localStorage.getItem('varuna_disasters');
      const toggles = stored ? JSON.parse(stored) : {};
      
      const typeMap = {
        'Cyclones': { api: 'cyclones', isHazard: false, color: '#ef4444' },
        'Oil Spillage': { api: 'oil_spill', isHazard: true, color: '#333333' }
      };
      
      for (const [key, isActive] of Object.entries(toggles)) {
        if (!isActive) continue;
        const conf = typeMap[key];
        if (!conf) continue;
        
        let data = loadedDisasters[key];
        if (!data) {
          try {
            if (conf.isHazard) {
              const res = await fetch(`${API_BASE_URL}/api/v1/hazards/${conf.api}`);
              const json = await res.json();
              let fetchedData = json.data || [];
              
              // Filter out hazards older than 7 days
              const sevenDaysAgo = new Date();
              sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
              
              data = fetchedData.filter(item => {
                if (conf.api === 'oil_spill') return true; // Show all historical spills
                if (!item.start_time) return true;
                const start = new Date(item.start_time);
                let endStr = item.end_time;
                if (endStr === 'NaT') endStr = item.start_time;
                const end = endStr ? new Date(endStr) : start;
                return start >= sevenDaysAgo || end >= sevenDaysAgo;
              });
              
            } else if (conf.api === 'cyclones') {
              const res = await fetch(`${API_BASE_URL}/api/v1/hazards/cyclones?active_only=true`);
              const json = await res.json();
              data = json.data || [];
            }
            if (currentGen !== updateGen) return;
            loadedDisasters[key] = data;
          } catch (e) {
            console.error("Failed to fetch disaster", key, e);
            continue;
          }
        }

        // ── Helper: category color from wind speed (Saffir-Simpson) ─────────
        const categoryColor = (windKts) => {
          const w = parseFloat(windKts) || 0;
          if (w >= 137) return Color.fromCssColorString('#7B1E1E'); // Cat 5
          if (w >= 113) return Color.fromCssColorString('#C0392B'); // Cat 4
          if (w >= 96)  return Color.fromCssColorString('#E67E22'); // Cat 3
          if (w >= 83)  return Color.fromCssColorString('#F1C40F'); // Cat 2
          if (w >= 64)  return Color.fromCssColorString('#27AE60'); // Cat 1
          if (w >= 34)  return Color.fromCssColorString('#95A5A6'); // Tropical Storm
          return Color.fromCssColorString('#BDC3C7');               // Tropical Depression
        };

        // ── Cyclone: draw full track instead of single icon ─────────────────
        if (key === 'Cyclone Tracking') {
          for (const item of data) {
            const sid = item.cyclone_id;
            if (!sid) continue;
            let trackData = loadedTracks[sid];
            if (!trackData) {
              try {
                const r = await fetch(`${API_BASE_URL}/api/v1/hazards/cyclone/${sid}`);
                trackData = await r.json();
                loadedTracks[sid] = trackData;
              } catch (err) {
                console.error("Failed to fetch cyclone track", sid, err);
                continue;
              }
              if (currentGen !== updateGen) return;
            }
            const positions = trackData.positions || [];
            if (positions.length === 0) continue;

            // Per-segment colored polylines
            for (let i = 0; i < positions.length - 1; i++) {
              const p0 = positions[i];
              const p1 = positions[i + 1];
              if (!p0.lat || !p1.lat) continue;
              const segColor = categoryColor(p0.wind_kts);
              const segWidth = Math.max(3, Math.min(10, (parseFloat(p0.wind_kts) || 30) / 15));
              // Core line
              disastersDataSource.entities.add({
                polyline: {
                  positions: [
                    Cartesian3.fromDegrees(parseFloat(p0.lon), parseFloat(p0.lat), 500),
                    Cartesian3.fromDegrees(parseFloat(p1.lon), parseFloat(p1.lat), 500),
                  ],
                  width: segWidth,
                  material: segColor.withAlpha(0.95),
                  clampToGround: false,
                }
              });
              // Outer glow halo
              disastersDataSource.entities.add({
                polyline: {
                  positions: [
                    Cartesian3.fromDegrees(parseFloat(p0.lon), parseFloat(p0.lat), 400),
                    Cartesian3.fromDegrees(parseFloat(p1.lon), parseFloat(p1.lat), 400),
                  ],
                  width: segWidth + 8,
                  material: segColor.withAlpha(0.18),
                  clampToGround: false,
                }
              });
            }

            // Observation dots (every other point)
            positions.forEach((p, idx) => {
              if (!p.lat || !p.lon) return;
              if (idx % 2 !== 0 && idx !== positions.length - 1) return;
              const dotColor = categoryColor(p.wind_kts);
              const isHead = idx === positions.length - 1;
              disastersDataSource.entities.add({
                position: Cartesian3.fromDegrees(parseFloat(p.lon), parseFloat(p.lat), 600),
                point: {
                  pixelSize: isHead ? 10 : 5,
                  color: dotColor,
                  outlineColor: Color.WHITE.withAlpha(0.85),
                  outlineWidth: 1.5,
                  heightReference: HeightReference.NONE,
                  scaleByDistance: new NearFarScalar(1.0e5, 1.2, 8.0e6, 0.4),
                },
              });
            });

            // Draw the wind radii swath along the entire track
            const parseCoords = (coordStr) => coordStr.split(',').map(parseFloat);
            positions.forEach((p, idx) => {
              const pLat = parseFloat(p.lat);
              const pLon = parseFloat(p.lon);
              const pWind = parseFloat(p.wind_kts) || 35;
              
              if (p.wind_radii) {
                if (p.wind_radii['34kt_polygon']) {
                  disastersDataSource.entities.add({
                    polygon: {
                      hierarchy: Cartesian3.fromDegreesArray(parseCoords(p.wind_radii['34kt_polygon'])),
                      height: 10 + (idx * 50),
                      material: Color.fromCssColorString('#27AE60').withAlpha(0.15),
                      outline: false,
                    }
                  });
                }
                if (p.wind_radii['50kt_polygon']) {
                  disastersDataSource.entities.add({
                    polygon: {
                      hierarchy: Cartesian3.fromDegreesArray(parseCoords(p.wind_radii['50kt_polygon'])),
                      height: 10 + (idx * 50) + 10,
                      material: Color.fromCssColorString('#E67E22').withAlpha(0.2),
                      outline: false,
                    }
                  });
                }
                if (p.wind_radii['64kt_polygon']) {
                  disastersDataSource.entities.add({
                    polygon: {
                      hierarchy: Cartesian3.fromDegreesArray(parseCoords(p.wind_radii['64kt_polygon'])),
                      height: 10 + (idx * 50) + 20,
                      material: Color.fromCssColorString('#C0392B').withAlpha(0.25),
                      outline: false,
                    }
                  });
                }
              } else {
                // Fallback approximation
                const scale = Math.max(0.4, Math.min(2.0, pWind / 65));
                const r64 = 60000  * scale;
                const r50 = 130000 * scale;
                const r34 = 280000 * scale;
  
                disastersDataSource.entities.add({
                  position: Cartesian3.fromDegrees(pLon, pLat, 0),
                  ellipse: {
                    semiMajorAxis: r34, semiMinorAxis: r34 * 0.85,
                    height: 10 + (idx * 50),
                    material: Color.fromCssColorString('#27AE60').withAlpha(0.05),
                    outline: false,
                  }
                });
                if (pWind >= 50) {
                  disastersDataSource.entities.add({
                    position: Cartesian3.fromDegrees(pLon, pLat, 0),
                    ellipse: {
                      semiMajorAxis: r50, semiMinorAxis: r50 * 0.85,
                      height: 10 + (idx * 50) + 10,
                      material: Color.fromCssColorString('#E67E22').withAlpha(0.1),
                      outline: false,
                    }
                  });
                }
                if (pWind >= 64) {
                  disastersDataSource.entities.add({
                    position: Cartesian3.fromDegrees(pLon, pLat, 0),
                    ellipse: {
                      semiMajorAxis: r64, semiMinorAxis: r64 * 0.85,
                      height: 10 + (idx * 50) + 20,
                      material: Color.fromCssColorString('#C0392B').withAlpha(0.15),
                      outline: false,
                    }
                  });
                }
              }
            });

            // Current-position head icon & label
            const cur = trackData.current_position || (positions.length > 0 ? positions[positions.length - 1] : null);
            if (cur && cur.lat && cur.lon) {
              const curLat = parseFloat(cur.lat);
              const curLon = parseFloat(cur.lon);

              // Head icon
              disastersDataSource.entities.add({
                id: 'disaster_' + sid,
                position: Cartesian3.fromDegrees(curLon, curLat, 3000),
                billboard: {
                  image: cycloneIcon,
                  heightReference: HeightReference.RELATIVE_TO_GROUND,
                  sizeInMeters: true,
                  width: 60000,
                  height: 60000,
                  verticalOrigin: VerticalOrigin.BOTTOM,
                  scaleByDistance: new NearFarScalar(1.0e5, 1.2, 1.0e7, 0.6),
                },
                label: {
                  text: (trackData.name || 'UNKNOWN').toUpperCase(),
                  font: 'bold 16px sans-serif',
                  fillColor: Color.WHITE,
                  outlineColor: Color.BLACK,
                  outlineWidth: 3,
                  style: 2, // LabelStyle.FILL_AND_OUTLINE
                  pixelOffset: { x: 0, y: -45 },
                  heightReference: HeightReference.RELATIVE_TO_GROUND,
                  scaleByDistance: new NearFarScalar(1.0e5, 1.2, 8.0e6, 0.0),
                },
                properties: {
                  isDisaster: true,
                  disasterType: 'Cyclones',
                  cyclone_id: sid,
                  name: trackData.name,
                  basin: trackData.basin,
                  current_position: cur,
                }
              });
            }
          }
          // Skip generic icon rendering below for cyclones
          continue;
        }

        // ── Generic Hazard Icons (non-cyclone) ──────────────────────────────
        const createDisasterIcon = (type, colorHex) => {
          if (type === 'Cyclones') return cycloneIcon;
          
          let innerSvg = '';
          if (type === 'Oil Spillage') {
            innerSvg = `
              <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
            `;
            return 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="${colorHex}" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${innerSvg}</svg>`);
          } else if (type === 'Tsunami Warning') {
            innerSvg = `
              <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
              <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
              <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
            `;
            return 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${colorHex}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${innerSvg}</svg>`);
          } else if (type === 'Fishing Zone') {
            innerSvg = `
              <path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.46-3.44 6-7 6s-7.56-2.54-8.5-6Z"/>
              <path d="M18 12v.01"/>
              <path d="M6.5 12L2 9v6l4.5-3Z"/>
            `;
            return 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${colorHex}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${innerSvg}</svg>`);
          } else if (type === 'Marine Heatwave') {
            innerSvg = `
              <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>
              <path d="M12 7v7"/>
            `;
            return 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="${colorHex}" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${innerSvg}</svg>`);
          } else {
            innerSvg = `
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            `;
            return 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="${colorHex}" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${innerSvg}</svg>`);
          }
        };

        data.forEach(item => {
          let lat, lon, id;
          if (conf.isHazard) {
            lat = item.lat;
            lon = item.lon;
            id = item.event_id;
          } else {
            if (!item.current_position) return;
            lat = item.current_position.lat;
            lon = item.current_position.lon;
            id = item.cyclone_id;
          }
          if (lat === undefined || lon === undefined || lat === '' || lon === '') return;

          const iconUrl = createDisasterIcon(key, conf.color);
          
          disastersDataSource.entities.add({
            id: 'disaster_' + id,
            position: Cartesian3.fromDegrees(parseFloat(lon), parseFloat(lat), 3000), // higher than instruments
            billboard: {
              image: iconUrl,
              heightReference: HeightReference.RELATIVE_TO_GROUND,
              sizeInMeters: true,
              width: 50000,
              height: 50000,
              verticalOrigin: VerticalOrigin.BOTTOM,
            },
            properties: {
              isDisaster: true,
              disasterType: key,
              ...item
            }
          });
        });
      }
      if (viewerRef.current) viewerRef.current.scene.requestRender();
    };
    
    updateDisasters();
    
    const handleStorageEvent = (e) => {
      if (e.detail && e.detail.key === 'varuna_disasters') {
        updateDisasters();
      }
    };
    window.addEventListener('varuna-storage', handleStorageEvent);
    
    return () => {
      window.removeEventListener('varuna-storage', handleStorageEvent);
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.dataSources.remove(disastersDataSource);
      }
    };
  }, [viewerReady]);

  return (
    <div className="globe-root">
      <div ref={containerRef} className="globe-container" />
      
      {/* HUD OVERLAY */}
      <div className="cesium-hud">
        <div className="hud-bottom-right">
          <div className="hud-controls">
            <div style={{ position: 'relative' }} ref={compassMenuRef}>
              <button 
                className="hud-btn" 
                title="Camera Navigation" 
                onClick={() => setIsCompassMenuOpen(!isCompassMenuOpen)}
              >
                <svg viewBox="0 0 24 24" width="28" height="28" id="hud-compass-icon" style={{ transform: 'rotate(0deg)' }}>
                  <path d="M12 0 L7 12 L12 12 Z" fill="#ef4444" />
                  <path d="M12 0 L17 12 L12 12 Z" fill="#b91c1c" />
                  <path d="M12 24 L7 12 L12 12 Z" fill="#d1d5db" />
                  <path d="M12 24 L17 12 L12 12 Z" fill="#9ca3af" />
                </svg>
              </button>
              
              {isCompassMenuOpen && (
                <div className="compass-dropdown">
                  <button className="compass-close-btn" onClick={() => setIsCompassMenuOpen(false)}>
                    <X size={16} />
                  </button>
                  
                  <div className="slider-group">
                    <label>Tilt</label>
                    <input 
                      type="range" 
                      id="compass-tilt-slider" 
                      min="0" 
                      max="90" 
                      step="1"
                      defaultValue="0"
                      onInput={(e) => {
                        const val = parseFloat(e.target.value);
                        e.target.style.setProperty('--val', `${((val - e.target.min) / (e.target.max - e.target.min)) * 100}%`);
                        const valEl = document.getElementById('compass-tilt-val');
                        if (valEl) valEl.textContent = Math.round(val) + '°';
                        
                        if (viewerRef.current) {
                          const cam = viewerRef.current.camera;
                          const alt = cam.positionCartographic.height;
                          const R = viewerRef.current.scene.globe.ellipsoid.maximumRadius;
                          const horizonPitch = alt > 0 ? CesiumMath.toDegrees(-Math.acos(R / (R + alt))) : 0;
                          
                          // Map UI [0, 90] back to Cesium [-90, horizonPitch]
                          const mappedPitch = -90 + (val / 90) * (horizonPitch + 90);
                          
                          cam.setView({
                            orientation: {
                              heading: cam.heading,
                              pitch: CesiumMath.toRadians(mappedPitch),
                              roll: 0
                            }
                          });
                        }
                      }}
                    />
                    <span id="compass-tilt-val" className="slider-value">0°</span>
                  </div>
                  
                  <div className="slider-group">
                    <label>Heading</label>
                    <input 
                      type="range" 
                      id="compass-heading-slider" 
                      min="-180" 
                      max="180" 
                      step="1"
                      defaultValue="0"
                      onInput={(e) => {
                        const val = parseFloat(e.target.value);
                        e.target.style.setProperty('--val', `${((val + 180) / 360) * 100}%`);
                        const valEl = document.getElementById('compass-heading-val');
                        if (valEl) valEl.textContent = Math.round(val) + '°';
                        
                        if (viewerRef.current) {
                          const cam = viewerRef.current.camera;
                          cam.setView({
                            orientation: {
                              heading: CesiumMath.toRadians(val < 0 ? val + 360 : val),
                              pitch: cam.pitch,
                              roll: 0
                            }
                          });
                        }
                      }}
                    />
                    <span id="compass-heading-val" className="slider-value">0°</span>
                  </div>
                  
                  <button 
                    className="reset-north-btn"
                    onClick={() => {
                      if (viewerRef.current) {
                        const cam = viewerRef.current.camera;
                        cam.flyTo({
                          destination: cam.position,
                          orientation: { heading: 0, pitch: cam.pitch, roll: 0 },
                          duration: 1.0
                        });
                      }
                    }}
                  >
                    Reset to north
                  </button>
                </div>
              )}
            </div>
            <div className="hud-zoom-group">
              <button className="hud-btn" title="Zoom In" onClick={() => {
                const cam = viewerRef.current?.camera
                if (!cam) return
                const amount = cam.positionCartographic.height * 0.4
                const newPos = new Cartesian3()
                Cartesian3.multiplyByScalar(cam.direction, amount, newPos)
                Cartesian3.add(cam.position, newPos, newPos)
                cam.flyTo({ 
                  destination: newPos, 
                  orientation: { heading: cam.heading, pitch: cam.pitch, roll: cam.roll }, 
                  duration: 0.5,
                  easingFunction: EasingFunction.QUADRATIC_OUT
                })
              }}><Plus size={16} /></button>
              <button className="hud-btn" title="Zoom Out" onClick={() => {
                const cam = viewerRef.current?.camera
                if (!cam) return
                const amount = cam.positionCartographic.height * 0.4
                const newPos = new Cartesian3()
                Cartesian3.multiplyByScalar(cam.direction, -amount, newPos)
                Cartesian3.add(cam.position, newPos, newPos)
                cam.flyTo({ 
                  destination: newPos, 
                  orientation: { heading: cam.heading, pitch: cam.pitch, roll: cam.roll }, 
                  duration: 0.5,
                  easingFunction: EasingFunction.QUADRATIC_OUT
                })
              }}><Minus size={16} /></button>
            </div>
          </div>
        </div>
        
        <div className="hud-bottom-bar">
          <div className="hud-footer-left">
            <span className="hud-brand">Varuna</span>
            <span 
              className="hud-attribution" 
              data-tooltip="Sources: CMEMS, Argo GDAC, IBTrACS, NOAA"
              style={{ cursor: 'pointer' }}
              onClick={() => window.dispatchEvent(new CustomEvent('open-data-sources'))}
            >
              Data attribution
            </span>
          </div>
          <div className="hud-footer-content">
            <div className="hud-scale-wrapper">
              <span id="hud-scale-val">0 km</span>
              <div id="hud-scale-box" className="hud-scale-box"></div>
            </div>
            <div className="hud-camera-container">
              Camera: <span id="hud-alt" className="hud-camera-value">0 km</span>
            </div>
            <div id="hud-coords" className="hud-value">Hover over globe</div>
          </div>
        </div>
      </div>
      {volumeConfig && viewerReady && (
        <VolumetricOcean
          viewer={viewerRef.current}
          {...volumeConfig}
        />
      )}
    </div>
  )
}
