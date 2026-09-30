import React, { useState } from 'react';
import { 
  MousePointer2, 
  Hand, 
  Orbit, 
  MapPin, 
  BoxSelect, 
  Clock,
  ChevronUp,
  Play,
  SkipBack,
  SkipForward,
  Pause
} from 'lucide-react';
import './BottomToolbar.css';

export default function BottomToolbar() {
  const [activeTool, setActiveTool] = useState('select');
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [timePeriod, setTimePeriod] = useState('year'); // 'month', 'year', 'decade'
  const [isPeriodDropdownOpen, setIsPeriodDropdownOpen] = useState(false);
  const [sliderValue, setSliderValue] = useState(12);

  // Dispatch event whenever the tool changes so GlobeView can react
  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent('polaris-tool-changed', { detail: activeTool }));
  }, [activeTool]);

  const tools = [
    { id: 'select', icon: MousePointer2, tooltip: 'Standard Selection' },
    { id: 'pan', icon: Hand, tooltip: 'Pan Globe' },
    { id: 'rotate', icon: Orbit, tooltip: 'Rotate 3D' },
    { id: 'mark', icon: MapPin, tooltip: 'Mark Location' },
    { id: 'box', icon: BoxSelect, tooltip: 'Isosurface Extraction' },
    { id: 'timeline', icon: Clock, tooltip: 'Time Step Animation' },
  ];

  const maxSteps = timePeriod === 'month' ? 30 : timePeriod === 'year' ? 12 : 10;
  
  // Keep sliderValue in bounds when timePeriod changes
  React.useEffect(() => {
    setSliderValue(maxSteps);
  }, [timePeriod, maxSteps]);

  // Calculate percentage for tooltip position (0 to 100)
  const percent = maxSteps > 1 ? ((sliderValue - 1) / (maxSteps - 1)) * 100 : 100;
  
  // Calculate a fake date based on slider (ending at 2026-09-30)
  const getDisplayDate = () => {
    const end = new Date(2026, 8, 30); // Sept 30, 2026
    const stepDiff = maxSteps - sliderValue;
    if (timePeriod === 'month') {
      end.setDate(end.getDate() - stepDiff);
      return end.toISOString().split('T')[0];
    } else if (timePeriod === 'year') {
      end.setMonth(end.getMonth() - stepDiff);
      return end.toISOString().split('T')[0].slice(0, 7); // YYYY-MM
    } else {
      end.setFullYear(end.getFullYear() - stepDiff);
      return end.getFullYear().toString();
    }
  };

  return (
    <div className="bottom-toolbar-container">
      {/* Timeline Player Modal (Pops up above toolbar) */}
      {isTimelineOpen && (
        <div className="toolbar-popup timeline-player-bar">
          <div className="player-main">
            <div className="player-top-row">
              <div className="scrubber-container">
                <input 
                  type="range" 
                  min="1" 
                  max={maxSteps} 
                  value={sliderValue}
                  onChange={(e) => setSliderValue(Number(e.target.value))}
                  step="1"
                  className="player-scrubber" 
                />
                <div 
                  className="scrubber-thumb-tooltip" 
                  style={{ 
                    left: `calc(${percent}% + (${8 - percent * 0.16}px))` // Adjust for thumb width
                  }}
                >
                  {getDisplayDate()}
                </div>
                <div className="scrubber-ticks">
                  {timePeriod === 'month' && (
                    <><span>Day 1</span><span>Day 15</span><span>Day 30</span></>
                  )}
                  {timePeriod === 'year' && (
                    <><span>Jan</span><span>Apr</span><span>Jul</span><span>Oct</span><span>Dec</span></>
                  )}
                  {timePeriod === 'decade' && (
                    <><span>2016</span><span>2021</span><span>2026</span></>
                  )}
                </div>
              </div>
            </div>
            <div className="player-bottom-row">
              <div style={{ width: '120px' }}></div> {/* Spacer to center controls */}
              <div className="player-controls">
                <button className="player-btn"><SkipBack size={16} strokeWidth={2.5} /></button>
                <button className="player-btn play-btn"><Play size={18} fill="currentColor" strokeWidth={2} /></button>
                <button className="player-btn"><SkipForward size={16} strokeWidth={2.5} /></button>
              </div>
              <div className="period-dropdown-container">
                <button 
                  className="period-dropdown-btn" 
                  onClick={() => setIsPeriodDropdownOpen(!isPeriodDropdownOpen)}
                >
                  {timePeriod === 'month' ? 'Last Month' : timePeriod === 'year' ? 'Last Year' : 'Last Decade'}
                  <ChevronUp size={14} className={`dropdown-icon ${isPeriodDropdownOpen ? 'open' : ''}`} />
                </button>
                {isPeriodDropdownOpen && (
                  <div className="period-dropdown-menu">
                    <div className={`period-option ${timePeriod === 'month' ? 'active' : ''}`} onClick={() => { setTimePeriod('month'); setIsPeriodDropdownOpen(false); }}>Last Month</div>
                    <div className={`period-option ${timePeriod === 'year' ? 'active' : ''}`} onClick={() => { setTimePeriod('year'); setIsPeriodDropdownOpen(false); }}>Last Year</div>
                    <div className={`period-option ${timePeriod === 'decade' ? 'active' : ''}`} onClick={() => { setTimePeriod('decade'); setIsPeriodDropdownOpen(false); }}>Last Decade</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Toolbar */}
      <div className="toolbar">
        {tools.map(tool => {
          const Icon = tool.icon;
          const isActive = tool.id === 'timeline' ? isTimelineOpen : activeTool === tool.id;
          return (
            <button
              key={tool.id}
              className={`tool-btn ${isActive ? 'active' : ''}`}
              onClick={() => {
                if (tool.id === 'timeline') {
                  setIsTimelineOpen(!isTimelineOpen);
                } else {
                  setActiveTool(tool.id);
                }
              }}
              data-tooltip={tool.tooltip}
            >
              <Icon size={16} strokeWidth={isActive ? 2.5 : 2} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
