import { HashRouter, Routes, Route } from 'react-router-dom'
import { Login } from './pages/Login'
import { Kasir } from './pages/Kasir'
import { KasirHistory } from './pages/KasirHistory'
import { BonPayment } from './pages/BonPayment'
import { SaleDetail } from './pages/SaleDetail'
import { Settings } from './pages/Settings'
import { Inventory } from './pages/Inventory'
import { MassInput } from './pages/inventory/MassInput'
import { ProductDetail } from './pages/inventory/ProductDetail'
import { Supplier } from './pages/Supplier'
import { MasterSatuan } from './pages/MasterSatuan'
import { Users } from './pages/Users'
import { Purchase } from './pages/Purchase'
import { HutangSupplier } from './pages/HutangSupplier'
import { Pengeluaran } from './pages/Pengeluaran'
import { StockOpname } from './pages/StockOpname'
import { Rekap } from './pages/Rekap'
import { Dashboard } from './pages/Dashboard'

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Dashboard />} />
        <Route path="/kasir" element={<Kasir />} />
        <Route path="/history" element={<KasirHistory />} />
        <Route path="/bon-payment/:saleId" element={<BonPayment />} />
        <Route path="/sale/:saleId" element={<SaleDetail />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/inventory/mass-input" element={<MassInput />} />
        {/* declared after mass-input so the literal segment always wins over :productId */}
        <Route path="/inventory/:productId" element={<ProductDetail />} />
        <Route path="/supplier" element={<Supplier />} />
        <Route path="/master-satuan" element={<MasterSatuan />} />
        <Route path="/purchase" element={<Purchase />} />
        <Route path="/hutang-supplier" element={<HutangSupplier />} />
        <Route path="/pengeluaran" element={<Pengeluaran />} />
        <Route path="/stock-opname" element={<StockOpname />} />
        <Route path="/rekap" element={<Rekap />} />
        <Route path="/users" element={<Users />} />
      </Routes>
    </HashRouter>
  )
}

export default App
