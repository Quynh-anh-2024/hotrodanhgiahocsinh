
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerSW } from 'virtual:pwa-register';

// Tự động đăng ký SW và xử lý cập nhật
const updateSW = registerSW({
  onNeedRefresh() {
    // Tùy chọn: Hiển thị thông báo cho người dùng reload
    // Hiện tại để autoUpdate nên thường SW sẽ tự claim clients
    console.log('Phát hiện nội dung mới, ứng dụng đã sẵn sàng để cập nhật.');
  },
  onOfflineReady() {
    console.log('Ứng dụng đã sẵn sàng hoạt động offline.');
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
