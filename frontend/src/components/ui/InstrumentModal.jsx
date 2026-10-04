import React, { useState, useEffect, useRef } from 'react';
import { Cartesian3, SceneTransforms, EllipsoidalOccluder, Ellipsoid } from 'cesium';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';
import { X, Activity, Thermometer, Droplet, Wind } from 'lucide-react';
import './InstrumentModal.css';
import { API_BASE_URL } from '../../config';

const VAR_MAP = {
  temperature: { label: 'Temperature', unit: '°C', color: '#ff9800', icon: Thermometer },
  salinity: { label: 'Salinity', unit: 'PSU', color: '#00bcd4', icon: Droplet },
  dissolved_oxygen: { label: 'Dissolved Oxygen', unit: 'µmol/kg', color: '#4caf50', icon: Activity },
  chlorophyll: { label: 'Chlorophyll', unit: 'mg/m³', color: '#8bc34a', icon: Activity },
  nitrate: { label: 'Nitrate', unit: 'µmol/L', color: '#9c27b0', icon: Activity },
  phosphate: { label: 'Phosphate', unit: 'µmol/L', color: '#673ab7', icon: Activity },
  u_current: { label: 'Zonal Current', unit: 'm/s', color: '#2196f3', icon: Wind },
  v_current: { label: 'Meridional Current', unit: 'm/s', color: '#03a9f4', icon: Wind },
};

