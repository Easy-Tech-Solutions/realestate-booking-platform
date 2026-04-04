import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

<<<<<<< HEAD
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> origin/jake
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
=======
<<<<<<< HEAD
=======
>>>>>>> dalton
=======
>>>>>>> origin/jake
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  publicDir: path.resolve(__dirname, '../html-frontend'),
<<<<<<< HEAD
<<<<<<< HEAD
>>>>>>> main
=======
>>>>>>> dalton
=======
>>>>>>> main
>>>>>>> origin/jake
  resolve: {
    alias: {
      '@assets': path.resolve(__dirname, './src/assets'),
      '@components': path.resolve(__dirname, './src/components'),
      '@contexts': path.resolve(__dirname, './src/contexts'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@routes': path.resolve(__dirname, './src/routes'),
      '@services': path.resolve(__dirname, './src/services'),
      '@utils': path.resolve(__dirname, './src/utils'),
<<<<<<< HEAD
<<<<<<< HEAD
<<<<<<< HEAD
=======
      '@legacyCss': path.resolve(__dirname, '../html-frontend/assets/css'),
>>>>>>> main
=======
      '@legacyCss': path.resolve(__dirname, '../html-frontend/assets/css'),
>>>>>>> dalton
=======
=======
      '@legacyCss': path.resolve(__dirname, '../html-frontend/assets/css'),
>>>>>>> main
>>>>>>> origin/jake
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: [],
  },
  server: {
    fs: {
      // Allow importing CSS/assets from the legacy static frontend folder
      allow: [
        path.resolve(__dirname),
        path.resolve(__dirname, '..'),
<<<<<<< HEAD
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> origin/jake
        path.resolve(__dirname, '../frontend'),
=======
        path.resolve(__dirname, '../html-frontend'),
>>>>>>> main
<<<<<<< HEAD
=======
        path.resolve(__dirname, '../html-frontend'),
>>>>>>> dalton
=======
>>>>>>> origin/jake
      ],
    },
  },
})
