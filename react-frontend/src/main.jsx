import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Global CSS (reset can be adjusted/removed after full migration)
import './index.css'
// Bootstrap and legacy theme CSS
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import '@assets/css/styles.css'
import '@assets/css/additional-style.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
