import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Quan trọng: Ép tên file đầu ra để trình duyệt không bị tìm nhầm
      filename: 'sw.js', 
      manifestFilename: 'manifest.json',
      
      includeAssets: ['logo.svg', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'Trợ Lý Đánh Giá',
        short_name: 'DanhGiaHS',
        description: 'Hỗ trợ giáo viên đánh giá học sinh theo Thông tư 27',
        theme_color: '#20c997',
        background_color: '#e6fcf5',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        orientation: 'portrait',
        icons: [
          {
            src: 'pwa-192x192.png', // Đảm bảo trùng tên file trong thư mục public
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png', // Đảm bảo trùng tên file trong thư mục public
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      devOptions: {
        enabled: true, // Cho phép hiện nút cài đặt ngay cả khi chạy local
        type: 'module',
      }
    })
  ]
});
