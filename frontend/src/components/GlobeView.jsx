import { useEffect, useRef, useState } from 'react'
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
} from 'cesium'
import { Navigation, Plus, Minus, X } from 'lucide-react'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { OceanTileProvider } from '../utils/OceanTileProvider'
import VolumetricOcean from './VolumetricOcean'
import './GlobeView.css'

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
    window.setOceanVariable = (varName, isActive, options = {}) => {
      console.log(`[VOL-API] setOceanVariable varName=${varName} isActive=${isActive}`);

      if (!isActive) {
        pendingVolumeConfig.current = null;
        setVolumeConfig(null);
        if (viewerRef.current) viewerRef.current.scene.requestRender();
        return;
      }

      const timeKey = '2026-09-21';
      const variableMap = {
        'Temperature': 'temperature', 'Sea Surface Temperature': 'temperature',
        'Salinity': 'salinity', 'Currents': 'currents', 'Chlorophyll': 'chlorophyll',
        'Oxygen': 'oxygen', 'Nitrate': 'nitrate', 'Phosphate': 'phosphate', 'Silicate': 'silicate'
      };
      const variable = variableMap[varName] || 'temperature';

      const savedDepthStr = localStorage.getItem('polaris_oceanDepth');
      const oceanDepth = savedDepthStr ? parseInt(JSON.parse(savedDepthStr)) : 0;
      const savedExaggStr = localStorage.getItem('polaris_vertExagg');
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
        imageryProvider:         false,
      })

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
      setTimeout(() => {
        if (!isActive()) return
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
        } else {
          coordsText.textContent = `Deep Space`
        }
      }, ScreenSpaceEventType.MOUSE_MOVE)

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
        
        viewer.imageryLayers.removeAll()
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
      window.toggleSunlight = async (enable) => {
        if (!viewerRef.current) return
        const scene = viewerRef.current.scene
        const { ShadowMode, JulianDate, ClockStep } = await import('cesium')
        
        scene.globe.enableLighting = enable
        viewerRef.current.shadows = enable
        // Terrain shadows disabled due to square artifacting at high exaggeration
        viewerRef.current.terrainShadows = ShadowMode.DISABLED

        if (enable) {
          viewerRef.current.clock.clockStep = ClockStep.SYSTEM_CLOCK
          viewerRef.current.clock.currentTime = JulianDate.now()
          viewerRef.current.clock.shouldAnimate = true
          viewerRef.current.clock.multiplier = 1.0
        } else {
          viewerRef.current.clock.shouldAnimate = false
        }
        
        // Also toggle the skyAtmosphere on so we get realistic sunrise/sunset scatter effects!
        if (enable && !scene.skyAtmosphere) {
          const { SkyAtmosphere } = await import('cesium')
          scene.skyAtmosphere = new SkyAtmosphere()
        }
        if (scene.skyAtmosphere) {
          scene.skyAtmosphere.show = enable
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
            <span className="hud-brand">Polaris</span>
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
