import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Global CSS (reset can be adjusted/removed after full migration)
import './index.css'
// Bootstrap and legacy theme CSS
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import '@assets/css/styles.css'
<<<<<<< HEAD
<<<<<<< HEAD
<<<<<<< HEAD
import '@assets/css/additional-style.css'
=======
>>>>>>> main
=======
>>>>>>> dalton
=======
import '@assets/css/additional-style.css'
=======
>>>>>>> main
>>>>>>> origin/jake
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
