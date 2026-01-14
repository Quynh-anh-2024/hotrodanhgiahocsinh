
import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="bg-white/80 backdrop-blur-md border-b border-cyan-100 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-center items-center h-20">
          <div className="flex flex-col items-center text-center">
            <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-600 to-blue-600 leading-tight uppercase tracking-widest">
              Hệ thống nhận xét học sinh
            </h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.3em] mt-1">
              Thông tư 27 & Chương trình GDPT 2018
            </p>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
