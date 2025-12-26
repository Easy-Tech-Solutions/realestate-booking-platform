import { BrowserRouter } from 'react-router-dom'
import AppRoutes from '@routes/AppRoutes'
import MainLayout from '@components/layout/MainLayout'
import { AuthProvider } from '@contexts/AuthContext'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <MainLayout>
          <AppRoutes />
        </MainLayout>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
