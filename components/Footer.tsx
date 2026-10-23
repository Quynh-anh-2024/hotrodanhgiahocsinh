
import React from 'react';

const Footer: React.FC = () => {
  return (
    <footer className="bg-white border-t border-cyan-50 py-10 mt-12">
      <div className="max-w-7xl mx-auto px-4 text-center">
        <div className="inline-block p-1 px-4 rounded-full bg-[#e6fcf5] text-[#087f5b] text-xs font-black uppercase tracking-widest mb-4">
          Thầy Hải - Trường PTDTBT TH Giàng Chu Phìn
        </div>
        <p className="text-[11px] text-slate-500 font-medium uppercase tracking-tighter max-w-md mx-auto leading-relaxed">
          Công cụ hỗ trợ giáo viên soạn thảo nội dung đánh giá định kỳ. 
          Vui lòng kiểm tra lại sự phù hợp trước khi nhập vào hệ thống chính thức.
        </p>
      </div>
    </footer>
  );
};

export default Footer;
