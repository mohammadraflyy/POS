import { HashRouter, Routes, Route } from 'react-router-dom'
import { Login } from './pages/Login'
import { Kasir } from './pages/Kasir'
import { KasirHistory } from './pages/KasirHistory'
import { BonPayment } from './pages/BonPayment'

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Kasir />} />
        <Route path="/history" element={<KasirHistory />} />
        <Route path="/bon-payment/:saleId" element={<BonPayment />} />
      </Routes>
    </HashRouter>
  )
}

export default App
