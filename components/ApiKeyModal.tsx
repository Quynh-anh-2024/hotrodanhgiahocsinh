
import React, { useState, useEffect } from 'react';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (key: string) => void;
}

const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onClose, onSave }) => {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const isKeySaved = !!localStorage.getItem('user_api_key');

  useEffect(() => {
    const savedKey = localStorage.getItem('user_api_key');
    if (savedKey) setApiKey(savedKey);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (apiKey.trim()) {
      localStorage.setItem('user_api_key', apiKey.trim());
      onSave(apiKey.trim());
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 overflow-y-auto bg-black/50 backdrop-blur-sm">
      {/* Background overlay - block dismiss if no key */}
      <div 
        className="fixed inset-0" 
        onClick={() => {
          if (isKeySaved) onClose();
        }}
      ></div>
      
      <div className="relative bg-white w-full max-w-[500px] rounded-[24px] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.2)] animate-in zoom-in-95 duration-200">
        {/* Header - Bright Blue Gradient as in image */}
        <div className="bg-[#4e54f3] px-8 py-7 text-white relative">
          <div className="flex items-center space-x-3 mb-1">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            <h2 className="text-[22px] font-bold tracking-tight">Cấu hình API Key</h2>
          </div>
          <p className="text-blue-100/90 text-[14px]">Kết nối với Google Gemini để bắt đầu</p>
          
          {/* Close button - only show if key already exists */}
          {isKeySaved && (
            <button 
              onClick={onClose}
              className="absolute right-6 top-7 text-white/50 hover:text-white transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="p-8 space-y-7">
          {/* Instructions Box - Light Blue Box matching image */}
          <div className="bg-[#f0f7ff] border border-[#e1effe] rounded-[16px] p-6">
            <div className="flex items-center space-x-2 mb-4">
              <svg className="w-5 h-5 text-[#4e54f3]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6.11a11.957 11.957 0 005.621 12.863A11.955 11.955 0 0012 21.75c2.158 0 4.198-.57 5.961-1.577a11.959 11.959 0 005.621-12.863A11.959 11.959 0 0112 2.714z" />
              </svg>
              <h3 className="text-[#1e3a8a] font-bold text-[15px]">Hướng dẫn lấy Key miễn phí:</h3>
            </div>
            
            <ol className="space-y-3 text-[14px] text-[#4b5563] ml-1">
              <li className="flex items-start">
                <span className="mr-2 text-[#4b5563]">1.</span>
                <span>Truy cập <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer" className="text-[#4e54f3] font-bold hover:underline inline-flex items-center">Google AI Studio <svg className="w-3.5 h-3.5 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>.</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-[#4b5563]">2.</span>
                <span>Đăng nhập bằng tài khoản Google của bạn.</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-[#4b5563]">3.</span>
                <span>Nhấn nút <strong className="text-[#111827]">"Create API key"</strong>.</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-[#4b5563]">4.</span>
                <span>Copy đoạn mã bắt đầu bằng <code className="font-mono text-[#4e54f3] font-bold">AIza...</code> và dán vào ô bên dưới.</span>
              </li>
            </ol>
            
            <p className="mt-5 text-[11px] text-[#6b7280] italic leading-relaxed">
              * Key của bạn được lưu trực tiếp trên trình duyệt này, chúng tôi không thu thập thông tin của bạn.
            </p>
          </div>

          {/* Input Section */}
          <div className="space-y-3">
            <label className="text-[14px] font-bold text-[#374151] block ml-1">Dán API Key của bạn vào đây</label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full bg-white border border-[#d1d5db] rounded-[12px] px-5 py-4 text-[15px] outline-none focus:border-[#4e54f3] transition-all pr-12 text-[#111827]"
              />
              <button 
                onClick={() => setShowKey(!showKey)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#9ca3af] hover:text-[#4e54f3] transition-colors p-1"
              >
                {showKey ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.644C3.399 8.049 7.063 4.5 12 4.5c4.938 0 8.601 3.549 9.964 7.178.07.186.07.382 0 .568-1.363 4.129-5.026 7.678-9.964 7.678-4.938 0-8.601-3.549-9.964-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                )}
              </button>
            </div>
          </div>

          {/* Action Button - Greyish as in image */}
          <button
            disabled={!apiKey.trim()}
            onClick={handleSave}
            className={`w-full py-4 rounded-[12px] font-bold text-[16px] flex items-center justify-center space-x-2 transition-all shadow-sm active:scale-[0.98] ${
              apiKey.trim() 
              ? 'bg-[#d1d5db] text-[#4b5563] hover:bg-[#c4c9d1]' 
              : 'bg-[#e5e7eb] text-[#9ca3af] cursor-not-allowed shadow-none'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            <span>Xác thực & Lưu</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ApiKeyModal;
