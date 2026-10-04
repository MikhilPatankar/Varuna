import React, { useState, useEffect, useRef } from 'react';
import { Cartesian3, SceneTransforms, EllipsoidalOccluder, Ellipsoid } from 'cesium';
import { X, AlertTriangle, Wind, Gauge, Calendar, Navigation } from 'lucide-react';
import './InstrumentModal.css'; // Reusing the same CSS for identical UI!

export default function DisasterModal() {
  const [data, setData] = useState(null);
  const [position, setPosition] = useState({ x: -1000, y: -1000, visible: false });
  const modalRef = useRef(null);
  const currentPosRef = useRef(null);

  useEffect(() => {
    const handleSelect = (e) => {
      const payload = e.detail;
      if (!payload) return;

      setData(payload);
      
      let lat, lon;
      if (payload.hazardType === 'Cyclone Tracking' && payload.current_position) {
        lat = payload.current_position.lat;
        lon = payload.current_position.lon;
      } else {
        lat = payload.lat;
        lon = payload.lon;
      }

      currentPosRef.current = Cartesian3.fromDegrees(parseFloat(lon), parseFloat(lat), 3000);
      if (window.cesiumViewer) window.cesiumViewer.scene.requestRender();
    };

    const handleDeselect = () => {
      setData(null);
      setPosition({ x: -1000, y: -1000, visible: false });
      currentPosRef.current = null;
    };

    window.addEventListener('varuna-disaster-select', handleSelect);
    window.addEventListener('varuna-disaster-deselect', handleDeselect);

    return () => {
      window.removeEventListener('varuna-disaster-select', handleSelect);
      window.removeEventListener('varuna-disaster-deselect', handleDeselect);
    };
  }, []);

  // Sync with Cesium camera movement (Same math as InstrumentModal)
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
        const distance = Cartesian3.distance(scene.camera.positionWC, currentPosRef.current);
        const nearDist = 10000;
        const nearScale = 1.0;
        const farDist = 10000000;
        const farScale = 0.5;
        
        let scale = 1.0;
        if (distance <= nearDist) scale = nearScale;
        else if (distance >= farDist) scale = farScale;
        else {
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

  const close = () => {
    window.dispatchEvent(new CustomEvent('varuna-disaster-deselect'));
  };

  if (!data) return null;

  const isCyclone = data.hazardType === 'Cyclone Tracking';

  return (
    <>
      {position.visible && (
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 5 }}>
          <line x1={position.anchorX} y1={position.anchorY} x2={position.x} y2={position.y + 20 * (position.scale || 1)} stroke="rgba(148, 163, 184, 0.6)" strokeWidth="1.5" />
        </svg>
      )}

      <div ref={modalRef} className={`instrument-modal ${position.visible ? 'visible' : ''}`} style={{ left: position.x, top: position.y, transform: `scale(${position.scale || 1})`, transformOrigin: 'top left' }}>
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="inst-badge" style={{ background: '#fee2e2', color: '#ef4444', textTransform: 'uppercase', fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px' }}>
              {data.hazardType}
            </span>
            <h3 className="inst-id">{data.name || data.cyclone_id || 'Unknown Event'}</h3>
          </div>
          <button className="close-btn" onClick={close}><X size={14} /></button>
        </div>

        <div className="modal-meta" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {isCyclone ? (
            <>
              <div><span className="meta-lbl"><Calendar size={12}/> LAST OBSERVED:</span> {data.current_position?.time || 'N/A'}</div>
              <div><span className="meta-lbl"><Navigation size={12}/> BASIN:</span> {data.basin}</div>
              <div><span className="meta-lbl">LAT:</span> {parseFloat(data.current_position?.lat || 0).toFixed(4)}° N</div>
              <div><span className="meta-lbl">LON:</span> {parseFloat(data.current_position?.lon || 0).toFixed(4)}° E</div>
            </>
          ) : (
            <>
              <div><span className="meta-lbl"><AlertTriangle size={12}/> SEVERITY:</span> {data.severity || 'Unknown'}</div>
              <div><span className="meta-lbl"><Calendar size={12}/> START:</span> {data.start_time}</div>
              {data.end_time && <div><span className="meta-lbl"><Calendar size={12}/> END:</span> {data.end_time}</div>}
              <div><span className="meta-lbl">LAT:</span> {parseFloat(data.lat || 0).toFixed(4)}° N</div>
              <div><span className="meta-lbl">LON:</span> {parseFloat(data.lon || 0).toFixed(4)}° E</div>
            </>
          )}
        </div>

        {isCyclone && data.current_position && (
          <div className="modal-body custom-scrollbar">
             <div style={{ padding: '4px' }}>
               <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                 
                 <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '10px', borderRadius: '6px', textAlign: 'center' }}>
                    <Wind size={16} color="#3b82f6" style={{ margin: '0 auto 4px auto' }} />
                    <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 600, letterSpacing: '0.5px' }}>MAX WIND</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#0f172a' }}>
                      {parseFloat(data.current_position.wind_kts).toFixed(1)} <span style={{ fontSize: '10px', color: '#64748b' }}>KTS</span>
                    </div>
                 </div>

                 <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '10px', borderRadius: '6px', textAlign: 'center' }}>
                    <Gauge size={16} color="#10b981" style={{ margin: '0 auto 4px auto' }} />
                    <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 600, letterSpacing: '0.5px' }}>MIN PRESSURE</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#0f172a' }}>
                      {parseFloat(data.current_position.pressure_hpa).toFixed(1)} <span style={{ fontSize: '10px', color: '#64748b' }}>hPa</span>
                    </div>
                 </div>

               </div>
               {data.current_position.category && (
                 <div style={{ marginTop: '10px', textAlign: 'center', background: '#fee2e2', color: '#ef4444', padding: '6px', borderRadius: '4px', fontSize: '12px', fontWeight: '600' }}>
                   Category: {data.current_position.category}
                 </div>
               )}
             </div>
          </div>
        )}
      </div>
    </>
  );
}
