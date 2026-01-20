
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.svg', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'Trợ Lý Đánh Giá',
        short_name: 'DanhGiaHS',
        description: 'Ứng dụng hỗ trợ giáo viên đánh giá học sinh tiểu học theo Thông tư 27.',
        theme_color: '#20c997',
        background_color: '#e6fcf5',
        display: 'standalone',
        orientation: 'portrait-primary',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,txt}']
      }
    })
  ]
})
