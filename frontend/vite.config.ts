import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  define: {
    'process.env': {},
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }

          if (id.includes('react-leaflet') || id.includes('/leaflet/')) {
            return 'map-vendor';
          }

          if (id.includes('recharts') || id.includes('/d3-')) {
            return 'charts-vendor';
          }

          if (id.includes('@tanstack/react-query')) {
            return 'query-vendor';
          }

          if (id.includes('react-day-picker') || id.includes('date-fns')) {
            return 'calendar-vendor';
          }

          if (id.includes('motion')) {
            return 'motion-vendor';
          }

          if (id.includes('@radix-ui') || id.includes('cmdk') || id.includes('vaul')) {
            return 'ui-vendor';
          }

          if (id.includes('react-router')) {
            return 'router-vendor';
          }

          return undefined;
        },
      },
    },
  },
})
