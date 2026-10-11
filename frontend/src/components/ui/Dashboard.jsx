import { useState, useEffect, useRef, useMemo } from 'react'
import { Cartesian3, Math as CesiumMath } from 'cesium'
import { 
  Camera, Settings, Info, FileText, Database,
  Home, Sun, Sparkles, Moon, Mountain, Layers, Map as MapIcon,
  User, Box, Satellite, Radio, Folder, FileEdit, Clock, Activity, Calendar,
  Search, X, List, RefreshCw, Plus, ChevronLeft, ChevronRight,
  Waves, AlertTriangle, Radar, Droplet, Eye, Settings2, ToggleLeft, ToggleRight, Download, Thermometer, Droplets, Wind, Flame, Crosshair, Siren,
  ArrowRightLeft, MoveHorizontal, Baseline, Columns, AlignLeft, BarChart2, Trash2
} from 'lucide-react'
import './Dashboard.css'
import BottomToolbar from './BottomToolbar'

function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn(error);
      return initialValue;
    }
  });

  const setValue = (value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
        window.dispatchEvent(new CustomEvent('varuna-storage', {
          detail: { key, value: valueToStore }
        }));
      }
    } catch (error) {
      console.warn(error);
    }
  };

  return [storedValue, setValue];
}

const getSliderBg = (val, min, max) => {
  const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  return `linear-gradient(to right, #3b82f6 ${pct}%, #cbd5e1 ${pct}%)`;
};

const getDisplayLimits = (minStr, maxStr, isMasked, unit = '') => {
  const min = parseFloat(minStr) || 0;
  const max = parseFloat(maxStr) || 0;
  let dMin = min;
  let dMax = max;
  if (isMasked) {
    const diff = max - min;
    dMin = Math.round(min + diff * 0.015);
    dMax = Math.round(max - diff * 0.015);
  }
  return [dMin, Math.round((dMin + dMax) / 2), `${dMax} ${unit}`.trim()];
};

