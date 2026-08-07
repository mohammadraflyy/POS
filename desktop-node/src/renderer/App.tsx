import { HashRouter, Routes, Route } from 'react-router-dom'
import { Login } from './pages/Login'
import { Kasir } from './pages/Kasir'
import { KasirHistory } from './pages/KasirHistory'
import { BonPayment } from './pages/BonPayment'
import { Settings } from './pages/Settings'
import { Inventory } from './pages/Inventory'
import { MassInput } from './pages/inventory/MassInput'

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Kasir />} />
        <Route path="/history" element={<KasirHistory />} />
        <Route path="/bon-payment/:saleId" element={<BonPayment />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/inventory/mass-input" element={<MassInput />} />
      </Routes>
    </HashRouter>
  )
}

export default App
