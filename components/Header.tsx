
import React, { useState, useEffect } from 'react';

interface HeaderProps {
  onOpenConfig: () => void;
}

const Header: React.FC<HeaderProps> = ({ onOpenConfig }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  return (
    <header className="bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-[#20c997]/10">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex justify-between items-center">
          
          <div className="flex flex-col">
            <h1 className="text-xl font-extrabold text-[#20c997] uppercase tracking-wider flex items-center gap-2">
              <span className="w-8 h-8 bg-[#20c997] text-white rounded-lg flex items-center justify-center text-lg shadow-lg shadow-[#20c997]/30">AI</span>
              Hệ thống nhận xét
            </h1>
            <p className="text-[11px] text-slate-400 font-bold mt-1 tracking-widest pl-10">
              Thông tư 27 & GDPT 2018
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Install Button */}
            {deferredPrompt && (
              <button 
                onClick={handleInstallClick}
                className="hidden md:flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#ffc107] hover:bg-[#ffca2c] text-slate-900 transition-all shadow-md font-bold text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Cài đặt App</span>
              </button>
            )}

            <button 
              onClick={onOpenConfig}
              className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-white border-2 border-[#20c997]/20 hover:border-[#20c997] transition-all group shadow-sm text-slate-600 hover:text-[#20c997]"
              title="Cấu hình API Key"
            >
              <svg className="w-5 h-5 transition-transform group-hover:rotate-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              <span className="text-xs font-bold uppercase tracking-wider">Cấu hình API</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