export default function Dashboard() {
  // Inner panel is closed by default, but sidebar remains expanded
  const [activeSidebar, setActiveSidebar] = useLocalStorage('varuna_activeSidebar', null)
  const [isSidebarOpen, setIsSidebarOpen] = useLocalStorage('varuna_isSidebarOpen', true)
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef(null)
  
  const [isMapMenuOpen, setIsMapMenuOpen] = useState(false)
  const [activeMap, setActiveMap] = useLocalStorage('varuna_activeMap', 'Bing Aerial')
  const [is3D, setIs3D] = useLocalStorage('varuna_is3D', false)
  const [isStarsOn, setIsStarsOn] = useLocalStorage('varuna_isStarsOn', true)
  const [isSunlightOn, setIsSunlightOn] = useLocalStorage('varuna_isSunlightOn', false)
  const [isRotating, setIsRotating] = useLocalStorage('varuna_isRotating', false)
  const [visualQuality, setVisualQuality] = useLocalStorage('varuna_visualQuality', 6)
  const [tileCacheLimit, setTileCacheLimit] = useLocalStorage('varuna_tileCacheLimit', 10000)
  const [atmosphereGlow, setAtmosphereGlow] = useLocalStorage('varuna_atmosphereGlow', 10)
  const mapMenuRef = useRef(null)
  const [activeModal, setActiveModal] = useState(null)

  useEffect(() => {
    const handleOpenDataSources = () => setActiveModal('database');
    window.addEventListener('open-data-sources', handleOpenDataSources);
    return () => window.removeEventListener('open-data-sources', handleOpenDataSources);
  }, []);

  const [viewerReady, setViewerReady] = useState(false);

  // Sync Cesium viewer with persisted UI toggles on initial mount
  useEffect(() => {
    let attempts = 0;
    const syncInterval = setInterval(() => {
      attempts++;
      if (window.cesiumViewer && window.toggleSunlight && window.toggleStars && window.changeMapLayer && window.toggleAutoRotate && window.setOceanVariable) {
        window.toggleSunlight(isSunlightOn);
        window.toggleStars(isStarsOn);
        window.changeMapLayer(activeMap);
        window.toggleAutoRotate(isRotating);
        
        if (window.setBathyEnabled) window.setBathyEnabled(bathyEnabled, vertExagg);
        if (window.setBathyOpacity) window.setBathyOpacity(bathyOpacity);
        if (window.setGlobeExaggeration) window.setGlobeExaggeration(vertExagg);
        if (window.setVisualQuality) window.setVisualQuality(visualQuality);
        if (window.setTileCacheLimit) window.setTileCacheLimit(tileCacheLimit);
        if (window.setAtmosphereGlow) window.setAtmosphereGlow(atmosphereGlow);
        
        if (window.is3DView !== undefined && window.is3DView !== is3D && window.toggle2D3D) {
          window.toggle2D3D();
        }
        
        // Let the main useEffect know the viewer is ready to receive ocean config
        setViewerReady(true);
        
        clearInterval(syncInterval);
      } else if (attempts > 50) {
        clearInterval(syncInterval);
      }
    }, 200);
    return () => clearInterval(syncInterval);
  }, []);

  // Handle clicking outside of dropdowns to close them
  useEffect(() => {
    function handleClickOutside(event) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target)) setIsAccountMenuOpen(false)
      if (mapMenuRef.current && !mapMenuRef.current.contains(event.target)) setIsMapMenuOpen(false)
    }
    if (isAccountMenuOpen || isMapMenuOpen) document.addEventListener("mousedown", handleClickOutside)
    else document.removeEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [isAccountMenuOpen, isMapMenuOpen])

  // ── Layer Settings State ──────────────────────────────
  const [activeLayers, setActiveLayers] = useLocalStorage('varuna_activeLayers', {})
  const [bathyEnabled, setBathyEnabled] = useLocalStorage('varuna_bathyEnabled', false)
  const [bathyOpacity, setBathyOpacity] = useLocalStorage('varuna_bathyOpacity', 100)
  const [bathyColorMapIdx, setBathyColorMapIdx] = useLocalStorage('varuna_bathyColorMapIdx', 4)
  const [bathyInverted, setBathyInverted] = useLocalStorage('varuna_bathyInverted', false)
  const [bathyStepwise, setBathyStepwise] = useLocalStorage('varuna_bathyStepwise', false)
  const [bathySteps, setBathySteps] = useLocalStorage('varuna_bathySteps', 5)
  const [bathyMasked, setBathyMasked] = useLocalStorage('varuna_bathyMasked', false)
  const [showBathySettings, setShowBathySettings] = useLocalStorage('varuna_showBathySettings', true)
  const [vertExagg, setVertExagg] = useLocalStorage('varuna_vertExagg', 80.0)
  const [crossHeight, setCrossHeight] = useLocalStorage('varuna_crossHeight', 200)

  // ── Ocean Variables State ─────────────────────────────
  const [oceanTab, setOceanTab] = useLocalStorage('varuna_oceanTab', 'Physical')
  const [activeOceanVar, setActiveOceanVar] = useLocalStorage('varuna_activeOceanVar', null)
  const [showVarSettings, setShowVarSettings] = useLocalStorage('varuna_ocean_showVarSettings', {})
  const [opacity, setOpacity] = useLocalStorage('varuna_ocean_opacity', {})
  const [colorMapIdx, setColorMapIdx] = useLocalStorage('varuna_ocean_colorMapIdx', {})
  const [varInverted, setVarInverted] = useLocalStorage('varuna_ocean_varInverted', {})
  const [varStepwise, setVarStepwise] = useLocalStorage('varuna_ocean_varStepwise', {})
  const [varSteps, setVarSteps] = useLocalStorage('varuna_ocean_varSteps', {})
  const [varMasked, setVarMasked] = useLocalStorage('varuna_ocean_varMasked', {})
  const [varMaskOutline, setVarMaskOutline] = useLocalStorage('varuna_ocean_maskOutline', {})
  const [varClipMin, setVarClipMin] = useLocalStorage('varuna_ocean_clipMin', {})
  const [varClipMax, setVarClipMax] = useLocalStorage('varuna_ocean_clipMax', {})
  const [varMin, setVarMin] = useLocalStorage('varuna_ocean_varMin', {})
  const [varMax, setVarMax] = useLocalStorage('varuna_ocean_varMax', {})
  const [customColor1_ocean, setCustomColor1_ocean] = useLocalStorage('varuna_ocean_customColor1', {})
  const [customColor2_ocean, setCustomColor2_ocean] = useLocalStorage('varuna_ocean_customColor2', {})
  
  const [oceanDepth, setOceanDepth] = useLocalStorage('varuna_oceanDepth', 0)
  const [oceanDensity, setOceanDensity] = useLocalStorage('varuna_oceanDensity', 25)
  
  // Shared advanced settings state (Bathymetry)
  const [customColor1, setCustomColor1] = useLocalStorage('varuna_customColor1', '#3b82f6')
  const [customColor2, setCustomColor2] = useLocalStorage('varuna_customColor2', '#10b981')
  
  const [bathyMin, setBathyMin] = useLocalStorage('varuna_bathyMin', '-6000')
  const [bathyMax, setBathyMax] = useLocalStorage('varuna_bathyMax', '0')

  useEffect(() => {
    if (window.setBathyEnabled) window.setBathyEnabled(bathyEnabled, vertExagg);
  }, [bathyEnabled, vertExagg]);

  useEffect(() => {
    if (window.setBathyOpacity) window.setBathyOpacity(bathyOpacity);
  }, [bathyOpacity]);

  useEffect(() => {
    if (window.setGlobeExaggeration) window.setGlobeExaggeration(vertExagg);
  }, [vertExagg]);

  // Handle opacity changes instantly via WebGL alpha without destroying the layer
  useEffect(() => {
    if (window.updateOceanOpacity) {
      window.updateOceanOpacity((opacity['Sea Surface Temperature'] ?? 100) / 100.0);
    }
  }, [opacity['Sea Surface Temperature']]);

  const baseColorMaps = [
    { label: 'Jet',     bg: 'linear-gradient(to right, #000080, #0000ff, #00ffff, #ffff00, #ff0000)' },
    { label: 'Viridis', bg: 'linear-gradient(to right, #440154, #3b528b, #21918c, #5ec962, #fde725)' },
    { label: 'Plasma',  bg: 'linear-gradient(to right, #0d0887, #7e03a8, #cc4778, #f89540, #f0f921)' },
    { label: 'Turbo',   bg: 'linear-gradient(to right, #30123b, #28bbec, #a2ffa4, #fb8022, #7a0403)' },
    { label: 'Thermal', bg: 'linear-gradient(to right, #0b0405, #35193e, #701f57, #b02a63, #e55355)' },

    { label: 'Blues',   bg: 'linear-gradient(to right, #f7fbff, #08306b)' },
    { label: 'Reds',    bg: 'linear-gradient(to right, #fff5f0, #67000d)' },
    { label: 'Greens',  bg: 'linear-gradient(to right, #f7fcf5, #00441b)' },
    { label: 'Grayscale', bg: 'linear-gradient(to right, #000000, #ffffff)' },
    { label: 'Steps',  bg: 'linear-gradient(to right, #333333, #cccccc)' }
  ];

  const getColorsForLayer = (layerName) => {
    if (!layerName) return ['#000000', '#ffffff', '#ffffff', '#ffffff', '#ffffff'];
    const idx = colorMapIdx[layerName] ?? 0;
    const cInverted = varInverted[layerName] ?? false;
    let color1 = '#000000', color2 = '#ffffff';
    
    if (idx === 9) {
      color1 = customColor1_ocean[layerName] ?? '#3b82f6';
      color2 = customColor2_ocean[layerName] ?? '#10b981';
    }
    
    let bg = baseColorMaps[idx]?.bg || '';
    if (idx === 9) bg = `linear-gradient(to right, ${color1}, ${color2})`;
    
    let colors = bg.match(/#[0-9a-fA-F]{3,6}/g) || ['#000000', '#ffffff'];
    if (cInverted) colors = [...colors].reverse();
    
    let sampledColors = [];
    for (let i = 0; i < 5; i++) {
      let t = i / 4.0;
      let idxF = t * (colors.length - 1);
      let idx1 = Math.floor(idxF);
      let idx2 = Math.ceil(idxF);
      let frac = idxF - idx1;
      
      let hex1 = colors[idx1].replace('#','');
      let hex2 = colors[idx2].replace('#','');
      if (hex1.length === 3) hex1 = hex1.split('').map(c => c+c).join('');
      if (hex2.length === 3) hex2 = hex2.split('').map(c => c+c).join('');
      
      let r1 = parseInt(hex1.substring(0,2), 16), g1 = parseInt(hex1.substring(2,4), 16), b1 = parseInt(hex1.substring(4,6), 16);
      let r2 = parseInt(hex2.substring(0,2), 16), g2 = parseInt(hex2.substring(2,4), 16), b2 = parseInt(hex2.substring(4,6), 16);
      
      let r = Math.round(r1 + (r2 - r1) * frac);
      let g = Math.round(g1 + (g2 - g1) * frac);
      let b = Math.round(b1 + (b2 - b1) * frac);
      
      sampledColors.push(`#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`);
    }
    return sampledColors;
  };

  const currentColorMapInfo = useMemo(() => {
    if (!activeOceanVar) return null;
    
    const sampledColors = getColorsForLayer(activeOceanVar);
    
    const uMin = varMin[activeOceanVar] !== undefined ? parseFloat(varMin[activeOceanVar]) : null;
    const uMax = varMax[activeOceanVar] !== undefined ? parseFloat(varMax[activeOceanVar]) : null;
    
    const clipMin = varClipMin[activeOceanVar] ?? 0;
    const clipMax = varClipMax[activeOceanVar] ?? 100;
    
    return { colors: sampledColors, uMin, uMax, clipMin, clipMax };
  }, [activeOceanVar, colorMapIdx, varInverted, customColor1_ocean, customColor2_ocean, varMin, varMax, varClipMin, varClipMax, baseColorMaps]);

  // Handle toggling the layer on/off
  useEffect(() => {
    if (window.setOceanVariable) {
      if (activeOceanVar) {
        window.setOceanVariable(activeOceanVar, true, { 
          opacity: (opacity[activeOceanVar] ?? 100) / 100.0,
          oceanDepth: oceanDepth,
          oceanDensity: oceanDensity,
          colormapSettings: {
            colors: currentColorMapInfo ? currentColorMapInfo.colors : null,
            uMin: varMin[activeOceanVar] !== undefined ? parseFloat(varMin[activeOceanVar]) : undefined,
            uMax: varMax[activeOceanVar] !== undefined ? parseFloat(varMax[activeOceanVar]) : undefined,
            clipMin: varClipMin[activeOceanVar] ?? 0,
            clipMax: varClipMax[activeOceanVar] ?? 100,
            inverted: varInverted[activeOceanVar] ?? false,
            stepwise: varStepwise[activeOceanVar] ?? false,
            steps: varSteps[activeOceanVar] ?? 5,
            masked: varMasked[activeOceanVar] ?? false,
            maskOutline: varMaskOutline[activeOceanVar] ?? 1.5
          }
        });
      } else {
        window.setOceanVariable('Temperature', false); // The variable name doesn't matter if isActive is false
      }
    }
    // Expose for MarkModal so it queries the correct variable
    window.varunaActiveOceanVar = activeOceanVar || null;
}, [viewerReady, activeOceanVar, opacity, oceanDepth, oceanDensity, currentColorMapInfo, varMin, varMax, varClipMin, varClipMax, varInverted, varStepwise, varSteps, varMasked, varMaskOutline]);



  // Handle toggling the 2D layers on/off
  useEffect(() => {
    if (window.set2DLayer) {
      ['Sea Surface Height', 'Sea Surface Temperature', 'Surface Currents'].forEach(layer => {
        const isActive = activeLayers[layer] || false;
        
        window.set2DLayer(layer, isActive, {
          opacity: (opacity[layer] ?? 100) / 100.0,
          colormapSettings: {
            colors: getColorsForLayer(layer),
            inverted: varInverted[layer] ?? false,
            stepwise: varStepwise[layer] ?? false,
            steps: varSteps[layer] ?? 5,
            masked: varMasked[layer] ?? false,
            maskOutline: varMaskOutline[layer] ?? 1.5
          },
          vmin: varMin[layer] !== undefined ? parseFloat(varMin[layer]) : null,
          vmax: varMax[layer] !== undefined ? parseFloat(varMax[layer]) : null
        });
      });
    }
  }, [activeLayers, opacity, colorMapIdx, varInverted, customColor1_ocean, customColor2_ocean, varStepwise, varSteps, varMin, varMax, viewerReady, varMasked, varMaskOutline]);

  useEffect(() => {
    if (window.updateOceanColormap && currentColorMapInfo) {
      window.updateOceanColormap(currentColorMapInfo);
    }
  }, [currentColorMapInfo]);

  const getProcessedGradient = (idx, inverted, stepwise, stepsCount = 5, cc1 = customColor1, cc2 = customColor2, masked = false, maskOutline = 1.5) => {
    let bg = baseColorMaps[idx]?.bg || '';
    if (idx === 9 || idx === 24) {
      bg = `linear-gradient(to right, ${cc1}, ${cc2})`;
    }
    
    let colors = bg.match(/#[0-9a-fA-F]{3,6}|rgba?\([^)]+\)/g) || [];
    let innerGradientStr = '';

    if (stepwise && colors.length > 0) {
      let steps = [];
      for (let i = 0; i < stepsCount; i++) {
        const t = (i / Math.max(1, stepsCount - 1)) * (colors.length - 1);
        const idx1 = Math.floor(t);
        const idx2 = Math.ceil(t);
        const pct = Math.round((t - idx1) * 100);
        const c1 = colors[idx1];
        const c2 = colors[idx2];
        const c = (idx1 === idx2) ? c1 : `color-mix(in srgb, ${c2} ${pct}%, ${c1})`;
        
        let startPct = (i / stepsCount) * 100;
        let endPct = ((i + 1) / stepsCount) * 100;
        
        if (masked) {
           const threshold = maskOutline / 2;
           // Remap percentages so the steps fit inside the unmasked region
           startPct = threshold + (startPct / 100) * (100 - maskOutline);
           endPct = threshold + (endPct / 100) * (100 - maskOutline);
        }
        
        steps.push(`${c} ${startPct}%`, `${c} ${endPct}%`);
      }
      innerGradientStr = steps.join(', ');
    } else {
      if (masked && colors.length > 0) {
        const threshold = maskOutline / 2;
        let stops = [];
        for (let i = 0; i < colors.length; i++) {
          const t = i / (colors.length - 1);
          const mappedPct = threshold + t * (100 - maskOutline);
          stops.push(`${colors[i]} ${mappedPct}%`);
        }
        innerGradientStr = stops.join(', ');
      } else {
        innerGradientStr = colors.join(', ');
      }
    }

    if (masked) {
      const threshold = maskOutline / 2;
      bg = `linear-gradient(to right, #000000 0%, #000000 ${threshold}%, ${innerGradientStr}, #000000 ${100 - threshold}%, #000000 100%)`;
    } else {
      bg = `linear-gradient(to right, ${innerGradientStr})`;
    }

    if (inverted) {
      bg = bg.replace('to right', 'to left');
    }
    
    return bg;
  }

  const [disasters, setDisasters] = useLocalStorage('varuna_disasters', {
    'Cyclones': false,
    'Oil Spillage': false,
  })

  // ── Anomaly State ────────────────────────────────────
  const [anomalyVars, setAnomalyVars] = useLocalStorage('varuna_anomaly', {
    'Temperature': false,
  })
  const [anomalyYears, setAnomalyYears] = useLocalStorage('varuna_anomalyYears', 5)

  // ── Instrument State ──────────────────────────────────
  const [instruments, setInstruments] = useLocalStorage('varuna_instruments', {
    'Argo Floats': false, 'CTD Profilers': false,
    'Satellite Altimeters': false, 'Moored Buoys': false,
    'Gliders': false, 'Drifters': false,
    'Tide Gauges': false, 'Acoustic Doppler': false,
  })

  const oceanVars = [
    { name: 'Temperature', icon: Thermometer, gradient: 'linear-gradient(to right, #1a1a3a, #5b326d, #c5535c, #f6a157, #fdf870)', min: '-2', mid: '14', max: '30 °C' },
    { name: 'Salinity',    icon: Droplets,    gradient: 'linear-gradient(to right, #081d58, #253494, #1d91c0, #7fcdbb, #ffffd9)', min: '30', mid: '35', max: '40 ‰'  },
    { name: 'Chlorophyll', icon: Droplet,     gradient: 'linear-gradient(to right, #ffffff, #d9f0a3, #78c679, #238443, #004529)', min: '0',  mid: '5',  max: '10 mg/m³'},
    { name: 'Oxygen',      icon: RefreshCw,   gradient: 'linear-gradient(to right, #67001f, #d6604d, #f7f7f7, #4393c3, #053061)', min: '0',  mid: '150',max: '300 µmol/L'},
    { name: 'Nitrate',     icon: Activity,    gradient: 'linear-gradient(to right, #fff7bc, #fec44f, #d95f0e)',                   min: '0',  mid: '20', max: '40 µmol/L'},
    { name: 'Phosphate',   icon: Mountain,    gradient: 'linear-gradient(to right, #edf8b1, #7fcdbb, #2c7fb8)',                  min: '0',  mid: '1.5',max: '3 µmol/L'},
    { name: 'Silicate',    icon: Box,         gradient: 'linear-gradient(to right, #feedde, #fdbe85, #fd8d3c, #d94701)',         min: '0',  mid: '50', max: '100 µmol/L'},
  ]



  const sidebarItems = [
    { name: 'Layers', icon: Layers },
    { name: 'Ocean', icon: Waves },
    { name: 'Disasters', icon: Siren },
    { name: 'Sensors', icon: Radar },
    { name: 'Settings', icon: Settings }
  ]


  return (
    <div className="dashboard-root">
      
      {/* TOP LEFT: Brand & Tools */}
      <div className="top-left-panel">
        <div className="brand">
          <span className="brand-dot" />
          <span className="brand-text">VARUNA</span>
</div>
        
        <div className="toolbar">
          <button 
            className="tool-btn" 
            data-tooltip="Screenshot"
            onClick={() => {
              if (window.cesiumViewer) {
                const viewer = window.cesiumViewer;
                viewer.render(); // Force a synchronous WebGL frame buffer render
                const dataUrl = viewer.canvas.toDataURL('image/png');
                const link = document.createElement('a');
                link.download = `Varuna_Capture_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
                link.href = dataUrl;
                link.click();
              }
            }}
          >
            <Camera size={14} />
          </button>
          <button className="tool-btn" data-tooltip="Settings"><Settings size={14} /></button>
          <button 
            className={`tool-btn ${activeModal === 'changelog' ? 'active' : ''}`} 
            data-tooltip="Changelog"
            onClick={() => setActiveModal(activeModal === 'changelog' ? null : 'changelog')}
          >
            <FileText size={14} />
          </button>
          <button 
            className={`tool-btn ${activeModal === 'info' ? 'active' : ''}`} 
            data-tooltip="Info"
            onClick={() => setActiveModal(activeModal === 'info' ? null : 'info')}
          >
            <Info size={14} />
          </button>
        </div>
      </div>

      {/* TOP CENTER: Navigation Tools */}
      <div className="top-center-panel">
        <div className="toolbar">
          <button 
            className="tool-btn" 
            data-tooltip="Home View"
            onClick={() => {
              if (window.cesiumViewer) {
                if (is3D) {
                  window.cesiumViewer.camera.flyTo({
                    // Centering directly on India in 3D tilted view!
                    destination: Cartesian3.fromDegrees(81.2351, -11.1834, 5686029),
                    orientation: {
                      heading: 0,
                      pitch: CesiumMath.toRadians(-65.16),
                      roll: 0
                    },
                    duration: 2.0
                  })
                } else {
                  window.cesiumViewer.camera.flyTo({
                    // Centering directly on India in 2D top-down view
                    destination: Cartesian3.fromDegrees(78.9629, 20.5937, 10000000),
                    orientation: {
                      heading: 0,
                      pitch: CesiumMath.toRadians(-90),
                      roll: 0
                    },
                    duration: 2.0
                  })
                }
              }
            }}
          >
            <Home size={14} />
          </button>
          <button 
            className={`tool-btn ${!isSunlightOn ? 'inactive' : ''}`} 
            data-tooltip={isSunlightOn ? "Disable Sunlight" : "Enable Sunlight"}
            onClick={() => {
              const newState = !isSunlightOn;
              setIsSunlightOn(newState);
              window.toggleSunlight?.(newState);
            }}
          >
            <Sun size={14} style={{ opacity: isSunlightOn ? 1.0 : 0.4 }} />
          </button>
          <button 
            className={`tool-btn ${!isStarsOn ? 'inactive' : ''}`} 
            data-tooltip={isStarsOn ? "Hide Stars" : "Show Stars"}
            onClick={() => {
              const newState = !isStarsOn;
              setIsStarsOn(newState);
              window.toggleStars?.(newState);
            }}
          >
            <Sparkles size={14} style={{ opacity: isStarsOn ? 1.0 : 0.4 }} />
          </button>

          <button 
            className={`tool-btn ${!isRotating ? 'inactive' : ''}`} 
            data-tooltip={isRotating ? "Stop Rotation" : "Auto Rotate"}
            onClick={() => {
              const newState = !isRotating;
              setIsRotating(newState);
              window.toggleAutoRotate?.(newState);
            }}
          >
            <RefreshCw size={14} style={{ opacity: isRotating ? 1.0 : 0.4 }} />
          </button>
          
          <button 
            className="tool-btn" 
            data-tooltip={is3D ? "Switch to 2D" : "Switch to 3D"}
            onClick={() => {
              setIs3D(!is3D);
              window.toggle2D3D?.();
            }}
          >
            <span style={{ fontSize: '11px', fontWeight: '800' }}>{is3D ? '3D' : '2D'}</span>
          </button>
          
          <div style={{ position: 'relative' }} ref={mapMenuRef}>
            <button 
              className={`tool-btn ${isMapMenuOpen ? 'active' : ''}`} 
              data-tooltip="Map"
              onClick={() => setIsMapMenuOpen(!isMapMenuOpen)}
            >
              <MapIcon size={14} />
            </button>
            
            {isMapMenuOpen && (
              <div className="map-dropdown">
                <div className="map-category">2D MAPS</div>
                <button 
                  className={`map-option ${activeMap === 'Bing Aerial' ? 'active' : ''}`}
                  onClick={() => { setActiveMap('Bing Aerial'); window.changeMapLayer?.('Bing Aerial'); setIsMapMenuOpen(false); }}
                >Bing Aerial</button>
                <button 
                  className={`map-option ${activeMap === 'Bing Aerial with Labels' ? 'active' : ''}`}
                  onClick={() => { setActiveMap('Bing Aerial with Labels'); window.changeMapLayer?.('Bing Aerial with Labels'); setIsMapMenuOpen(false); }}
                >Bing Aerial with Labels</button>
                <button 
                  className={`map-option ${activeMap === 'Roads' ? 'active' : ''}`}
                  onClick={() => { setActiveMap('Roads'); window.changeMapLayer?.('Roads'); setIsMapMenuOpen(false); }}
                >Roads</button>
                <button 
                  className={`map-option ${activeMap === 'OpenStreetMap' ? 'active' : ''}`}
                  onClick={() => { setActiveMap('OpenStreetMap'); window.changeMapLayer?.('OpenStreetMap'); setIsMapMenuOpen(false); }}
                >OpenStreetMap</button>
                
                <button 
                  className={`map-option ${activeMap === 'Natural Earth II' ? 'active' : ''}`}
                  onClick={() => { setActiveMap('Natural Earth II'); window.changeMapLayer?.('Natural Earth II'); setIsMapMenuOpen(false); }}
                >Natural Earth II</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* TOP RIGHT: Profile */}
      <div className="top-right-panel" ref={accountMenuRef}>
        <button 
          className={`profile-btn ${isAccountMenuOpen ? 'active' : ''}`}
          data-tooltip="Account"
          onClick={() => setIsAccountMenuOpen(!isAccountMenuOpen)}
        >
          <User size={14} />
        </button>

        {isAccountMenuOpen && (
          <div className="account-dropdown">
            <div className="account-header">Account</div>
            <div className="account-body">
              <button className="login-btn">Login</button>
            </div>
          </div>
        )}
      </div>

      {/* LEFT SECTION (Collapsible Sidebar + Inner Panel) */}
      <div className={`left-section ${!isSidebarOpen ? 'collapsed' : ''}`}>
        
        {/* INNER PANEL: Object Browser */}
        {isSidebarOpen && activeSidebar === 'Objects' && (
          <div className="inner-panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Object Browser</h2>
                <p className="panel-subtitle">Browse items, edit their configuration, or add new ones.</p>
              </div>
              <button className="close-btn" onClick={() => setActiveSidebar(null)}>
                <X size={14} />
              </button>
            </div>

            <div className="panel-tabs primary-tabs">
              <button className="tab">Search</button>
              <button className="tab active">Featured</button>
              <button className="tab">Owned</button>
              <button className="tab">Viewer</button>
            </div>

            <div className="panel-tabs secondary-tabs">
              <button className="tab active">All</button>
              <button className="tab">Satellites</button>
              <button className="tab">Stations</button>
              <button className="tab">Groups</button>
            </div>

            <div className="search-bar">
              <div className="search-input-wrapper">
                <Search size={12} className="search-icon" />
                <input type="text" placeholder="Search..." />
              </div>
              <button className="icon-btn"><List size={12} /></button>
              <button className="icon-btn"><RefreshCw size={12} /></button>
              <button className="icon-btn"><Plus size={12} /></button>
            </div>

            <div className="select-all">
              <input type="checkbox" id="selectAll" />
              <label htmlFor="selectAll">Select all</label>
            </div>

            <div className="items-list">
              <div className="item-card">
                <div className="item-header">
                  <div className="item-title-group">
                    <input type="checkbox" />
                    <Satellite size={12} className="item-icon" />
                    <span className="item-name">ISS</span>
                  </div>
                  <span className="item-badge">Featured</span>
                </div>
                <div className="item-desc">International Space Station (ISS)</div>
                <div className="item-meta">Updated 4/2/2026, 7:36:02 PM</div>
                <button className="item-action-btn"><Plus size={12} /></button>
              </div>

              <div className="item-card">
                <div className="item-header">
                  <div className="item-title-group">
                    <input type="checkbox" />
                    <Satellite size={12} className="item-icon" />
                    <span className="item-name">Artemis-II</span>
                  </div>
                  <span className="item-badge">Featured</span>
                </div>
                <div className="item-desc">Artemis II Orbital Trajectory</div>
                <div className="item-meta">Updated 4/3/2026, 6:59:01 AM</div>
                <button className="item-action-btn"><Plus size={12} /></button>
              </div>
            </div>
          </div>
        )}

        {/* INNER PANEL: Layers */}
        {isSidebarOpen && activeSidebar === 'Layers' && (
          <div className="inner-panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Layer Settings</h2>
                <p className="panel-subtitle">Configure visual rendering and terrain</p>
              </div>
              <button className="close-btn" onClick={() => setActiveSidebar(null)}><X size={14} /></button>
            </div>
            <div className="panel-content custom-scrollbar">

              {/* Bathymetry Card */}
              <div className={`item-card ${!bathyEnabled ? 'item-card-dim' : 'active-var-card'}`}>
                <div className="item-header" style={{ marginBottom: bathyEnabled ? '12px' : 0, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => {
                    const next = !bathyEnabled;
                    setBathyEnabled(next);
                    if (next) setActiveLayers({});
                  }}
                >
                  <div className="item-title-group">
                    <Mountain size={13} className="item-icon" style={bathyEnabled ? { color: '#3b82f6' } : {}} />
                    <span className="item-name" style={bathyEnabled ? { color: '#3b82f6' } : {}}>Bathymetry</span>
                  </div>
                  <label className="toggle-switch" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={bathyEnabled} onChange={e => {
                      const next = e.target.checked;
                      setBathyEnabled(next);
                      if (next) setActiveLayers({});
                    }} />
                    <span className="toggle-track" />
                  </label>
                </div>
                {bathyEnabled && (
                  <div className="layer-card-body">
                    <div className="var-settings-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
                      <span style={{ width: '80px', fontSize: '11px', fontWeight: 600 }}>Exaggeration</span>
                      <input type="range" min="10" max="200" step="1"
                        style={{ flex: 1, background: getSliderBg(vertExagg, 10, 200) }}
                        value={vertExagg}
                        onChange={e => setVertExagg(parseInt(e.target.value))} />
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', width: '36px', fontSize: '11px', fontWeight: 600 }}>
                        <span 
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={e => {
                            const val = parseInt(e.target.innerText);
                            if (!isNaN(val)) {
                              const clamped = Math.max(10, Math.min(200, val));
                              setVertExagg(clamped);
                              e.target.innerText = clamped;
                            } else {
                              e.target.innerText = Math.round(vertExagg);
                            }
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              e.target.blur();
                            }
                          }}
                          style={{ outline: 'none', cursor: 'text', borderBottom: '1px dashed rgba(6,66,116,0.3)', minWidth: '16px', textAlign: 'right' }}
                        >
                          {Math.round(vertExagg)}
                        </span>
                        <span>x</span>
                      </div>
                    </div>
                    <div className="var-settings-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ width: '80px', fontSize: '11px', fontWeight: 600 }}>Opacity</span>
                      <input type="range" min="0" max="100"
                        style={{ flex: 1, background: getSliderBg(bathyOpacity, 0, 100) }}
                        value={bathyOpacity}
                        onChange={e => setBathyOpacity(parseInt(e.target.value))} />
                      <span style={{ width: '36px', textAlign: 'right', fontSize: '11px', fontWeight: 600 }}>{bathyOpacity}%</span>
                    </div>

                  </div>
                )}
              </div>

              {[ 
                { name: 'Sea Surface Height', icon: Waves, gradient: 'linear-gradient(to right, #053061, #4393c3, #f7f7f7, #d6604d, #67001f)',min: '-1', mid: '0',  max: '1 m'  },
                { name: 'Sea Surface Temperature', icon: Thermometer, gradient: 'linear-gradient(to right, #1a1a3a, #5b326d, #c5535c, #f6a157, #fdf870)', min: '-2', mid: '14', max: '30 °C' },
                { name: 'Surface Currents', icon: Wind, gradient: 'linear-gradient(to right, #0d0221, #0a4bc7, #17b0d4, #e8f7fd)', min: '0', mid: '1.2', max: '2.5 m/s' },
              ].map(v => {
                const isActive = activeLayers[v.name] || false;
                const vn = v.name;
                const curSettingsOpen = showVarSettings[vn] ?? true;
                const curOpacity = opacity[vn] ?? 100;
                const curColorMapIdx = colorMapIdx[vn] ?? 0;
                const curInverted = varInverted[vn] ?? false;
                const curStepwise = varStepwise[vn] ?? false;
                const curSteps = varSteps[vn] ?? 5;
                const curMasked = varMasked[vn] ?? false;
                const curMin = varMin[vn] ?? v.min;
                const curMax = varMax[vn] ?? v.max.split(' ')[0];
                const curCC1 = customColor1_ocean[vn] ?? '#3b82f6';
                const curCC2 = customColor2_ocean[vn] ?? '#10b981';

                return (
                  <div key={vn} className={`item-card ${isActive ? 'active-var-card' : 'item-card-dim'}`}>
                    <div className="item-header"
                      onClick={() => {
                        setActiveLayers(prev => prev[vn] ? {} : { [vn]: true });
                        if (!isActive) {
                          setBathyEnabled(false);
                          setActiveOceanVar(null);
                        }
                      }}
                      style={{ marginBottom: isActive ? '12px' : 0, cursor: 'pointer', userSelect: 'none' }}
                    >
                      <div className="item-title-group">
                        <v.icon size={13} className="item-icon" style={isActive ? { color: '#3b82f6' } : {}} />
                        <span className="item-name" style={isActive ? { color: '#3b82f6' } : {}}>{vn}</span>
                      </div>
                      <label className="toggle-switch" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={isActive}
                          onChange={() => {
                            setActiveLayers(prev => prev[vn] ? {} : { [vn]: true });
                            if (!isActive) {
                              setBathyEnabled(false);
                              setActiveOceanVar(null);
                            }
                          }} />
                        <span className="toggle-track" />
                      </label>
                    </div>
                    {isActive && (
                      <div className="layer-card-body">
                        <div className="var-settings-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
                          <span style={{ width: '80px', fontSize: '11px', fontWeight: 600 }}>Opacity</span>
                          <input type="range" min="0" max="100"
                            style={{ flex: 1, background: getSliderBg(curOpacity, 0, 100) }}
                            value={curOpacity}
                            onChange={e => {const val = parseInt(e.target.value); setOpacity(prev => ({...prev, [vn]: val}));}} />
                          <span style={{ width: '36px', textAlign: 'right', fontSize: '11px', fontWeight: 600 }}>{curOpacity}%</span>
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px' }}>
                            <div className="gradient-bar" style={{ 
                              flex: 1,
                              background: getProcessedGradient(curColorMapIdx, curInverted, curStepwise, curSteps, customColor1, customColor2, curMasked, varMaskOutline[vn]),
                              marginTop: 0
                            }} />
                            <button className="icon-btn-flat"
                              style={{ flexShrink: 0, padding: 0, display: 'flex', alignItems: 'center' }}
                              onClick={() => setShowVarSettings(prev => ({...prev, [vn]: !(prev[vn] ?? true)}))}>
                              <Settings2 size={16} color={curSettingsOpen ? '#3b82f6' : '#064274'} />
                            </button>
                          </div>
                          <div className="gradient-labels" style={{ paddingRight: '28px' }}>
                            {(() => {
                              const unit = (v.max.match(/[^0-9.-]+$/) || [''])[0].trim();
                              const [dMin, dMid, dMax] = getDisplayLimits(curMin, curMax, curMasked, unit);
                              return <><span style={{ position: 'relative', left: curMasked ? '1.5%' : 0 }}>{dMin}</span><span>{dMid}</span><span style={{ position: 'relative', right: curMasked ? '1.5%' : 0 }}>{dMax}</span></>;
                            })()}
                          </div>
                        </div>
                        {curSettingsOpen && (
                          <div className="var-settings">

                            <div className="var-settings-row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                              <span>Colour map</span>
                              <div style={{ display: 'flex', gap: '12px' }}>
                                <button className="icon-btn-flat" title="Invert color map" onClick={e=>{e.stopPropagation(); setVarInverted(prev => ({...prev, [vn]: !(prev[vn] ?? false)}));}}>
                                  <ArrowRightLeft size={15} color={curInverted ? '#3b82f6' : '#333'} />
                                </button>
                                <button className="icon-btn-flat" title="Stepwise color map" onClick={e=>{e.stopPropagation(); setVarStepwise(prev => ({...prev, [vn]: !(prev[vn] ?? false)}));}}>
                                  <BarChart2 size={15} color={curStepwise ? '#3b82f6' : '#333'} />
                                </button>
                                <button className="icon-btn-flat" title="Mask edges" onClick={e=>{e.stopPropagation(); setVarMasked(prev => ({...prev, [vn]: !(prev[vn] ?? false)}));}}>
                                  <MoveHorizontal size={15} color={curMasked ? '#3b82f6' : '#333'} />
                                </button>
                              </div>
                            </div>
                            <div className="color-swatch-grid" onClick={e=>e.stopPropagation()}>
                              {baseColorMaps.slice(0, 10).map((cm, i) => (
                                <div key={i}
                                  className={`color-swatch ${curColorMapIdx === i ? 'active' : ''}`}
                                  style={{ background: getProcessedGradient(i, false, false, 5, customColor1, customColor2, false, 0) }}
                                  onClick={() => setColorMapIdx(prev => ({...prev, [vn]: i}))}
                                  title={cm.label}
                                />
                              ))}
                            </div>

                            <div className="custom-color-row" onClick={e=>e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: '12px', fontWeight: 600, color: '#064274' }}>Steps</span>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <input type="color" value={curCC1} onChange={e => {const val = e.target.value; setCustomColor1_ocean(prev => ({...prev, [vn]: val})); setColorMapIdx(prev => ({...prev, [vn]: 24}));}} style={{ width: '24px', height: '16px', padding: 0, border: 'none' }} />
                                <input type="color" value={curCC2} onChange={e => {const val = e.target.value; setCustomColor2_ocean(prev => ({...prev, [vn]: val})); setColorMapIdx(prev => ({...prev, [vn]: 24}));}} style={{ width: '24px', height: '16px', padding: 0, border: 'none' }} />
                              </div>
                            </div>

                            {curStepwise && (
                              <div className="thresholds-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} onClick={e=>e.stopPropagation()}>
                                <span style={{ fontSize: '12px', fontWeight: 600, color: '#064274' }}>Thresholds:</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <button className="icon-btn-flat" style={{ fontSize: '16px', fontWeight: 'bold' }} onClick={() => setVarSteps(prev => ({...prev, [vn]: Math.max(2, (prev[vn] ?? 5) - 1)}))}>−</button>
                                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#064274', width: '20px', textAlign: 'center' }}>{curSteps}</span>
                                  <button className="icon-btn-flat" style={{ fontSize: '16px', fontWeight: 'bold' }} onClick={() => setVarSteps(prev => ({...prev, [vn]: Math.min(20, (prev[vn] ?? 5) + 1)}))}>+</button>
                                </div>
                              </div>
                            )}
                            
                            {curMasked && (
                              <div className="thresholds-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} onClick={e=>e.stopPropagation()}>
                                <span style={{ fontSize: '12px', fontWeight: 600, color: '#064274' }}>Mask outliner:</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <input type="number" min="0" max="100" step="0.1"
                                    value={varMaskOutline[vn] ?? 1.5}
                                    onChange={e => setVarMaskOutline(prev => ({...prev, [vn]: parseFloat(e.target.value)}))}
                                    className="polaris-num-input"
                                    style={{ width: '50px', background: '#f3f4f6', border: 'none', borderRadius: '4px', padding: '2px 4px', fontSize: '11px', textAlign: 'center' }}
                                  />
                                  <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 600 }}>%</span>
                                </div>
                              </div>
                            )}

                            <div className="var-limits-row" onClick={e=>e.stopPropagation()}>
                              <div className="limit-input">
                                <span>Min:</span>
                                <input type="text" value={curMin ?? ''} onChange={e => {const val = e.target.value; setVarMin(prev => ({...prev, [vn]: val}));}} />
                              </div>
                              <div className="limit-input">
                                <span>Max:</span>
                                <input type="text" value={curMax ?? ''} onChange={e => {const val = e.target.value; setVarMax(prev => ({...prev, [vn]: val}));}} />
                              </div>
                              <button className="auto-btn" onClick={() => { setVarMin(prev => ({...prev, [vn]: v.min})); setVarMax(prev => ({...prev, [vn]: v.max.split(' ')[0]})); }}>Auto</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}


            </div>
          </div>
        )}


        {/* INNER PANEL: Ocean Variables */}
        {/* INNER PANEL: Ocean Variables (Persisted via CSS display to keep scroll position) */}
        <div className="inner-panel" style={{ display: isSidebarOpen && activeSidebar === 'Ocean' ? 'flex' : 'none' }}>
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Ocean Variables</h2>
                <p className="panel-subtitle">One layer active at a time</p>
              </div>
              <button className="close-btn" onClick={() => setActiveSidebar(null)}><X size={14} /></button>
            </div>
            
            <div style={{ padding: '8px 16px 0px 16px', borderBottom: '1px solid #e2e8f0', marginBottom: '8px', paddingBottom: '16px' }}>
              <div className="var-settings-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ width: '80px', fontSize: '11px', fontWeight: 600, color: '#064274' }}>Depth Slice</span>
                <input type="range" min="-6000" max="0" step="10"
                  style={{ flex: 1, background: getSliderBg(oceanDepth + 6000, 0, 6000) }}
                  value={oceanDepth}
                  onChange={e => {
                    const depth = parseInt(e.target.value);
                    setOceanDepth(depth);
                    if (window.updateOceanDepth) window.updateOceanDepth(depth);
                  }} />
                <span style={{ width: '48px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: '#064274' }}>{oceanDepth}m</span>
              </div>
              <div className="var-settings-row" style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ width: '80px', fontSize: '11px', fontWeight: 600, color: '#064274' }}>Translucency</span>
                <input type="range" min="1" max="100" step="1"
                  style={{ flex: 1, background: getSliderBg(oceanDensity, 1, 100) }}
                  value={oceanDensity}
                  onChange={e => {
                    const density = parseInt(e.target.value);
                    setOceanDensity(density);
                    if (window.updateOceanDensity) window.updateOceanDensity(density);
                  }} />
                <span style={{ width: '48px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: '#064274' }}>{oceanDensity}%</span>
              </div>
            </div>

            <div className="panel-content custom-scrollbar" style={{ paddingTop: '4px' }}>
              {oceanVars.map(v => {
                const isActive = activeOceanVar === v.name;
                const vn = v.name;
                const curSettingsOpen = showVarSettings[vn] ?? true;
                const curOpacity = opacity[vn] ?? 100;
                const curColorMapIdx = colorMapIdx[vn] ?? 0;
                const curInverted = varInverted[vn] ?? false;
                const curStepwise = varStepwise[vn] ?? false;
                const curSteps = varSteps[vn] ?? 5;
                const curMasked = varMasked[vn] ?? false;
                const curClipMin = varClipMin[vn] ?? 0;
                const curClipMax = varClipMax[vn] ?? 100;
                const curMin = varMin[vn] ?? v.min;
                const curMax = varMax[vn] ?? v.max.split(' ')[0];
                const curCC1 = customColor1_ocean[vn] ?? '#3b82f6';
                const curCC2 = customColor2_ocean[vn] ?? '#10b981';

                return (
                  <div key={vn} className={`item-card ${isActive ? 'active-var-card' : ''}`}>
                    <div className="item-header"
                      onClick={() => {
                        setActiveOceanVar(isActive ? null : vn);
                        if (!isActive) {
                          setActiveLayers({});
                          setBathyEnabled(true);
                        }
                      }}
                      style={{ marginBottom: isActive ? '12px' : 0, cursor: 'pointer', userSelect: 'none' }}
                    >
                      <div className="item-title-group">
                        <v.icon size={13} className="item-icon" style={isActive ? { color: '#3b82f6' } : {}} />
                        <span className="item-name" style={isActive ? { color: '#3b82f6' } : {}}>{vn}</span>
                      </div>
                      <label className="toggle-switch" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={isActive}
                          onChange={() => {
                            setActiveOceanVar(isActive ? null : vn);
                            if (!isActive) {
                              setActiveLayers({});
                              setBathyEnabled(true);
                            }
                          }} />
                        <span className="toggle-track" />
                      </label>
                    </div>
                    {isActive && (
                      <div className="layer-card-body">
                        <div className="var-settings-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
                          <span style={{ width: '80px', fontSize: '11px', fontWeight: 600 }}>Opacity</span>
                          <input type="range" min="0" max="100"
                            style={{ flex: 1, background: getSliderBg(curOpacity, 0, 100) }}
                            value={curOpacity}
                            onChange={e => {const val = parseInt(e.target.value); setOpacity(prev => ({...prev, [vn]: val}));}} />
                          <span style={{ width: '36px', textAlign: 'right', fontSize: '11px', fontWeight: 600 }}>{curOpacity}%</span>
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ flex: 1 }}>
                              <div className="custom-dual-slider-wrapper" style={{ position: 'relative', height: '24px', marginTop: '12px', marginBottom: '-4px' }}>
                                {/* Tooltips */}
                                {curClipMax - curClipMin < 18 ? (
                                  <div style={{ position: 'absolute', left: `calc(${(curClipMin + curClipMax) / 2}% + ${5 - ((curClipMin + curClipMax) / 2) * 0.1}px)`, bottom: '100%', transform: 'translateX(-50%)', background: 'white', padding: '1px 3px', borderRadius: '3px', fontSize: '8.5px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', marginBottom: '-2px', whiteSpace: 'nowrap', zIndex: 11 }}>
                                    {(parseFloat(curMin) + (curClipMin / 100) * (parseFloat(curMax) - parseFloat(curMin))).toFixed(1)} - {(parseFloat(curMin) + (curClipMax / 100) * (parseFloat(curMax) - parseFloat(curMin))).toFixed(1)} {v.max.match(/[^0-9.-]+$/)?.[0]?.trim() || ''}
                                  </div>
                                ) : (
                                  <>
                                    {/* Tooltip MIN */}
                                    <div style={{ position: 'absolute', left: `calc(${curClipMin}% + ${5 - curClipMin * 0.1}px)`, bottom: '100%', transform: 'translateX(-50%)', background: 'white', padding: '3px 6px', borderRadius: '4px', fontSize: '8.5px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', marginBottom: '-2px', whiteSpace: 'nowrap', width: 'max-content', zIndex: 11 }}>
                                      {(parseFloat(curMin) + (curClipMin / 100) * (parseFloat(curMax) - parseFloat(curMin))).toFixed(1)} {v.max.match(/[^0-9.-]+$/)?.[0]?.trim() || ''}
                                    </div>
                                    {/* Tooltip MAX */}
                                    <div style={{ position: 'absolute', left: `calc(${curClipMax}% + ${5 - curClipMax * 0.1}px)`, bottom: '100%', transform: 'translateX(-50%)', background: 'white', padding: '3px 6px', borderRadius: '4px', fontSize: '8.5px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', marginBottom: '-2px', whiteSpace: 'nowrap', width: 'max-content', zIndex: 10 }}>
                                      {(parseFloat(curMin) + (curClipMax / 100) * (parseFloat(curMax) - parseFloat(curMin))).toFixed(1)} {v.max.match(/[^0-9.-]+$/)?.[0]?.trim() || ''}
                                    </div>
                                  </>
                                )}
                                {/* Inactive Track Base */}
                                <div style={{ position: 'absolute', top: '10px', left: 0, right: 0, height: '4px', background: '#e2e2e2', borderRadius: '4px', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.1)' }}></div>
                                {/* Active Track Gradient (Full width, clipped to slider thumbs to prevent squishing) */}
                                <div style={{ 
                                  position: 'absolute', 
                                  top: '10px', 
                                  left: 0, 
                                  right: 0, 
                                  height: '4px', 
                                  background: getProcessedGradient(curColorMapIdx, curInverted, curStepwise, curSteps, curCC1, curCC2, curMasked, varMaskOutline[vn]), 
                                  borderRadius: '4px',
                                  clipPath: `inset(0 calc(100% - (${curClipMax}% + ${5 - curClipMax * 0.1}px)) 0 calc(${curClipMin}% + ${5 - curClipMin * 0.1}px))`
                                }}></div>
                                {/* Input MIN */}
                                <input type="range" min="0" max="100" value={curClipMin}
                                  onChange={e => setVarClipMin(prev => ({...prev, [vn]: Math.min(parseInt(e.target.value), curClipMax - 1)}))}
                                  className="dual-slider"
                                />
                                {/* Input MAX */}
                                <input type="range" min="0" max="100" value={curClipMax}
                                  onChange={e => setVarClipMax(prev => ({...prev, [vn]: Math.max(parseInt(e.target.value), curClipMin + 1)}))}
                                  className="dual-slider"
                                />
                              </div>
                              <div className="gradient-bar" style={{ 
                                background: getProcessedGradient(curColorMapIdx, curInverted, curStepwise, curSteps, curCC1, curCC2, curMasked, varMaskOutline[vn]),
                                marginTop: 0
                              }} />
                              <div className="gradient-labels" style={{ paddingRight: '28px', marginTop: '4px', marginBottom: '8px' }}>
                                {(() => {
                                  const unit = (v.max.match(/[^0-9.-]+$/) || [''])[0].trim();
                                  const [dMin, dMid, dMax] = getDisplayLimits(curMin, curMax, curMasked, unit);
                                  return <><span style={{ position: 'relative', left: curMasked ? '1.5%' : 0 }}>{dMin}</span><span>{dMid}</span><span style={{ position: 'relative', right: curMasked ? '1.5%' : 0 }}>{dMax}</span></>;
                                })()}
                              </div>
                            </div>
                            <button className="icon-btn-flat"
                              style={{ flexShrink: 0, padding: 0, display: 'flex', alignItems: 'center' }}
                              onClick={() => setShowVarSettings(prev => ({...prev, [vn]: !(prev[vn] ?? true)}))}>
                              <Settings2 size={16} color={curSettingsOpen ? '#3b82f6' : '#064274'} />
                            </button>
                          </div>
                        </div>
                        {curSettingsOpen && (
                          <div className="var-settings">

                            <div className="var-settings-row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                              <span>Colour map</span>
                              <div style={{ display: 'flex', gap: '12px' }}>
                                <button className="icon-btn-flat" title="Invert color map" onClick={e=>{e.stopPropagation(); setVarInverted(prev => ({...prev, [vn]: !(prev[vn] ?? false)}));}}>
                                  <ArrowRightLeft size={15} color={curInverted ? '#3b82f6' : '#333'} />
                                </button>
                                <button className="icon-btn-flat" title="Stepwise color map" onClick={e=>{e.stopPropagation(); setVarStepwise(prev => ({...prev, [vn]: !(prev[vn] ?? false)}));}}>
                                  <BarChart2 size={15} color={curStepwise ? '#3b82f6' : '#333'} />
                                </button>
                                <button className="icon-btn-flat" title="Mask edges" onClick={e=>{e.stopPropagation(); setVarMasked(prev => ({...prev, [vn]: !(prev[vn] ?? false)}));}}>
                                  <MoveHorizontal size={15} color={curMasked ? '#3b82f6' : '#333'} />
                                </button>
                              </div>
                            </div>
                            <div className="color-swatch-grid" onClick={e=>e.stopPropagation()}>
                              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
                                <div key={i}
                                  className={`color-swatch ${curColorMapIdx === i ? 'active' : ''}`}
                                  style={{ background: getProcessedGradient(i, false, false, 5, curCC1, curCC2, false, 0) }}
                                  onClick={() => setColorMapIdx(prev => ({...prev, [vn]: i}))}
                                  title={baseColorMaps[i].label}
                                />
                              ))}
                            </div>

                            <div className="custom-color-row" onClick={e=>e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: '12px', fontWeight: 600, color: '#064274' }}>Steps</span>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <input type="color" value={curCC1} onChange={e => {const val = e.target.value; setCustomColor1_ocean(prev => ({...prev, [vn]: val})); setColorMapIdx(prev => ({...prev, [vn]: 9}));}} style={{ width: '24px', height: '16px', padding: 0, border: 'none' }} />
                                <input type="color" value={curCC2} onChange={e => {const val = e.target.value; setCustomColor2_ocean(prev => ({...prev, [vn]: val})); setColorMapIdx(prev => ({...prev, [vn]: 9}));}} style={{ width: '24px', height: '16px', padding: 0, border: 'none' }} />
                              </div>
                            </div>

                            {curStepwise && (
                              <div className="thresholds-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} onClick={e=>e.stopPropagation()}>
                                <span style={{ fontSize: '12px', fontWeight: 600, color: '#064274' }}>Thresholds:</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <button className="icon-btn-flat" style={{ fontSize: '16px', fontWeight: 'bold' }} onClick={() => setVarSteps(prev => ({...prev, [vn]: Math.max(2, (prev[vn] ?? 5) - 1)}))}>−</button>
                                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#064274', width: '20px', textAlign: 'center' }}>{curSteps}</span>
                                  <button className="icon-btn-flat" style={{ fontSize: '16px', fontWeight: 'bold' }} onClick={() => setVarSteps(prev => ({...prev, [vn]: Math.min(20, (prev[vn] ?? 5) + 1)}))}>+</button>
                                </div>
                              </div>
                            )}
                            
                            {curMasked && (
                              <div className="thresholds-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} onClick={e=>e.stopPropagation()}>
                                <span style={{ fontSize: '12px', fontWeight: 600, color: '#064274' }}>Mask outliner:</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <input type="number" min="0" max="100" step="0.1"
                                    value={varMaskOutline[vn] ?? 1.5}
                                    onChange={e => setVarMaskOutline(prev => ({...prev, [vn]: parseFloat(e.target.value)}))}
                                    className="polaris-num-input"
                                    style={{ width: '50px', background: '#f3f4f6', border: 'none', borderRadius: '4px', padding: '2px 4px', fontSize: '11px', textAlign: 'center' }}
                                  />
                                  <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 600 }}>%</span>
                                </div>
                              </div>
                            )}

                            <div className="var-limits-row" onClick={e=>e.stopPropagation()}>
                              <div className="limit-input">
                                <span>Min:</span>
                                <input type="text" value={curMin ?? ''} onChange={e => {const val = e.target.value; setVarMin(prev => ({...prev, [vn]: val}));}} />
                              </div>
                              <div className="limit-input">
                                <span>Max:</span>
                                <input type="text" value={curMax ?? ''} onChange={e => {const val = e.target.value; setVarMax(prev => ({...prev, [vn]: val}));}} />
                              </div>
                              <button className="auto-btn" onClick={() => { setVarMin(prev => ({...prev, [vn]: v.min})); setVarMax(prev => ({...prev, [vn]: v.max.split(' ')[0]})); }}>Auto</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

                {/* INNER PANEL: Disasters */}
        {isSidebarOpen && activeSidebar === 'Disasters' && (
          <div className="inner-panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Disaster Overlays</h2>
                <p className="panel-subtitle">Toggle active and historical events</p>
              </div>
              <button className="close-btn" onClick={() => setActiveSidebar(null)}><X size={14} /></button>
            </div>
            <div className="panel-content custom-scrollbar">
              {[
                { name: 'Cyclones',          icon: AlertTriangle, color: '#ef4444' },
                { name: 'Oil Spillage',      icon: Droplet,       color: '#10b981' },
              ].map(item => (
                <div className={`item-card ${disasters[item.name] ? '' : 'item-card-dim'}`} key={item.name}>
                  <div className="item-header" style={{ marginBottom: 0, cursor: 'pointer', userSelect: 'none' }} onClick={() => setDisasters(prev => ({ ...prev, [item.name]: !prev[item.name] }))}>
                    <div className="item-title-group">
                      <item.icon size={13} color={disasters[item.name] ? item.color : '#94a3b8'} className="item-icon" />
                      <span className="item-name" style={disasters[item.name] ? {} : { color: '#94a3b8' }}>{item.name}</span>
                    </div>
                    <label className="toggle-switch" onClick={e => e.stopPropagation()}>
                      <input type="checkbox"
                        checked={disasters[item.name]}
                        onChange={e => setDisasters(prev => ({ ...prev, [item.name]: e.target.checked }))}
                      />
                      <span className="toggle-track" />
                    </label>
                  </div>
                </div>
              ))}
              
              {/* Marine Heatwaves (formerly Temperature Anomaly) */}
              <div className={`item-card ${anomalyVars['Temperature'] ? 'active-var-card' : 'item-card-dim'}`}>
                  <div className="item-header" style={{ marginBottom: anomalyVars['Temperature'] ? '12px' : 0, cursor: 'pointer', userSelect: 'none' }} 
                       onClick={() => {
                         const n = !anomalyVars['Temperature'];
                         setAnomalyVars(prev => ({ ...prev, ['Temperature']: n }));
                         if (window.set2DLayer) {
                           window.set2DLayer('Temperature Anomaly', n, { 
                             years: anomalyYears,
                             vmin: varMin[`Temperature Anomaly`] ?? -5,
                             vmax: varMax[`Temperature Anomaly`] ?? 5
                           });
                         }
                       }}>
                    <div className="item-title-group">
                      <Thermometer size={13} color={anomalyVars['Temperature'] ? '#ef4444' : '#94a3b8'} className="item-icon" />
                      <span className="item-name" style={anomalyVars['Temperature'] ? { color: '#064274', fontWeight: 600 } : { color: '#94a3b8' }}>Marine Heatwaves</span>
                    </div>
                    <label className="toggle-switch" onClick={e => e.stopPropagation()}>
                      <input type="checkbox"
                        checked={anomalyVars['Temperature']}
                        onChange={e => {
                          const n = e.target.checked;
                          setAnomalyVars(prev => ({ ...prev, ['Temperature']: n }));
                          if (window.set2DLayer) {
                            window.set2DLayer('Temperature Anomaly', n, { 
                              years: anomalyYears,
                              vmin: varMin[`Temperature Anomaly`] ?? -5,
                              vmax: varMax[`Temperature Anomaly`] ?? 5
                            });
                          }
                        }}
                      />
                      <span className="toggle-track" />
                    </label>
                  </div>
                  
                  {anomalyVars['Temperature'] && (
                    <div className="layer-card-body" style={{ padding: '0 12px 12px 12px' }}>
                        <div className="var-settings-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
                          <span style={{ width: '80px', fontSize: '11px', fontWeight: 600, color: '#064274' }}>Baseline</span>
                          <input type="range" min="1" max="10" step="1"
                            style={{ flex: 1, background: getSliderBg(anomalyYears, 1, 10) }}
                            value={anomalyYears}
                            onChange={e => {
                              const val = parseInt(e.target.value);
                              setAnomalyYears(val);
                              if (window.set2DLayer) {
                                window.set2DLayer('Temperature Anomaly', true, { 
                                  years: val,
                                  vmin: varMin[`Temperature Anomaly`] ?? -5,
                                  vmax: varMax[`Temperature Anomaly`] ?? 5
                                });
                              }
                            }} />
                          <span style={{ width: '45px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: '#064274' }}>{anomalyYears} yrs</span>
                        </div>
                        
                      <div className="var-settings-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
                        <span style={{ width: '80px', fontSize: '11px', fontWeight: 600, color: '#064274' }}>Opacity</span>
                        <input type="range" min="0" max="100"
                          style={{ flex: 1, background: getSliderBg(opacity[`Temperature Anomaly`] ?? 100, 0, 100) }}
                          value={opacity[`Temperature Anomaly`] ?? 100}
                          onChange={e => {
                            const val = parseInt(e.target.value);
                            setOpacity(prev => ({ ...prev, [`Temperature Anomaly`]: val }));
                            if (window.active2DLayers && window.active2DLayers[`Temperature Anomaly`]) {
                              window.active2DLayers[`Temperature Anomaly`].alpha = val / 100.0;
                              if (window.cesiumViewer) window.cesiumViewer.scene.requestRender();
                            }
                          }} />
                        <span style={{ width: '36px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: '#064274' }}>{opacity[`Temperature Anomaly`] ?? 100}%</span>
                      </div>
                      
                      <div className="gradient-bar" style={{ 
                        background: 'linear-gradient(to right, #053061, #2166ac, #4393c3, #92c5de, #d1e5f0, #ffffff, #fddbc7, #f4a582, #d6604d, #b2182b, #67001f)',
                        marginTop: '12px'
                      }} />
                      <div className="gradient-labels" style={{ marginTop: '4px', marginBottom: '8px' }}>
                        <span>{varMin[`Temperature Anomaly`] ?? -5}°C</span>
                        <span>0°C</span>
                        <span>{varMax[`Temperature Anomaly`] ?? 5}°C</span>
                      </div>
                      
                      <div className="var-limits-row" onClick={e=>e.stopPropagation()}>
                        <div className="limit-input">
                          <span>Min:</span>
                          <input type="text" value={varMin[`Temperature Anomaly`] ?? -5} 
                            onChange={e => {
                              const val = parseFloat(e.target.value) || 0;
                              setVarMin(prev => ({ ...prev, [`Temperature Anomaly`]: val }));
                              if (window.set2DLayer) window.set2DLayer('Temperature Anomaly', true, { years: anomalyYears, vmin: val, vmax: varMax[`Temperature Anomaly`] ?? 5 });
                            }} 
                          />
                        </div>
                        <div className="limit-input">
                          <span>Max:</span>
                          <input type="text" value={varMax[`Temperature Anomaly`] ?? 5} 
                            onChange={e => {
                              const val = parseFloat(e.target.value) || 0;
                              setVarMax(prev => ({ ...prev, [`Temperature Anomaly`]: val }));
                              if (window.set2DLayer) window.set2DLayer('Temperature Anomaly', true, { years: anomalyYears, vmin: varMin[`Temperature Anomaly`] ?? -5, vmax: val });
                            }} 
                          />
                        </div>
                        <button className="auto-btn" onClick={() => { 
                          setVarMin(prev => ({...prev, [`Temperature Anomaly`]: -5})); 
                          setVarMax(prev => ({...prev, [`Temperature Anomaly`]: 5})); 
                          if (window.set2DLayer) window.set2DLayer('Temperature Anomaly', true, { years: anomalyYears, vmin: -5, vmax: 5 });
                        }}>Auto</button>
                      </div>
                    </div>
                  )}
              </div>
            </div>
          </div>
        )}
        {/* INNER PANEL: Sensors */}
        {isSidebarOpen && activeSidebar === 'Sensors' && (
          <div className="inner-panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Ocean Instruments</h2>
                <p className="panel-subtitle">Manage hardware telemetry feeds</p>
              </div>
              <button className="close-btn" onClick={() => setActiveSidebar(null)}><X size={14} /></button>
            </div>
            <div className="panel-content custom-scrollbar">
              {[
                { name: 'Argo float',          color: '#00FFFF', type: 'cylinder' },
                { name: 'Thermosalinometer',   color: '#FFA500', type: 'teardrop' },
                { name: 'Mooring',             color: '#32CD32', type: 'buoy' },
                { name: 'Glider',              color: '#FF00FF', type: 'cylinder' },
                { name: 'CTD',                 color: '#FFFF00', type: 'teardrop' },
                { name: 'Drifter - SVP',       color: '#FF0000', type: 'teardrop' },
                { name: 'Drifter - SVPB',      color: '#FF0000', type: 'teardrop' },
                { name: 'Drifter - SVPBV',     color: '#FF0000', type: 'teardrop' },
              ].map(inst => {
                const isActive = instruments[inst.name];
                const fillCol = isActive ? inst.color : '#475569';
                const strokeCol = isActive ? '#000' : '#1e293b';
                
                const renderIcon = () => {
                  if (inst.type === 'cylinder') {
                    return (
                      <svg width="14" height="20" viewBox="0 0 24 40" style={{ marginRight: 8 }}>
                         <rect x="6" y="10" width="12" height="20" rx="6" fill={fillCol} stroke={strokeCol} strokeWidth="2"/>
                         <rect x="10" y="2" width="4" height="8" fill="gray" stroke={strokeCol} strokeWidth="1"/>
                      </svg>
                    );
                  }
                  if (inst.type === 'buoy') {
                    return (
                      <svg width="16" height="16" viewBox="0 0 30 30" style={{ marginRight: 8 }}>
                         <path d="M5,15 L25,15 L15,25 Z" fill={fillCol} stroke={strokeCol} strokeWidth="2"/>
                         <circle cx="15" cy="10" r="5" fill={isActive ? '#fff' : '#475569'} stroke={strokeCol} strokeWidth="2"/>
                      </svg>
                    );
                  }
                  return (
                    <svg width="14" height="18" viewBox="0 0 24 34" style={{ marginRight: 8 }}>
                       <path d="M12 2 C6.48 2 2 6.48 2 12 C2 19.5 12 32 12 32 C12 32 22 19.5 22 12 C22 6.48 17.52 2 12 2 Z" fill={fillCol} stroke={strokeCol} strokeWidth="2"/>
                       <circle cx="12" cy="12" r="4" fill={isActive ? '#fff' : '#475569'}/>
                    </svg>
                  );
                };

                return (
                  <div className={`item-card ${isActive ? 'active-var-card' : 'item-card-dim'}`} key={inst.name}>
                    <div className="item-header" style={{ marginBottom: 0, cursor: 'pointer', userSelect: 'none' }} onClick={() => setInstruments(prev => ({ ...prev, [inst.name]: !isActive }))}>
                      <div className="item-title-group" style={{ display: 'flex', alignItems: 'center' }}>
                        {renderIcon()}
                        <span className="item-name" style={isActive ? { color: '#064274', fontWeight: 600 } : { color: '#94a3b8', fontWeight: 600 }}>
                          {inst.name}
                        </span>
                      </div>
                      <label className="toggle-switch" onClick={e => e.stopPropagation()}>
                        <input type="checkbox"
                          checked={!!isActive}
                          onChange={e => setInstruments(prev => ({ ...prev, [inst.name]: e.target.checked }))}
                        />
                        <span className="toggle-track" />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* INNER PANEL: Settings */}
        {isSidebarOpen && activeSidebar === 'Settings' && (
          <div className="inner-panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">System Settings</h2>
                <p className="panel-subtitle">Configuration & Performance</p>
              </div>
              <button className="close-btn" onClick={() => setActiveSidebar(null)}><X size={14} /></button>
            </div>
            
            <div className="panel-content custom-scrollbar" style={{ padding: '16px' }}>
              <div className="var-settings-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                <span style={{ width: '100px', fontSize: '11px', fontWeight: 600, color: '#064274' }}>Visual Quality</span>
                <input type="range" min="1" max="10" step="1"
                  style={{ flex: 1, background: getSliderBg(visualQuality, 1, 10) }}
                  value={visualQuality}
                  onChange={e => {
                    const val = parseInt(e.target.value);
                    setVisualQuality(val);
                    if (window.setVisualQuality) window.setVisualQuality(val);
                  }} />
                <span style={{ width: '32px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: '#064274' }}>{visualQuality * 10}%</span>
              </div>
              
              <div className="var-settings-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                <span style={{ width: '100px', fontSize: '11px', fontWeight: 600, color: '#064274' }}>Memory Cache</span>
                <input type="range" min="1000" max="15000" step="1000"
                  style={{ flex: 1, background: getSliderBg(tileCacheLimit, 1000, 15000) }}
                  value={tileCacheLimit}
                  onChange={e => {
                    const val = parseInt(e.target.value);
                    setTileCacheLimit(val);
                    if (window.setTileCacheLimit) window.setTileCacheLimit(val);
                  }} />
                <span style={{ width: '32px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: '#064274' }}>{tileCacheLimit}</span>
              </div>

              <div className="var-settings-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
                <span style={{ width: '100px', fontSize: '11px', fontWeight: 600, color: '#064274' }}>Atmosphere Glow</span>
                <input type="range" min="0" max="100" step="10"
                  style={{ flex: 1, background: getSliderBg(atmosphereGlow, 0, 100) }}
                  value={atmosphereGlow}
                  onChange={e => {
                    const val = parseInt(e.target.value);
                    setAtmosphereGlow(val);
                    if (window.setAtmosphereGlow) window.setAtmosphereGlow(val);
                  }} />
                <span style={{ width: '32px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: '#064274' }}>{atmosphereGlow}%</span>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
                <button className="clear-cache-btn" style={{ color: '#b91c1c' }} onClick={() => {
                  localStorage.clear();
                  setVisualQuality(6); if (window.setVisualQuality) window.setVisualQuality(6);
                  setTileCacheLimit(10000); if (window.setTileCacheLimit) window.setTileCacheLimit(10000);
                  setAtmosphereGlow(10); if (window.setAtmosphereGlow) window.setAtmosphereGlow(10);
                  
                  setIsSunlightOn(false); if (window.toggleSunlight) window.toggleSunlight(false);
                  setIsStarsOn(true); if (window.toggleStars) window.toggleStars(true);
                  setIsRotating(false); if (window.toggleAutoRotate) window.toggleAutoRotate(false);
                  setActiveMap('Bing Aerial'); if (window.changeMapLayer) window.changeMapLayer('Bing Aerial');
                  
                  setActiveLayers({});
                  setBathyEnabled(false); if (window.setBathyEnabled) window.setBathyEnabled(false, 80.0);
                  setBathyOpacity(100); if (window.setBathyOpacity) window.setBathyOpacity(100);
                  setBathyColorMapIdx(4);
                  setBathyInverted(false);
                  setBathyStepwise(false);
                  setBathySteps(5);
                  setBathyMasked(false);
                  setShowBathySettings(true);
                  setVertExagg(80.0); if (window.setGlobeExaggeration) window.setGlobeExaggeration(80.0);
                  setCrossHeight(200);
                  
                  setOceanTab('Physical');
                  setActiveOceanVar(null); if (window.setOceanVariable) window.setOceanVariable(null);
                  setShowVarSettings({});
                  setOpacity({});
                  setColorMapIdx({});
                  setVarInverted({});
                  setVarStepwise({});
                  setVarSteps({});
                  setVarMasked({});
                  setVarClipMin({});
                  setVarClipMax({});
                  setVarMin({});
                  setVarMax({});
                  setCustomColor1_ocean({});
                  setCustomColor2_ocean({});
                  
                  setOceanDepth(0); if (window.setOceanDepth) window.setOceanDepth(0);
                  setOceanDensity(25); if (window.setOceanDensity) window.setOceanDensity(25);
                  
                  setCustomColor1('#3b82f6');
                  setCustomColor2('#10b981');
                  setBathyMin('-6000');
                  setBathyMax('0');
                }}>Reset Settings</button>
                <button className="clear-cache-btn" onClick={() => { if (window.clearCesiumCache) window.clearCesiumCache(activeMap); }}>Clear Cache</button>
              </div>
            </div>
          </div>
        )}

        {/* SIDEBAR TABS */}
        <div className="sidebar-tabs">
          {/* Toggle Button moved here to attach specifically to the sidebar */}
          <button 
            className="side-toggle-btn"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          >
            {isSidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>
          
          {sidebarItems.map((item) => {
            const Icon = item.icon
            const isActive = activeSidebar === item.name
            return (
              <button 
                key={item.name} 
                className={`sidebar-btn ${isActive ? 'active' : ''}`}
                onClick={() => {
                  if (activeSidebar === item.name) {
                    setActiveSidebar(null) // Only unmount the inner panel!
                  } else {
                    setActiveSidebar(item.name)
                    setIsSidebarOpen(true)
                  }
                }}
              >
                <Icon size={18} />
                <span className="sidebar-label">{item.name}</span>
              </button>
            )
          })}
        </div>

      </div>

      <BottomToolbar />

      {/* MODALS */}
      {activeModal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target.classList.contains('modal-overlay')) setActiveModal(null) }}>
          {activeModal === 'info' && (
            <div className="varuna-modal info-modal">
<div className="modal-header">
                <h3>Varuna</h3>
<button className="close-btn" onClick={() => setActiveModal(null)}><X size={16} /></button>
              </div>
              <div className="modal-content custom-scrollbar">
                <p>
                  Varuna is a 3D ocean digital twin built for the web. It takes complex ocean data like temperature, currents, and sea floor depth and makes it easy to explore in real-time. By streaming compressed data directly to your browser, Varuna lets you look beneath the ocean's surface to understand physical changes at any depth.
                </p>
                <div className="tech-partners">
                  <h4>Technology Partners</h4>
                  <div className="partner-logos" style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                    <div className="partner-box" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontWeight: 800, fontSize: '11px', color: '#183A58', letterSpacing: '0.5px' }}>Cesium</span>
                    </div>
                    <div className="partner-box" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                      <svg width="14" height="14" viewBox="0 0 110 110" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M54.1 11.2c-21.7 0-20.9 9.4-20.9 9.4l.2 9.8h21.4v3H33s-9.7-1.3-9.7 13.9c0 15.2 8.5 14.6 8.5 14.6h6v-8.5s-.2-9.9 9.9-9.9h22s9.4.2 9.4-9.3v-13s.8-10-15-10z" fill="#387EB8"/><path d="M55.4 98.7c21.7 0 20.9-9.4 20.9-9.4l-.2-9.8H54.7v-3h21.8s9.7 1.3 9.7-13.9c0-15.2-8.5-14.6-8.5-14.6h-6v8.5s.2 9.9-9.9 9.9h-22s-9.4-.2-9.4 9.3v13s-.8 10 15 10z" fill="#FFE052"/></svg>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: '#0f172a' }}>Python</span>
                    </div>
                    <div className="partner-box" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                      <svg width="14" height="14" viewBox="-10.5 -9.45 21 18.9" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ color: "#61dafb" }}><circle cx="0" cy="0" r="2" fill="currentColor"></circle><g stroke="currentColor" strokeWidth="1" fill="none"><ellipse rx="10" ry="4.5"></ellipse><ellipse rx="10" ry="4.5" transform="rotate(60)"></ellipse><ellipse rx="10" ry="4.5" transform="rotate(120)"></ellipse></g></svg>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: '#0f172a' }}>React</span>
                    </div>
                  </div>
                <div className="modal-actions" style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  <button onClick={() => setActiveModal('database')}>Attributions</button>
                  <button onClick={() => window.open('https://youtube.com', '_blank')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg> YouTube Video
                  </button>
                    <div className="partner-box" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                      <svg width="14" height="14" viewBox="-10.5 -9.45 21 18.9" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ color: "#61dafb" }}><circle cx="0" cy="0" r="2" fill="currentColor"></circle><g stroke="currentColor" strokeWidth="1" fill="none"><ellipse rx="10" ry="4.5"></ellipse><ellipse rx="10" ry="4.5" transform="rotate(60)"></ellipse><ellipse rx="10" ry="4.5" transform="rotate(120)"></ellipse></g></svg>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: '#0f172a' }}>React</span>
                    </div>
                  </div>
                </div>
                <div className="modal-actions" style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  <button onClick={() => setActiveModal('database')}>Attributions</button>
                  <button onClick={() => window.open('https://youtube.com', '_blank')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg> YouTube Video
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeModal === 'changelog' && (
            <div className="varuna-modal changelog-modal">
<div className="modal-header">
                <h3>Changelog</h3>
<button className="close-btn" onClick={() => setActiveModal(null)}><X size={16} /></button>
              </div>
              <div className="modal-content custom-scrollbar">
                <div className="changelog-version">
                  <h4>[0.2.0]</h4>
                  <h5>Added</h5>
                  <ul>
                    <li>Dynamic Timeline Player for temporal animations</li>
                    <li>Dropdown for time periods (Month, Year, Decade) with precise seek steps</li>
                    <li>Sleek, frosted-glass design for the timeline interface</li>
                  </ul>
                  <h5>Changed</h5>
                  <ul>
                    <li>Rebranded entirely from POLARIS to VARUNA across all UI layers</li>
                    <li>Dynamic Timeline Player for temporal animations</li>
                    <li>Dropdown for time periods (Month, Year, Decade) with precise seek steps</li>
                    <li>Sleek, frosted-glass design for the timeline interface</li>
                  </ul>
                  <h5>Changed</h5>
                  <ul>
                    <li>Rebranded entirely from POLARIS to VARUNA across all UI layers</li>
                  </ul>
                  <h5>Fixed</h5>
                  <ul>
                    <li>Resolved overflow clipping issues on the Instrument dropdown menus</li>
                    <li>Fixed hover crosshair tooltip tooltip styles to match the modal theme</li>
                    <li>Resolved overflow clipping issues on the Instrument dropdown menus</li>
                    <li>Fixed hover crosshair tooltip tooltip styles to match the modal theme</li>
                  </ul>
                </div>
                <div className="changelog-version">
                  <h4>[0.1.0]</h4>
                  <h5>Added</h5>
                  <ul>
                    <li>Raw Binary Data API returning Float32Array chunks for 3D volumetric rendering</li>
                    <li>Client-side colormapping and volume rendering via WebGL</li>
                    <li>Universal Parser Engine for Argo and NetCDF sources</li>
                  </ul>
                  <h5>Fixed</h5>
                  <ul>
                    <li>Cameras rendering below the bathymetry mesh would not have their states loaded correctly</li>
                    <li>Raw Binary Data API returning Float32Array chunks for 3D volumetric rendering</li>
                    <li>Client-side colormapping and volume rendering via WebGL</li>
                    <li>Universal Parser Engine for Argo and NetCDF sources</li>
                  </ul>
                  <h5>Fixed</h5>
                  <ul>
                    <li>Cameras rendering below the bathymetry mesh would not have their states loaded correctly</li>
                  </ul>
                </div>
                <div className="changelog-version">
                  <h4>[0.0.9]</h4>
                  <h5>Added</h5>
                  <ul>
                    <li>High-performance Cesium WebGL rendering engine integration</li>
                    <li>HUD compass with 60fps real-time math synchronization</li>
                    <li>High-performance Cesium WebGL rendering engine integration</li>
                    <li>HUD compass with 60fps real-time math synchronization</li>
                    <li>Dynamic sidebars with frosted glassmorphism</li>
                  </ul>
                  <h5>Changed</h5>
                  <ul>
                    <li>Switched default map view to Bing Aerial</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {activeModal === 'database' && (
            <div className="varuna-modal database-modal">
<div className="modal-header">
                <h3>Data Sources</h3>
<button className="close-btn" onClick={() => setActiveModal(null)}><X size={16} /></button>
              </div>
              <div className="modal-content custom-scrollbar">
                <p>
                  Varuna aggregates multi-scale oceanic models, physical profiles, and spatial data from the following verified providers:
</p>
                <div className="data-source-list">
                  <div className="data-source-item">
                    <div className="ds-icon"><Database size={16} color="#3b82f6" /></div>
                    <div className="ds-info">
                      <h4>CMEMS</h4>
                      <span>Oceanographic telemetry & currents</span>
                    </div>
                  </div>
                  <div className="data-source-item">
                    <div className="ds-icon"><Activity size={16} color="#10b981" /></div>
                    <div className="ds-info">
                      <h4>Argo GDAC</h4>
                      <span>Global array of profiling floats</span>
                    </div>
                  </div>
                  <div className="data-source-item">
                    <div className="ds-icon"><MapIcon size={16} color="#f59e0b" /></div>
                    <div className="ds-info">
                      <h4>IBTrACS</h4>
                      <span>Historical & active storm tracking</span>
                    </div>
                  </div>
                  <div className="data-source-item">
                    <div className="ds-icon"><Layers size={16} color="#6366f1" /></div>
                    <div className="ds-info">
                      <h4>NOAA</h4>
                      <span>Atmospheric & weather modeling</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  )
}
