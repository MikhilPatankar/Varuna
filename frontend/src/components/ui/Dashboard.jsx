import { useState, useEffect, useRef } from 'react'
import { Cartesian3, Math as CesiumMath } from 'cesium'
import { 
  Power, Monitor, Settings, Info, FileText, Database,
  Home, Sun, Sparkles, Moon, Mountain, Layers, Map as MapIcon,
  User, Box, Satellite, Radio, Folder, FileEdit, Clock, Activity, Calendar,
  Search, X, List, RefreshCw, Plus, ChevronLeft, ChevronRight
} from 'lucide-react'
import './Dashboard.css'

export default function Dashboard() {
  // Inner panel is closed by default, but sidebar remains expanded
  const [activeSidebar, setActiveSidebar] = useState(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef(null)
  
  const [isMapMenuOpen, setIsMapMenuOpen] = useState(false)
  const [activeMap, setActiveMap] = useState('Bing Aerial')
  const [is3D, setIs3D] = useState(false)
  const [isStarsOn, setIsStarsOn] = useState(true)
  const [isSunlightOn, setIsSunlightOn] = useState(false)
  const [isRotating, setIsRotating] = useState(false)
  const mapMenuRef = useRef(null)

  // Handle clicking outside of dropdowns to close them
  useEffect(() => {
    function handleClickOutside(event) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target)) {
        setIsAccountMenuOpen(false)
      }
      if (mapMenuRef.current && !mapMenuRef.current.contains(event.target)) {
        setIsMapMenuOpen(false)
      }
    }
    
    if (isAccountMenuOpen || isMapMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    } else {
      document.removeEventListener("mousedown", handleClickOutside)
    }
    
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [isAccountMenuOpen, isMapMenuOpen])

  const sidebarItems = [
    { name: 'Objects', icon: Box },
    { name: 'Satellites', icon: Satellite },
    { name: 'Stations', icon: Radio },
    { name: 'Groups', icon: Folder },
    { name: 'Notes', icon: FileEdit },
    { name: 'Sessions', icon: Clock },
    { name: 'Analytics', icon: Activity },
    { name: 'Planning', icon: Calendar },
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
          <button className="tool-btn" data-tooltip="Power"><Power size={14} /></button>
          <button className="tool-btn" data-tooltip="Monitor"><Monitor size={14} /></button>
          <button className="tool-btn" data-tooltip="Settings"><Settings size={14} /></button>
          <button className="tool-btn" data-tooltip="Info"><Info size={14} /></button>
          <button className="tool-btn" data-tooltip="Changelog"><FileText size={14} /></button>
          <button className="tool-btn" data-tooltip="Database"><Database size={14} /></button>
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
    </div>
  )
}
