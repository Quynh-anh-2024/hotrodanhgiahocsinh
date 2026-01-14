
import React from 'react';

const Footer: React.FC = () => {
  return (
    <footer className="bg-white border-t border-cyan-50 py-10 mt-12">
      <div className="max-w-7xl mx-auto px-4 text-center">
        <div className="inline-block p-1 px-4 rounded-full bg-cyan-50 text-cyan-700 text-xs font-black uppercase tracking-widest mb-4">
          Thầy Hải - Trường PTDTBT TH Giàng Chu Phìn
        </div>
        <p className="text-[10px] text-slate-400 font-medium uppercase tracking-tighter max-w-md mx-auto leading-relaxed">
          Công cụ hỗ trợ giáo viên soạn thảo nội dung đánh giá định kỳ. 
          Vui lòng kiểm tra lại sự phù hợp trước khi nhập vào hệ thống chính thức.
        </p>
      </div>
    </footer>
  );
};

export default Footer;
