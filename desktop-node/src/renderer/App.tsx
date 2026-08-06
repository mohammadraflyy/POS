import { HashRouter, Routes, Route } from 'react-router-dom'
import { Login } from './pages/Login'
import { Home } from './pages/Home'

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Home />} />
      </Routes>
    </HashRouter>
  )
}

export default App
