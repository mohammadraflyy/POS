import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initializeTheme } from './hooks/use-appearance'
import './assets/main.css'

initializeTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
