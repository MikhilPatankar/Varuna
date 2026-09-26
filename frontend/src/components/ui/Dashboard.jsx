import { useState, useEffect, useRef } from 'react'
import { Cartesian3, Math as CesiumMath } from 'cesium'
import { 
  Camera, Settings, Info, FileText, Database,
  Home, Sun, Sparkles, Moon, Mountain, Layers, Map as MapIcon,
  User, Box, Satellite, Radio, Folder, FileEdit, Clock, Activity, Calendar,
  Search, X, List, RefreshCw, Plus, ChevronLeft, ChevronRight,
  Waves, AlertTriangle, Radar, Droplet, Eye, Settings2, ToggleLeft, ToggleRight, Download, Thermometer, Droplets, Wind, Flame, Crosshair, Siren,
  ArrowRightLeft, MoveHorizontal, Baseline, Columns, AlignLeft, BarChart2
} from 'lucide-react'
import './Dashboard.css'

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
  const [activeSidebar, setActiveSidebar] = useLocalStorage('polaris_activeSidebar', null)
  const [isSidebarOpen, setIsSidebarOpen] = useLocalStorage('polaris_isSidebarOpen', true)
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef(null)
  
  const [isMapMenuOpen, setIsMapMenuOpen] = useState(false)
  const [activeMap, setActiveMap] = useLocalStorage('polaris_activeMap', 'Bing Aerial')
  const [is3D, setIs3D] = useLocalStorage('polaris_is3D', false)
  const [isStarsOn, setIsStarsOn] = useLocalStorage('polaris_isStarsOn', true)
  const [isSunlightOn, setIsSunlightOn] = useLocalStorage('polaris_isSunlightOn', false)
  const [isRotating, setIsRotating] = useLocalStorage('polaris_isRotating', false)
  const mapMenuRef = useRef(null)
  const [activeModal, setActiveModal] = useState(null)

  useEffect(() => {
    const handleOpenDataSources = () => setActiveModal('database');
    window.addEventListener('open-data-sources', handleOpenDataSources);
    return () => window.removeEventListener('open-data-sources', handleOpenDataSources);
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
  const [activeLayers, setActiveLayers] = useLocalStorage('polaris_activeLayers', {})
  const [bathyEnabled, setBathyEnabled] = useLocalStorage('polaris_bathyEnabled', true)
  const [bathyOpacity, setBathyOpacity] = useLocalStorage('polaris_bathyOpacity', 100)
  const [bathyColorMapIdx, setBathyColorMapIdx] = useLocalStorage('polaris_bathyColorMapIdx', 0)
  const [bathyInverted, setBathyInverted] = useLocalStorage('polaris_bathyInverted', false)
  const [bathyStepwise, setBathyStepwise] = useLocalStorage('polaris_bathyStepwise', false)
  const [bathySteps, setBathySteps] = useLocalStorage('polaris_bathySteps', 5)
  const [bathyMasked, setBathyMasked] = useLocalStorage('polaris_bathyMasked', false)
  const [showBathySettings, setShowBathySettings] = useLocalStorage('polaris_showBathySettings', true)
  const [vertExagg, setVertExagg] = useLocalStorage('polaris_vertExagg', 1.5)
  const [crossHeight, setCrossHeight] = useLocalStorage('polaris_crossHeight', 200)

  // ── Ocean Variables State ─────────────────────────────
  const [oceanTab, setOceanTab] = useLocalStorage('polaris_oceanTab', 'Physical')
  const [activeOceanVar, setActiveOceanVar] = useLocalStorage('polaris_activeOceanVar', 'Temperature')
  const [showVarSettings, setShowVarSettings] = useLocalStorage('polaris_ocean_showVarSettings', {})
  const [opacity, setOpacity] = useLocalStorage('polaris_ocean_opacity', {})
  const [colorMapIdx, setColorMapIdx] = useLocalStorage('polaris_ocean_colorMapIdx', {})
  const [varInverted, setVarInverted] = useLocalStorage('polaris_ocean_varInverted', {})
  const [varStepwise, setVarStepwise] = useLocalStorage('polaris_ocean_varStepwise', {})
  const [varSteps, setVarSteps] = useLocalStorage('polaris_ocean_varSteps', {})
  const [varMasked, setVarMasked] = useLocalStorage('polaris_ocean_varMasked', {})
  const [varMin, setVarMin] = useLocalStorage('polaris_ocean_varMin', {})
  const [varMax, setVarMax] = useLocalStorage('polaris_ocean_varMax', {})
  const [customColor1_ocean, setCustomColor1_ocean] = useLocalStorage('polaris_ocean_customColor1', {})
  const [customColor2_ocean, setCustomColor2_ocean] = useLocalStorage('polaris_ocean_customColor2', {})
  
  // Shared advanced settings state (Bathymetry)
  const [customColor1, setCustomColor1] = useLocalStorage('polaris_customColor1', '#3b82f6')
  const [customColor2, setCustomColor2] = useLocalStorage('polaris_customColor2', '#10b981')
  
  const [bathyMin, setBathyMin] = useLocalStorage('polaris_bathyMin', '-6000')
  const [bathyMax, setBathyMax] = useLocalStorage('polaris_bathyMax', '0')

  const baseColorMaps = [
    { label: 'Thermal', bg: 'linear-gradient(to right, #1a1a3a, #5b326d, #c5535c, #f6a157, #fdf870)' },
    { label: 'Viridis', bg: 'linear-gradient(to right, #440154, #31688e, #35b779, #fde725)' },
    { label: 'Jet',     bg: 'linear-gradient(to right, #000080, #0000ff, #00ffff, #ffff00, #ff0000)' },
    { label: 'Grayscale', bg: 'linear-gradient(to right, #000000, #ffffff)' },
    { label: 'Deep Blue', bg: 'linear-gradient(to right, #000033, #0033aa, #0099ff, #aaddff, #ffffff)' },

    { label: 'ETOPO',   bg: 'linear-gradient(to right, #000050, #1a5276, #2e86c1, #85c1e9, #d6eaf8)' },
    { label: 'Inferno', bg: 'linear-gradient(to right, #000004, #420a68, #932667, #dd513a, #fca50a)' },
    { label: 'Terrain', bg: 'linear-gradient(to right, #1a0533, #5b2d8e, #2980b9, #27ae60, #f0e68c)' },
    { label: 'Plasma',  bg: 'linear-gradient(to right, #0d0887, #7e03a8, #cc4678, #f89441, #f0f921)' },
    { label: 'Magma',   bg: 'linear-gradient(to right, #000004, #50127b, #b63679, #fb8861, #fcffa4)' },

    { label: 'Ocean',   bg: 'linear-gradient(to right, #002244, #005588, #0088cc, #00bbff, #eeffff)' },
    { label: 'Cool',    bg: 'linear-gradient(to right, #00ffff, #ff00ff)' },
    { label: 'Warm',    bg: 'linear-gradient(to right, #0000ff, #ff0000)' },
    { label: 'Spectral',bg: 'linear-gradient(to right, #9e0142, #d53e4f, #f46d43, #fdae61, #fee08b)' },
    { label: 'Rainbow', bg: 'linear-gradient(to right, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff)' },

    { label: 'Reds',    bg: 'linear-gradient(to right, #fff5f0, #fb6a4a, #cb181d, #67000d)' },
    { label: 'Greens',  bg: 'linear-gradient(to right, #f7fcf5, #74c476, #238b45, #00441b)' },
    { label: 'Blues',   bg: 'linear-gradient(to right, #f7fbff, #6baed6, #2171b5, #08306b)' },
    { label: 'Purples', bg: 'linear-gradient(to right, #fcfbfd, #9e9ac8, #6a51a3, #3f007d)' },
    { label: 'Oranges', bg: 'linear-gradient(to right, #fff5eb, #fd8d3c, #d94801, #7f2704)' },

    { label: 'YlOrRd',  bg: 'linear-gradient(to right, #ffffb2, #fecc5c, #fd8d3c, #e31a1c)' },
    { label: 'YlGnBu',  bg: 'linear-gradient(to right, #ffffcc, #a1dab4, #41b6c4, #225ea8)' },
    { label: 'PuOr',    bg: 'linear-gradient(to right, #b35806, #f1a340, #f7f7f7, #998ec3, #542788)' },
    { label: 'RdYlBu',  bg: 'linear-gradient(to right, #d73027, #fc8d59, #fee090, #e0f3f8, #91bfdb)' },
    { label: 'Custom',  bg: 'linear-gradient(to right, #333333, #cccccc)' },
  ]

  const getProcessedGradient = (idx, inverted, stepwise, stepsCount = 5) => {
    let bg = baseColorMaps[idx]?.bg || '';
    if (idx === 24) {
      bg = `linear-gradient(to right, ${customColor1}, ${customColor2})`;
    }
    
    if (stepwise) {
      const colors = bg.match(/#[0-9a-fA-F]{3,6}|rgba?\([^)]+\)/g);
      if (colors && colors.length > 0) {
        let steps = [];
        for (let i = 0; i < stepsCount; i++) {
          const t = (i / Math.max(1, stepsCount - 1)) * (colors.length - 1);
          const idx1 = Math.floor(t);
          const idx2 = Math.ceil(t);
          const pct = Math.round((t - idx1) * 100);
          const c1 = colors[idx1];
          const c2 = colors[idx2];
          const c = (idx1 === idx2) ? c1 : `color-mix(in srgb, ${c2} ${pct}%, ${c1})`;
          const stepSize = 100 / stepsCount;
          steps.push(`${c} ${i * stepSize}%`, `${c} ${(i + 1) * stepSize}%`);
        }
        bg = `linear-gradient(to right, ${steps.join(', ')})`;
      }
    }

    if (inverted) {
      bg = bg.replace('to right', 'to left');
    }
    
    return bg;
  }

  // ── Disaster State ────────────────────────────────────
  const [disasters, setDisasters] = useLocalStorage('polaris_disasters', {
    'Cyclone Tracking': true,
    'Oil Spillage': false,
    'Tsunami Warning': false,
    'Fishing Zone': false,
    'Dead Zone': false,
    'Marine Heatwave': false,
  })

  // ── Instrument State ──────────────────────────────────
  const [instruments, setInstruments] = useLocalStorage('polaris_instruments', {
    'Argo Floats': false, 'CTD Profilers': false,
    'Satellite Altimeters': false, 'Moored Buoys': false,
    'Gliders': false, 'Drifters': false,
    'Tide Gauges': false, 'Acoustic Doppler': false,
  })

  const physicalVars = [
    { name: 'Temperature', icon: Thermometer, gradient: 'linear-gradient(to right, #1a1a3a, #5b326d, #c5535c, #f6a157, #fdf870)', min: '-2', mid: '14', max: '30 °C' },
    { name: 'Salinity',    icon: Droplets,    gradient: 'linear-gradient(to right, #081d58, #253494, #1d91c0, #7fcdbb, #ffffd9)', min: '0',  mid: '20', max: '40 ‰'  },
    { name: 'Currents',    icon: Wind,        gradient: 'linear-gradient(to right, #0d0221, #0a4bc7, #17b0d4, #e8f7fd)',          min: '0',  mid: '1.2',max: '2.5 m/s'},
  ]
  const chemicalVars = [
    { name: 'Chlorophyll', icon: Droplet,     gradient: 'linear-gradient(to right, #ffffff, #d9f0a3, #78c679, #238443, #004529)', min: '0',  mid: '5',  max: '10 mg/m³'},
    { name: 'Oxygen',      icon: RefreshCw,   gradient: 'linear-gradient(to right, #67001f, #d6604d, #f7f7f7, #4393c3, #053061)', min: '0',  mid: '150',max: '300 µmol/L'},
    { name: 'Nitrate',     icon: Activity,    gradient: 'linear-gradient(to right, #fff7bc, #fec44f, #d95f0e)',                   min: '0',  mid: '20', max: '40 µmol/L'},
    { name: 'Phosphate',   icon: Mountain,    gradient: 'linear-gradient(to right, #edf8b1, #7fcdbb, #2c7fb8)',                  min: '0',  mid: '1.5',max: '3 µmol/L'},
    { name: 'Silicate',    icon: Box,         gradient: 'linear-gradient(to right, #feedde, #fdbe85, #fd8d3c, #d94701)',         min: '0',  mid: '50', max: '100 µmol/L'},
  ]



  const sidebarItems = [
    { name: 'Objects', icon: Box },
    { name: 'Layers', icon: Layers },
    { name: 'Ocean', icon: Waves },
    { name: 'Disasters', icon: Siren },
    { name: 'Sensors', icon: Radar },
  ]


  return (
    <div className="dashboard-root">
      
      {/* TOP LEFT: Brand & Tools */}
      <div className="top-left-panel">
        <div className="brand">
          <span className="brand-dot" />
          <span className="brand-text">POLARIS</span>
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
                link.download = `Polaris_Capture_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
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

        <div className="badge">BETA v0.1</div>
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
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px' }}>
                        <div className="gradient-bar" style={{ 
                          flex: 1,
                          background: getProcessedGradient(bathyColorMapIdx, bathyInverted, bathyStepwise, bathySteps), 
                          marginTop: 0,
                          WebkitMaskImage: bathyMasked ? 'linear-gradient(to right, transparent 0%, transparent 1.5%, black 1.5%, black 98.5%, transparent 98.5%, transparent 100%)' : 'none',
                          maskImage: bathyMasked ? 'linear-gradient(to right, transparent 0%, transparent 1.5%, black 1.5%, black 98.5%, transparent 98.5%, transparent 100%)' : 'none'
                        }} />
                        <button className="icon-btn-flat"
                          style={{ flexShrink: 0, padding: 0, display: 'flex', alignItems: 'center' }}
                          onClick={e => { e.stopPropagation(); setShowBathySettings(s => !s); }}>
                          <Settings2 size={16} color={showBathySettings ? '#3b82f6' : '#064274'} />
                        </button>
                      </div>
                      <div className="gradient-labels" style={{ paddingRight: '28px' }}>
                        {(() => {
                          const [dMin, dMid, dMax] = getDisplayLimits(bathyMin, bathyMax, bathyMasked, 'm');
                          return <><span style={{ position: 'relative', left: bathyMasked ? '1.5%' : 0 }}>{dMin}</span><span>{dMid}</span><span style={{ position: 'relative', right: bathyMasked ? '1.5%' : 0 }}>{dMax}</span></>;
                        })()}
                      </div>
                    </div>
                    {showBathySettings && (
                      <div className="var-settings">


                        <div className="var-settings-row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                          <span>Colour map</span>
                          <div style={{ display: 'flex', gap: '12px' }}>
                            <button className="icon-btn-flat" title="Invert color map" onClick={e=>{e.stopPropagation(); setBathyInverted(v=>!v)}}>
                              <ArrowRightLeft size={15} color={bathyInverted ? '#3b82f6' : '#333'} />
                            </button>
                            <button className="icon-btn-flat" title="Stepwise color map" onClick={e=>{e.stopPropagation(); setBathyStepwise(v=>!v)}}>
                              <BarChart2 size={15} color={bathyStepwise ? '#3b82f6' : '#333'} />
                            </button>
                            <button className="icon-btn-flat" title="Mask edges" onClick={e=>{e.stopPropagation(); setBathyMasked(v=>!v)}}>
                              <MoveHorizontal size={15} color={bathyMasked ? '#3b82f6' : '#333'} />
                            </button>
                          </div>
                        </div>
                        <div className="color-swatch-grid" onClick={e=>e.stopPropagation()}>
                          {baseColorMaps.slice(0, 10).map((cm, i) => (
                            <div key={i}
                              className={`color-swatch ${bathyColorMapIdx === i ? 'active' : ''}`}
                              style={{ background: getProcessedGradient(i, false, false) }}
                              onClick={() => setBathyColorMapIdx(i)}
                              title={cm.label}
                            />
                          ))}
                        </div>
                        
                        <div className="custom-color-row" onClick={e=>e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: '#064274' }}>Custom</span>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <input type="color" value={customColor1} onChange={e => {setCustomColor1(e.target.value); setBathyColorMapIdx(24);}} style={{ width: '24px', height: '16px', padding: 0, border: 'none' }} />
                            <input type="color" value={customColor2} onChange={e => {setCustomColor2(e.target.value); setBathyColorMapIdx(24);}} style={{ width: '24px', height: '16px', padding: 0, border: 'none' }} />
                          </div>
                        </div>

                        {bathyStepwise && (
                          <div className="thresholds-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} onClick={e=>e.stopPropagation()}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#064274' }}>Thresholds:</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <button className="icon-btn-flat" style={{ fontSize: '16px', fontWeight: 'bold' }} onClick={() => setBathySteps(s => Math.max(2, s - 1))}>−</button>
                              <span style={{ fontSize: '12px', fontWeight: 600, color: '#064274', width: '20px', textAlign: 'center' }}>{bathySteps}</span>
                              <button className="icon-btn-flat" style={{ fontSize: '16px', fontWeight: 'bold' }} onClick={() => setBathySteps(s => Math.min(20, s + 1))}>+</button>
                            </div>
                          </div>
                        )}

                        <div className="var-limits-row" onClick={e=>e.stopPropagation()}>
                          <div className="limit-input">
                            <span>Min:</span>
                            <input type="text" value={bathyMin} onChange={e => setBathyMin(e.target.value)} />
                          </div>
                          <div className="limit-input">
                            <span>Max:</span>
                            <input type="text" value={bathyMax} onChange={e => setBathyMax(e.target.value)} />
                          </div>
                          <button className="auto-btn" onClick={() => { setBathyMin('-11000'); setBathyMax('0'); }}>Auto</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {[ 
                { name: 'Sea Surface Height', icon: Waves, gradient: 'linear-gradient(to right, #053061, #4393c3, #f7f7f7, #d6604d, #67001f)',min: '-1', mid: '0',  max: '1 m'  },
                { name: 'Sea Surface Temperature', icon: Thermometer, gradient: 'linear-gradient(to right, #1a1a3a, #5b326d, #c5535c, #f6a157, #fdf870)', min: '-2', mid: '14', max: '30 °C' },
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
                              background: getProcessedGradient(curColorMapIdx, curInverted, curStepwise, curSteps), 
                              marginTop: 0,
                              WebkitMaskImage: curMasked ? 'linear-gradient(to right, transparent 0%, transparent 1.5%, black 1.5%, black 98.5%, transparent 98.5%, transparent 100%)' : 'none',
                              maskImage: curMasked ? 'linear-gradient(to right, transparent 0%, transparent 1.5%, black 1.5%, black 98.5%, transparent 98.5%, transparent 100%)' : 'none'
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
                                  style={{ background: getProcessedGradient(i, false, false) }}
                                  onClick={() => setColorMapIdx(prev => ({...prev, [vn]: i}))}
                                  title={cm.label}
                                />
                              ))}
                            </div>

                            <div className="custom-color-row" onClick={e=>e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: '12px', fontWeight: 600, color: '#064274' }}>Custom</span>
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

                            <div className="var-limits-row" onClick={e=>e.stopPropagation()}>
                              <div className="limit-input">
                                <span>Min:</span>
                                <input type="text" value={curMin} onChange={e => {const val = e.target.value; setVarMin(prev => ({...prev, [vn]: val}));}} />
                              </div>
                              <div className="limit-input">
                                <span>Max:</span>
                                <input type="text" value={curMax} onChange={e => {const val = e.target.value; setVarMax(prev => ({...prev, [vn]: val}));}} />
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
        {isSidebarOpen && activeSidebar === 'Ocean' && (
          <div className="inner-panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Ocean Variables</h2>
                <p className="panel-subtitle">One layer active at a time</p>
              </div>
              <button className="close-btn" onClick={() => setActiveSidebar(null)}><X size={14} /></button>
            </div>
            <div className="panel-tabs primary-tabs">
              <button className={`tab ${oceanTab === 'Physical' ? 'active' : ''}`} onClick={() => setOceanTab('Physical')}>Physical</button>
              <button className={`tab ${oceanTab === 'Chemical' ? 'active' : ''}`} onClick={() => setOceanTab('Chemical')}>Chemical</button>
            </div>
            <div className="panel-content custom-scrollbar">
              {(oceanTab === 'Physical' ? physicalVars : chemicalVars).map(v => {
                const isActive = activeOceanVar === v.name;
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px' }}>
                            <div className="gradient-bar" style={{ 
                              flex: 1,
                              background: getProcessedGradient(curColorMapIdx, curInverted, curStepwise, curSteps), 
                              marginTop: 0,
                              WebkitMaskImage: curMasked ? 'linear-gradient(to right, transparent 0%, transparent 1.5%, black 1.5%, black 98.5%, transparent 98.5%, transparent 100%)' : 'none',
                              maskImage: curMasked ? 'linear-gradient(to right, transparent 0%, transparent 1.5%, black 1.5%, black 98.5%, transparent 98.5%, transparent 100%)' : 'none'
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
                                  style={{ background: getProcessedGradient(i, false, false) }}
                                  onClick={() => setColorMapIdx(prev => ({...prev, [vn]: i}))}
                                  title={cm.label}
                                />
                              ))}
                            </div>

                            <div className="custom-color-row" onClick={e=>e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: '12px', fontWeight: 600, color: '#064274' }}>Custom</span>
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

                            <div className="var-limits-row" onClick={e=>e.stopPropagation()}>
                              <div className="limit-input">
                                <span>Min:</span>
                                <input type="text" value={curMin} onChange={e => {const val = e.target.value; setVarMin(prev => ({...prev, [vn]: val}));}} />
                              </div>
                              <div className="limit-input">
                                <span>Max:</span>
                                <input type="text" value={curMax} onChange={e => {const val = e.target.value; setVarMax(prev => ({...prev, [vn]: val}));}} />
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
                { name: 'Fishing Zone',      icon: Crosshair,     color: '#f59e0b' },
                { name: 'Dead Zone',         icon: Box,           color: '#8b5cf6' },
                { name: 'Cyclone',           icon: AlertTriangle, color: '#ef4444' },
                { name: 'Tsunami',           icon: Waves,         color: '#3b82f6' },
                { name: 'Oil Spillage',      icon: Droplet,       color: '#10b981' },
                { name: 'Marine Heatwave',   icon: Flame,         color: '#ef4444' },
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
                { name: 'Argo float',          icon: Radio },
                { name: 'Thermosalinometer',   icon: Activity },
                { name: 'Mooring',             icon: MapIcon },
                { name: 'Glider',              icon: Activity },
                { name: 'CTD',                 icon: Thermometer },
                { name: 'Drifter - SVP',       icon: Crosshair },
                { name: 'Drifter - SVPB',      icon: Crosshair },
                { name: 'Drifter - SVPBV',     icon: Crosshair },
              ].map(inst => (
                <div className={`item-card ${instruments[inst.name] ? 'active-var-card' : 'item-card-dim'}`} key={inst.name}>
                  <div className="item-header" style={{ marginBottom: 0, cursor: 'pointer', userSelect: 'none' }} onClick={() => setInstruments(prev => ({ ...prev, [inst.name]: !prev[inst.name] }))}>
                    <div className="item-title-group">
                      <inst.icon size={13} className="item-icon"
                        style={instruments[inst.name] ? { color: '#3b82f6' } : { color: '#94a3b8' }} />
                      <span className="item-name" style={instruments[inst.name] ? { color: '#3b82f6' } : { color: '#94a3b8' }}>
                        {inst.name}
                      </span>
                    </div>
                    <label className="toggle-switch" onClick={e => e.stopPropagation()}>
                      <input type="checkbox"
                        checked={instruments[inst.name]}
                        onChange={e => setInstruments(prev => ({ ...prev, [inst.name]: e.target.checked }))}
                      />
                      <span className="toggle-track" />
                    </label>
                  </div>
                </div>
              ))}
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
      {/* MODALS */}
      {activeModal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target.classList.contains('modal-overlay')) setActiveModal(null) }}>
          {activeModal === 'info' && (
            <div className="polaris-modal info-modal">
              <div className="modal-header">
                <h3>Polaris</h3>
                <button className="close-btn" onClick={() => setActiveModal(null)}><X size={16} /></button>
              </div>
              <div className="modal-content custom-scrollbar">
                <p>
                  Polaris brings together live orbital telemetry, analytical tools, and immersive visualization into a single place. We work closely with industry partners to ensure the underlying physics models, ephemeris data, and rendering technology are accurate enough for real-world operations.
                </p>
                <div className="tech-partners">
                  <h4>Technology Partners</h4>
                  <div className="partner-logos">
                    <div className="partner-box">
                      <Database size={16} color="#4ade80" />
                    </div>
                    <div className="partner-box">
                      <Activity size={16} color="#3b82f6" />
                    </div>
                  </div>
                </div>
                <div className="modal-actions">
                  <button>Attributions</button>
                  <button>Third Party Licenses</button>
                  <button>Feedback</button>
                </div>
              </div>
            </div>
          )}

          {activeModal === 'changelog' && (
            <div className="polaris-modal changelog-modal">
              <div className="modal-header">
                <h3>Changelog</h3>
                <button className="close-btn" onClick={() => setActiveModal(null)}><X size={16} /></button>
              </div>
              <div className="modal-content custom-scrollbar">
                <div className="changelog-version">
                  <h4>[0.1.0]</h4>
                  <h5>Added</h5>
                  <ul>
                    <li>Viewer session names to browser tab</li>
                    <li>Timeline now displays an object's events</li>
                    <li>Visibility time intervals available for satellites</li>
                    <li>Covariance ellipsoids can be rendered from ephemeris data</li>
                  </ul>
                  <h5>Fixed</h5>
                  <ul>
                    <li>Cameras in the <code>INERTIAL</code> frame would not have their states loaded correctly</li>
                  </ul>
                </div>
                <div className="changelog-version">
                  <h4>[0.0.9]</h4>
                  <h5>Added</h5>
                  <ul>
                    <li>High-performance Cesium WebGL rendering engine integration</li>
                    <li>HUD compass with 60fps real-time math synchronization</li>
                    <li>Dynamic geometric horizon mapping for pitch constraints</li>
                  </ul>
                </div>
                <div className="changelog-version">
                  <h4>[0.0.8]</h4>
                  <h5>Added</h5>
                  <ul>
                    <li>Dynamic sidebars with frosted glassmorphism</li>
                    <li>Tooltips for navigation icons</li>
                    <li>Initial layout for Objects, Satellites, and Stations</li>
                  </ul>
                  <h5>Changed</h5>
                  <ul>
                    <li>Switched default map view to Bing Aerial</li>
                    <li>Updated system font to Inter for improved legibility</li>
                  </ul>
                </div>
                <div className="changelog-version">
                  <h4>[0.0.7]</h4>
                  <h5>Fixed</h5>
                  <ul>
                    <li>Bug where 2D/3D toggle would fly the camera into deep space</li>
                    <li>Resolved CSS pointer-events blocking clicks on overlay modals</li>
                  </ul>
                </div>
                <div className="changelog-version">
                  <h4>[0.0.6]</h4>
                  <h5>Added</h5>
                  <ul>
                    <li>Bottom footer with dynamic camera telemetry (Alt, Heading, Pitch)</li>
                    <li>Data attribution links for CMEMS, Argo GDAC, and NOAA</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {activeModal === 'database' && (
            <div className="polaris-modal database-modal">
              <div className="modal-header">
                <h3>Data Sources</h3>
                <button className="close-btn" onClick={() => setActiveModal(null)}><X size={16} /></button>
              </div>
              <div className="modal-content custom-scrollbar">
                <p>
                  Polaris aggregates live orbital telemetry, oceanic models, and atmospheric data from the following verified providers:
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
