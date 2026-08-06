import { useState } from 'react'
import logo from './assets/electron-vite.svg'
import './App.css'

function App(): JSX.Element {
  const [count, setCount] = useState(0)

  return (
    <>
      <div>
        <a href="https://electron-vite.org" target="_blank" rel="noreferrer">
          <img src={logo} className="logo" alt="Electron Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank" rel="noreferrer">
          <img src="/react.svg" className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Electron + Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/renderer/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Electron and React logos to learn more
      </p>
    </>
  )
}

export default App
