
import React from 'react';

interface HeaderProps {
  onOpenConfig: () => void;
}

const Header: React.FC<HeaderProps> = ({ onOpenConfig }) => {
  return (
    <header className="bg-white/80 backdrop-blur-md border-b border-cyan-100 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20">
          <div className="w-10"></div> {/* Spacer */}
          
          <div className="flex flex-col items-center text-center">
            <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-600 to-blue-600 leading-tight uppercase tracking-widest">
              Hệ thống nhận xét học sinh
            </h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.3em] mt-1">
              Thông tư 27 & Chương trình GDPT 2018
            </p>
          </div>

          <button 
            onClick={onOpenConfig}
            className="flex items-center space-x-2 px-4 py-2.5 rounded-2xl bg-slate-50 hover:bg-red-50 transition-all shadow-sm border border-slate-100 group"
            title="Cấu hình API Key"
          >
            <span className="text-[11px] font-black text-red-500 uppercase tracking-widest">Lấy API</span>
            <svg className="w-6 h-6 text-slate-400 group-hover:text-red-500 transition-all group-hover:rotate-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
