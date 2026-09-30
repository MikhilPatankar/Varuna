import React, { useState, useEffect, useRef } from 'react';
import { Cartesian3, SceneTransforms, EllipsoidalOccluder, Ellipsoid } from 'cesium';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { X, Activity, Thermometer, Droplet, Wind } from 'lucide-react';
import './InstrumentModal.css'; // identical stylesheet — no custom CSS needed

// Same VAR_MAP as InstrumentModal
const VAR_MAP = {
  temperature:      { label: 'Temperature',        unit: '°C',      color: '#ff9800', icon: Thermometer },
  salinity:         { label: 'Salinity',            unit: 'PSU',     color: '#00bcd4', icon: Droplet },
  dissolved_oxygen: { label: 'Dissolved Oxygen',    unit: 'µmol/kg', color: '#4caf50', icon: Activity },
  chlorophyll:      { label: 'Chlorophyll',         unit: 'mg/m³',   color: '#8bc34a', icon: Activity },
  nitrate:          { label: 'Nitrate',             unit: 'µmol/L',  color: '#9c27b0', icon: Activity },
  phosphate:        { label: 'Phosphate',           unit: 'µmol/L',  color: '#673ab7', icon: Activity },
  u_current:        { label: 'Zonal Current',       unit: 'm/s',     color: '#2196f3', icon: Wind },
  v_current:        { label: 'Meridional Current',  unit: 'm/s',     color: '#03a9f4', icon: Wind },
};

const ALL_VARS = Object.keys(VAR_MAP);

// Module-level cache: fetched once per variable, reused forever
const _latestKeyCache = {};

async function getLatestKey(variable) {
  if (_latestKeyCache[variable]) return _latestKeyCache[variable];
  try {
    const res = await fetch(`http://localhost:8000/api/v1/data/${variable}/daily/latest_key`);
    if (!res.ok) return null;
    const json = await res.json();
    _latestKeyCache[variable] = json.time_key;
    return json.time_key;
  } catch {
    return null;
  }
}

async function fetchDepthColumn(variable, timeKey, lat, lon) {
  const res = await fetch(
    `http://localhost:8000/api/v1/data/${variable}/daily/${timeKey}/column?lat=${lat}&lon=${lon}`
  );
  if (!res.ok) throw new Error('No data');
  const depthLevelsStr = res.headers.get('X-Depth-Levels');
  const depths = depthLevelsStr ? depthLevelsStr.split(',').map(Number) : [];
  const buffer = await res.arrayBuffer();
  const floats = new Float32Array(buffer);
  const depthData = [];
  for (let i = 0; i < floats.length; i++) {
    if (floats[i] !== -9999.0) depthData.push({ depth: Math.round(depths[i] ?? i), val: floats[i] });
  }
  return depthData;
}

