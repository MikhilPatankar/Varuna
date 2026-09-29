import GlobeView from './components/GlobeView'
import Dashboard from './components/ui/Dashboard'
import InstrumentModal from './components/ui/InstrumentModal'
import './styles/global.css'

export default function App() {
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <GlobeView />
      <Dashboard />
      <InstrumentModal />
    </div>
  )
}
