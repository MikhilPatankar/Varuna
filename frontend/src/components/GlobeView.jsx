import { useEffect, useRef } from 'react'
import {
  Viewer,
  createWorldTerrainAsync,
  Color,
  Cartesian3,
  Math as CesiumMath,
  Rectangle,
  SingleTileImageryProvider,
  CesiumTerrainProvider,
  CameraEventType,
  KeyboardEventModifier,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import './GlobeView.css'



// ─── Main Globe Component ─────────────────────────────────────────────────────
export default function GlobeView() {
  const containerRef = useRef(null)
  const viewerRef    = useRef(null)

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
        requestRenderMode:       false,
        msaaSamples:             4,
        creditContainer:         document.createElement('div'),
        skyBox:                  false,
        skyAtmosphere:           false,
        imageryProvider:         false,
      })

      viewerRef.current = viewer
      const { scene, camera } = viewer
      const globe = scene.globe

      // 1. VERTICAL EXAGGERATION
      // 100x exaggeration makes the oceanic trenches extremely deep and visible from space.
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
      scene.highDynamicRange = false
      scene.postProcessStages.fxaa.enabled = true

      // Camera
      camera.setView({
        destination: Cartesian3.fromDegrees(60.0, 0.0, 16_000_000),
        orientation: {
          heading: 0,
          pitch:   CesiumMath.toRadians(-90),
          roll:    0,
        },
      })

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
      } catch (e) {
        console.error('[POLARIS] Failed to load static bathymetry WebP:', e)
      }

      // 5. BASE MAP (Loaded SECOND to yield bandwidth to the ocean)
      // Native Cesium Ion Satellite Map (AERIAL only, no messy labels or roads).
      const { createWorldImageryAsync, IonWorldImageryStyle } = await import('cesium')
      
      const satelliteMap = await createWorldImageryAsync({
        style: IonWorldImageryStyle.AERIAL
      })
      
      if (!isActive()) return
      
      // Inject the satellite map at z-index 0 so it stays UNDER the bathymetry layer!
      const satLayer = viewer.imageryLayers.addImageryProvider(satelliteMap, 0)
      
      // --- SATELLITE VISUAL SETTINGS ---
      satLayer.alpha = 1.0
      satLayer.brightness = 1.0
      satLayer.contrast = 1.0
      satLayer.saturation = 1.0
      satLayer.gamma = 1.0
      satLayer.hue = 0.0
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
      <div className="globe-wordmark">
        <span className="wordmark-dot" />
        <span className="wordmark-text">POLARIS</span>
        <span className="wordmark-sub">Ocean Digital Twin</span>
      </div>
    </div>
  )
}