export default function InstrumentModal() {
  const [data, setData] = useState(null);
  const [position, setPosition] = useState({ x: -1000, y: -1000, visible: false });
  const [selectedVar, setSelectedVar] = useState('');
  const [availableVars, setAvailableVars] = useState([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [depthData, setDepthData] = useState([]);
  const [isDepthLoading, setIsDepthLoading] = useState(false);
  
  const modalRef = useRef(null);
  const currentPosRef = useRef(null);

  useEffect(() => {
    const handleSelect = (e) => {
      const payload = e.detail;
      if (!payload || !payload.profiles || payload.profiles.length === 0) return;

      const profiles = payload.profiles;
      
      // Determine available variables (all keys except the basic 4)
      const excludeKeys = ['lat', 'lon', 'depth', 'observation_time'];
      const vars = Object.keys(profiles[0]).filter(k => !excludeKeys.includes(k));

      setAvailableVars(vars);
      if (vars.length > 0) {
        setSelectedVar(vars[0]);
      } else {
        setSelectedVar('');
      }

      setData(payload);
      
      const latest = profiles[0];
      currentPosRef.current = Cartesian3.fromDegrees(parseFloat(latest.lon), parseFloat(latest.lat), 2000);
      if (window.cesiumViewer) window.cesiumViewer.scene.requestRender();
    };

    const handleDeselect = () => {
      setData(null);
      setPosition({ x: -1000, y: -1000, visible: false });
      currentPosRef.current = null;
    };

    window.addEventListener('varuna-instrument-select', handleSelect);
    window.dispatchEvent(new CustomEvent('varuna-instrument-select-ready'));
    window.addEventListener('varuna-instrument-deselect', handleDeselect);

    return () => {
      window.removeEventListener('varuna-instrument-select', handleSelect);
      window.removeEventListener('varuna-instrument-deselect', handleDeselect);
    };
  }, []);

  // Sync with Cesium camera movement
  useEffect(() => {
    if (!data) return;
    
    const onPreRender = () => {
      if (!window.cesiumViewer || !currentPosRef.current) return;
      const scene = window.cesiumViewer.scene;
      
      const occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, scene.camera.positionWC);
      const isVisible = occluder.isPointVisible(currentPosRef.current);
      
      if (!isVisible) {
        setPosition(prev => ({ ...prev, visible: false }));
        return;
      }
      
      const canvasPos = SceneTransforms.worldToWindowCoordinates(scene, currentPosRef.current);
      
      if (canvasPos) {
        // Calculate distance-based scaling
        const distance = Cartesian3.distance(scene.camera.positionWC, currentPosRef.current);
        
        // Match Cesium's NearFarScalar (10km = 1.0, 10,000km = 0.5)
        const nearDist = 10000;
        const nearScale = 1.0;
        const farDist = 10000000;
        const farScale = 0.5;
        
        let scale = 1.0;
        if (distance <= nearDist) {
          scale = nearScale;
        } else if (distance >= farDist) {
          scale = farScale;
        } else {
          const t = (distance - nearDist) / (farDist - nearDist);
          scale = nearScale + t * (farScale - nearScale);
        }
        
        setPosition({ 
          x: canvasPos.x + (30 * scale), 
          y: canvasPos.y - (100 * scale), 
          scale: scale,
          visible: true,
          anchorX: canvasPos.x,
          anchorY: canvasPos.y
        });
      } else {
        setPosition(prev => ({ ...prev, visible: false }));
      }
    };

    const removeListener = window.cesiumViewer.scene.preRender.addEventListener(onPreRender);
    return () => removeListener();
  }, [data]);

  // Fetch Depth Profile from Gridded API when variable changes
  useEffect(() => {
    if (!selectedVar || !data) return;
    const latest = data.profiles[0];
    const lat = latest.lat;
    const lon = latest.lon;
    
    // Map instrument variable to gridded dataset variable name
    let gridVar = selectedVar;
    
    setIsDepthLoading(true);
    setDepthData([]);
    
    const loadDepthData = async () => {
      let timeKey = new Date().toISOString().split('T')[0];
      try {
        const keyRes = await fetch(`${API_BASE_URL}/api/v1/data/${gridVar}/daily/latest_key`);
        if (keyRes.ok) {
          const keyData = await keyRes.json();
          if (keyData.time_key) timeKey = keyData.time_key;
        }
      } catch (e) {
        console.error(`Failed to fetch latest time key for ${gridVar}`, e);
      }

      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/data/${gridVar}/daily/${timeKey}/column?lat=${lat}&lon=${lon}`);
        if (!res.ok) throw new Error("Failed to fetch column");
        const depthLevelsStr = res.headers.get("X-Depth-Levels");
        const depths = depthLevelsStr ? depthLevelsStr.split(',').map(Number) : [];
        const buffer = await res.arrayBuffer();
        const floatArray = new Float32Array(buffer);
        
        const newDepthData = [];
        for (let i = 0; i < floatArray.length; i++) {
          const val = floatArray[i];
          if (val !== -9999.0) { // filter out NaN sentinels
            newDepthData.push({
              depth: depths[i] || 0,
              val: val
            });
          }
        }
        setDepthData(newDepthData);
      } catch (err) {
        console.error(err);
        setDepthData([]);
      } finally {
        setIsDepthLoading(false);
      }
    };
    
    loadDepthData();
  }, [selectedVar, data]);

  const close = () => {
    window.dispatchEvent(new CustomEvent('varuna-instrument-deselect'));
  };

  if (!data) return null;

  const latest = data.profiles[0];
  const varConfig = VAR_MAP[selectedVar] || { label: selectedVar, unit: '', color: '#fff' };

  // Prepare data for Time vs Variable (filter invalid)
  const timeData = [...data.profiles]
    .reverse()
    .filter(p => p[selectedVar] !== '' && p[selectedVar] !== null)
    .map(p => ({
      time: p.observation_time.split(' ')[0], // just date
      val: parseFloat(p[selectedVar])
    }));

  return (
    <>
      {/* SVG Connecting Line */}
      {position.visible && (
        <svg 
          style={{ 
            position: 'absolute', 
            top: 0, left: 0, 
            width: '100vw', height: '100vh', 
            pointerEvents: 'none', 
            zIndex: 5 
          }}
        >
          <line 
            x1={position.anchorX} y1={position.anchorY - 15} 
            x2={position.x} y2={position.y + 20 * (position.scale || 1)} 
            stroke="rgba(255, 255, 255, 0.4)" 
            strokeWidth="1.5" 
          />
          <circle cx={position.anchorX} cy={position.anchorY - 15} r="3" fill="#00FFFF" />
        </svg>
      )}

      <div 
        ref={modalRef}
        className={`instrument-modal ${position.visible ? 'visible' : ''}`}
        style={{
          left: position.x,
          top: position.y,
          transform: `scale(${position.scale || 1})`,
          transformOrigin: 'top left'
        }}
      >
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="inst-badge">{data.instrument_type}</span>
            <h3 className="inst-id">{data.instrument_id}</h3>
          </div>
          <button className="close-btn" onClick={close}><X size={14} /></button>
        </div>

        <div className="modal-meta">
          <div><span className="meta-lbl">LAT:</span> {parseFloat(latest.lat).toFixed(4)}° N</div>
          <div><span className="meta-lbl">LON:</span> {parseFloat(latest.lon).toFixed(4)}° E</div>
          <div><span className="meta-lbl">LAST SEEN:</span> {latest.observation_time}</div>
        </div>

        <div className="modal-controls">
          <div className="custom-dropdown" onClick={() => setIsDropdownOpen(!isDropdownOpen)}>
            <div className="dropdown-selected">
              {availableVars.length === 0 ? "No Variables" : (VAR_MAP[selectedVar]?.label || selectedVar)}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`dropdown-arrow ${isDropdownOpen ? 'open' : ''}`}>
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>
            {isDropdownOpen && availableVars.length > 0 && (
              <div className="dropdown-options">
                {availableVars.map(v => (
                  <div 
                    key={v} 
                    className={`dropdown-option ${selectedVar === v ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedVar(v);
                    }}
                  >
                    {VAR_MAP[v]?.label || v}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="modal-body custom-scrollbar">
          {availableVars.length === 0 ? (
            <div className="empty-state">No telemtry variables available for this instrument.</div>
          ) : (
            <>
              {/* Depth vs Variable */}
              <div className="chart-card">
                <div className="chart-title">
                  Depth vs. {varConfig.label} 
                  <span className="unit">({varConfig.unit})</span>
                </div>
                {isDepthLoading ? (
                  <div className="empty-chart">Loading high-res depth profile...</div>
                ) : depthData.length > 0 ? (
                  <div className="chart-wrap" style={{ width: '100%', height: '160px', marginLeft: '-20px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={depthData} layout="vertical" margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                        <XAxis type="number" dataKey="val" domain={['auto', 'auto']} tick={{fontSize: 10, fill: '#64748b'}} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} tickFormatter={(tick) => tick.toFixed(1)} />
                        <YAxis type="number" dataKey="depth" reversed domain={[0, 'auto']} tick={{fontSize: 10, fill: '#64748b'}} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                        <Tooltip 
                          contentStyle={{ background: 'rgba(255, 255, 255, 0.95)', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '11px', color: '#0f172a', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
                          formatter={(value, name) => [
                            typeof value === 'number' ? (name === 'val' ? value.toFixed(3) : value.toFixed(1)) : value, 
                            name === 'val' ? varConfig.label : 'Depth'
                          ]}
                          labelStyle={{ display: 'none' }}
                        />
                        <Line type="monotone" dataKey="val" stroke={varConfig.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="empty-chart">Insufficient Depth Data</div>
                )}
              </div>

              {/* Time vs Variable */}
              <div className="chart-card">
                <div className="chart-title">
                  {varConfig.label} vs. Time 
                  <span className="unit">({varConfig.unit})</span>
                </div>
                {timeData.length > 0 ? (
                  <div className="chart-wrap" style={{ width: '100%', height: '160px', marginLeft: '-20px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={timeData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                        <XAxis dataKey="time" tick={{fontSize: 10, fill: '#64748b'}} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} minTickGap={20} />
                        <YAxis domain={['auto', 'auto']} tick={{fontSize: 10, fill: '#64748b'}} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} tickFormatter={(tick) => tick.toFixed(1)} />
                        <Tooltip 
                          contentStyle={{ background: 'rgba(255, 255, 255, 0.95)', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '11px', color: '#0f172a', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
                          formatter={(value) => [typeof value === 'number' ? value.toFixed(3) : value, varConfig.label]}
                          labelStyle={{ color: '#64748b', marginBottom: '4px', fontWeight: 600 }}
                        />
                        <Line type="monotone" dataKey="val" stroke={varConfig.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="empty-chart">Insufficient Time Data</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