export default function MarkModal() {
  const [clickedPoint, setClickedPoint] = useState(null);          // { lat, lon }
  const [position, setPosition]         = useState({ x: -1000, y: -1000, visible: false });
  const [selectedVar, setSelectedVar]   = useState('temperature');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [depthData, setDepthData]       = useState([]);
  const [isDepthLoading, setIsDepthLoading] = useState(false);
  const [hoverInfo, setHoverInfo]       = useState(null);

  const modalRef    = useRef(null);
  const worldPosRef = useRef(null);

  // ── Hover crosshair tooltip ─────────────────────────────────────────────
  useEffect(() => {
    const onHover = (e) => {
      if (!e.detail) { setHoverInfo(null); return; }
      setHoverInfo(e.detail);
    };
    const onToolChange = (e) => { if (e.detail !== 'mark') setHoverInfo(null); };
    window.addEventListener('polaris-mark-hover', onHover);
    window.addEventListener('polaris-tool-changed', onToolChange);
    return () => {
      window.removeEventListener('polaris-mark-hover', onHover);
      window.removeEventListener('polaris-tool-changed', onToolChange);
    };
  }, []);

  // ── Click: open modal and fetch data ────────────────────────────────────
  useEffect(() => {
    const onClick = async (e) => {
      const { lat, lon, worldPos } = e.detail;
      worldPosRef.current = new Cartesian3(worldPos.x, worldPos.y, worldPos.z);

      const varKey = window.polarisActiveOceanVar || 'temperature';
      setSelectedVar(varKey);
      setClickedPoint({ lat, lon });
      setIsDepthLoading(true);
      setDepthData([]);

      try {
        const timeKey = await getLatestKey(varKey);
        if (!timeKey) throw new Error('No dataset');
        const data = await fetchDepthColumn(varKey, timeKey, lat, lon);
        setDepthData(data);
      } catch {
        setDepthData([]);
      } finally {
        setIsDepthLoading(false);
      }
      if (window.cesiumViewer) window.cesiumViewer.scene.requestRender();
    };

    const onDeselect = () => {
      setClickedPoint(null);
      setPosition({ x: -1000, y: -1000, visible: false });
      worldPosRef.current = null;
    };

    window.addEventListener('polaris-mark-click', onClick);
    window.addEventListener('polaris-mark-deselect', onDeselect);
    return () => {
      window.removeEventListener('polaris-mark-click', onClick);
      window.removeEventListener('polaris-mark-deselect', onDeselect);
    };
  }, []);

  // ── Re-fetch when variable dropdown changes ──────────────────────────────
  useEffect(() => {
    if (!clickedPoint) return;
    const refetch = async () => {
      setIsDepthLoading(true);
      setDepthData([]);
      try {
        const timeKey = await getLatestKey(selectedVar);
        if (!timeKey) throw new Error('No dataset');
        const data = await fetchDepthColumn(selectedVar, timeKey, clickedPoint.lat, clickedPoint.lon);
        setDepthData(data);
      } catch {
        setDepthData([]);
      } finally {
        setIsDepthLoading(false);
      }
    };
    refetch();
  }, [selectedVar]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Track modal to 3D point (identical to InstrumentModal) ──────────────
  useEffect(() => {
    if (!clickedPoint) return;

    const onPreRender = () => {
      if (!window.cesiumViewer || !worldPosRef.current) return;
      const scene = window.cesiumViewer.scene;

      const occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, scene.camera.positionWC);
      if (!occluder.isPointVisible(worldPosRef.current)) {
        setPosition(prev => ({ ...prev, visible: false }));
        return;
      }

      const canvasPos = SceneTransforms.worldToWindowCoordinates(scene, worldPosRef.current);
      if (!canvasPos) { setPosition(prev => ({ ...prev, visible: false })); return; }

      // NearFarScalar — exact same constants as InstrumentModal
      const distance = Cartesian3.distance(scene.camera.positionWC, worldPosRef.current);
      const nearDist = 10000, nearScale = 1.0, farDist = 10000000, farScale = 0.5;
      let scale = 1.0;
      if (distance <= nearDist) scale = nearScale;
      else if (distance >= farDist) scale = farScale;
      else scale = nearScale + ((distance - nearDist) / (farDist - nearDist)) * (farScale - nearScale);

      setPosition({
        x: canvasPos.x + (30 * scale),
        y: canvasPos.y - (100 * scale),
        scale,
        visible: true,
        anchorX: canvasPos.x,
        anchorY: canvasPos.y,
      });
    };

    const removeListener = window.cesiumViewer.scene.preRender.addEventListener(onPreRender);
    return () => removeListener();
  }, [clickedPoint]);

  const close = () => window.dispatchEvent(new CustomEvent('polaris-mark-deselect'));
  const varConfig = VAR_MAP[selectedVar] || { label: selectedVar, unit: '', color: '#fff' };

  return (
    <>
      {/* Hover crosshair tooltip — clean white card matching modal theme */}
      {hoverInfo && (
        <div style={{
          position: 'absolute',
          left: hoverInfo.x + 16,
          top:  hoverInfo.y - 38,
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(8px)',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          color: '#0f172a',
          fontSize: '11px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontWeight: 600,
          padding: '6px 12px',
          pointerEvents: 'none',
          zIndex: 6,
          whiteSpace: 'nowrap',
          lineHeight: 1.6,
        }}>
          {Math.abs(hoverInfo.lat).toFixed(4)}° {hoverInfo.lat >= 0 ? 'N' : 'S'}&emsp;
          {Math.abs(hoverInfo.lon).toFixed(4)}° {hoverInfo.lon >= 0 ? 'E' : 'W'}
        </div>
      )}

      {/* SVG connector — identical to InstrumentModal */}
      {clickedPoint && position.visible && (
        <svg style={{
          position: 'absolute', top: 0, left: 0,
          width: '100vw', height: '100vh',
          pointerEvents: 'none', zIndex: 5,
        }}>
          <line
            x1={position.anchorX} y1={position.anchorY - 15}
            x2={position.x}       y2={position.y + 20 * (position.scale || 1)}
            stroke="rgba(255, 255, 255, 0.4)" strokeWidth="1.5"
          />
          <circle cx={position.anchorX} cy={position.anchorY - 15} r="3" fill="#00FFFF" />
        </svg>
      )}

      {/* Modal card — exact same DOM as InstrumentModal */}
      {clickedPoint && (
        <div
          ref={modalRef}
          className={`instrument-modal ${position.visible ? 'visible' : ''}`}
          style={{
            left: position.x,
            top:  position.y,
            transform: `scale(${position.scale || 1})`,
            transformOrigin: 'top left',
          }}
        >
          {/* Header */}
          <div className="modal-header">
            <div className="modal-title-group">
              <span className="inst-badge">OCEAN PROBE</span>
              <h3 className="inst-id">
                {Math.abs(clickedPoint.lat).toFixed(4)}° {clickedPoint.lat >= 0 ? 'N' : 'S'}&nbsp;&nbsp;
                {Math.abs(clickedPoint.lon).toFixed(4)}° {clickedPoint.lon >= 0 ? 'E' : 'W'}
              </h3>
            </div>
            <button className="close-btn" onClick={close}><X size={14} /></button>
          </div>

          {/* Meta row — lat/lon on one line, no timestamp */}
          <div className="modal-meta">
            <div>
              <span className="meta-lbl">LAT:</span> {Math.abs(clickedPoint.lat).toFixed(4)}° {clickedPoint.lat >= 0 ? 'N' : 'S'}
              &emsp;
              <span className="meta-lbl">LON:</span> {Math.abs(clickedPoint.lon).toFixed(4)}° {clickedPoint.lon >= 0 ? 'E' : 'W'}
            </div>
          </div>

          {/* Variable dropdown — same .custom-dropdown markup as InstrumentModal */}
          <div className="modal-controls">
            <div className="custom-dropdown" onClick={() => setIsDropdownOpen(!isDropdownOpen)}>
              <div className="dropdown-selected">
                {VAR_MAP[selectedVar]?.label || selectedVar}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`dropdown-arrow ${isDropdownOpen ? 'open' : ''}`}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            {isDropdownOpen && (
                <div className="dropdown-options">
                  {ALL_VARS.map(v => (
                    <div
                      key={v}
                      className={`dropdown-option ${selectedVar === v ? 'selected' : ''}`}
                      onClick={() => { setSelectedVar(v); setIsDropdownOpen(false); }}
                    >
                      {VAR_MAP[v]?.label || v}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Body — same .modal-body with chart-card sections */}
          <div className="modal-body custom-scrollbar">
            {/* Depth vs Variable — exact same chart as InstrumentModal */}
            <div className="chart-card">
              <div className="chart-title">
                Depth vs. {varConfig.label}
                <span className="unit"> ({varConfig.unit})</span>
              </div>
              {isDepthLoading ? (
                <div className="empty-chart">Loading high-res depth profile...</div>
              ) : depthData.length > 0 ? (
                <div className="chart-wrap" style={{ width: '100%', height: '160px', marginLeft: '-20px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={depthData} layout="vertical" margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                      <XAxis
                        type="number" dataKey="val" domain={['auto', 'auto']}
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        axisLine={{ stroke: '#cbd5e1' }} tickLine={false}
                        tickFormatter={(t) => t.toFixed(1)}
                      />
                      <YAxis
                        type="number" dataKey="depth" reversed domain={[0, 'auto']}
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        axisLine={{ stroke: '#cbd5e1' }} tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '11px', color: '#0f172a', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
                        formatter={(value, name) => [
                          typeof value === 'number' ? (name === 'val' ? value.toFixed(3) : value.toFixed(1)) : value,
                          name === 'val' ? varConfig.label : 'Depth'
                        ]}
                        labelFormatter={(d) => `Depth: ${d} m`}
                        labelStyle={{ color: '#64748b', marginBottom: '4px', fontWeight: 600 }}
                      />
                      <Line
                        type="monotone" dataKey="val"
                        stroke={varConfig.color} strokeWidth={2}
                        dot={false} activeDot={{ r: 4, strokeWidth: 0 }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="empty-chart">No ocean data at this location</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
