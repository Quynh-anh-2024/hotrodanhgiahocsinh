
import React, { useState, useRef, useEffect } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import ApiKeyModal from './components/ApiKeyModal';
import { StudentRecord, AchievementLevel, GenerationConfig, Grade, SUBJECT_MAP, EvaluationBasis, Term } from './types';
import { generateComments } from './services/geminiService';
import * as XLSX from 'xlsx';

const GRADE_COLORS: Record<Grade, string> = {
  '1': 'bg-rose-500',
  '2': 'bg-sky-500',
  '3': 'bg-emerald-500',
  '4': 'bg-amber-500',
  '5': 'bg-violet-500'
};

const TERMS: Term[] = ['Giữa học kỳ 1', 'Cuối học kỳ 1', 'Giữa học kỳ 2', 'Cuối học kỳ 2'];

const App: React.FC = () => {
  const [records, setRecords] = useState<StudentRecord[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Kiểm tra khóa API ngay lập tức
  const [isConfigOpen, setIsConfigOpen] = useState(() => {
    const savedKey = localStorage.getItem('user_api_key');
    return !savedKey && !process.env.API_KEY;
  });
  
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [config, setConfig] = useState<GenerationConfig>({
    tone: 'encouraging',
    includeWeakness: true,
    subjectContext: 'Tiếng Việt',
    grade: '1',
    evaluationBasis: 'both',
    term: 'Cuối học kỳ 1'
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const availableSubjects = SUBJECT_MAP[config.grade];
    if (!availableSubjects.includes(config.subjectContext)) {
      setConfig(prev => ({ ...prev, subjectContext: availableSubjects[0] }));
    }
  }, [config.grade]);

  const handleCopy = (text: string, id: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopyStatus(id);
      setTimeout(() => setCopyStatus(null), 2000);
    });
  };

  const normalizeKey = (key: string) => key?.toLowerCase().trim().replace(/\s+/g, '') || '';

  const findValueByPossibleKeys = (item: any, possibleKeys: string[]) => {
    const itemKeys = Object.keys(item);
    const normalizedPossibleKeys = possibleKeys.map(k => normalizeKey(k));
    
    for (const rawKey of itemKeys) {
      const normalizedRawKey = normalizeKey(rawKey);
      if (normalizedPossibleKeys.includes(normalizedRawKey)) {
        const val = item[rawKey];
        if (val === undefined || val === null) return null;
        return val.toString().trim();
      }
    }
    return null;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: null }) as any[];

        if (!rawData || rawData.length === 0) {
          setErrorMessage("Tệp Excel này không có dữ liệu.");
          return;
        }

        const nameKeys = ['Họ và tên', 'Họ tên', 'Tên học sinh', 'Full Name', 'Họ & tên'];
        const levelKeys = ['Mức đạt được', 'Mức đạt', 'Xếp loại', 'Level', 'Mức'];
        const scoreKeys = ['Điểm KTĐK', 'Điểm số', 'Điểm', 'Score', 'Điểm KT', 'Kết quả'];

        const validRows = rawData.filter(item => findValueByPossibleKeys(item, nameKeys));

        if (validRows.length === 0) {
          setErrorMessage(`Không tìm thấy cột tên học sinh. Vui lòng kiểm tra lại tiêu đề cột.`);
          return;
        }

        const mappedRecords: StudentRecord[] = validRows.map((item, index) => {
          const name = findValueByPossibleKeys(item, nameKeys);
          const score = findValueByPossibleKeys(item, scoreKeys) || "0";
          const levelRaw = (findValueByPossibleKeys(item, levelKeys) || "H").toUpperCase();
          
          let level = AchievementLevel.H;
          if (levelRaw.includes('T')) level = AchievementLevel.T;
          else if (levelRaw.includes('C')) level = AchievementLevel.C;

          return {
            id: `st-${index}-${Date.now()}`,
            name: name || `Học sinh ${index + 1}`,
            subject: config.subjectContext,
            score: score,
            level: level,
            status: 'pending',
            originalData: item
          };
        });

        setRecords(mappedRecords);
      } catch (err) {
        setErrorMessage("Lỗi xử lý tệp Excel.");
      }
    };
    reader.readAsArrayBuffer(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleGenerate = async () => {
    if (records.length === 0 || isProcessing) return;
    
    if (!localStorage.getItem('user_api_key') && !process.env.API_KEY) {
      setIsConfigOpen(true);
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const batchSize = 5;
      const updatedRecords = [...records];

      for (let i = 0; i < updatedRecords.length; i += batchSize) {
        const batch = updatedRecords.slice(i, i + batchSize);
        batch.forEach(r => r.status = 'processing');
        setRecords([...updatedRecords]);

        try {
          const results = await generateComments(batch, config);
          batch.forEach(r => {
            const res = results.find(res => res.id === r.id);
            if (res) {
              r.comment = res.comment;
              r.status = 'completed';
            } else {
              r.comment = "AI gặp sự cố khi tạo nội dung. Vui lòng thử lại sau.";
              r.status = 'error';
            }
          });
        } catch (e) {
          batch.forEach(r => { 
            r.status = 'error'; 
            r.comment = "Lỗi kết nối AI. Vui lòng kiểm tra lại khóa API."; 
          });
        }
        setRecords([...updatedRecords]);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const exportToExcel = () => {
    const exportData = records.map(r => ({
      ...r.originalData,
      'Nội dung nhận xét AI': r.comment || ""
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "KetQua");
    XLSX.writeFile(workbook, `NhanXet_Lop${config.grade}_${config.term}.xlsx`);
  };

  const currentThemeColor = GRADE_COLORS[config.grade];

  return (
    <div className="min-h-screen flex flex-col bg-[#f0f9fa] text-slate-900 font-sans selection:bg-cyan-100">
      <Header onOpenConfig={() => setIsConfigOpen(true)} />
      
      <main className="flex-grow max-w-7xl mx-auto px-4 py-8 w-full">
        {errorMessage && (
          <div className="mb-6 bg-white border-l-4 border-red-500 p-5 rounded-2xl shadow-sm animate-in fade-in slide-in-from-top-4">
            <p className="text-xs font-black text-red-500 uppercase mb-1 tracking-widest">Lỗi hệ thống</p>
            <p className="text-sm text-slate-600 font-medium">{errorMessage}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-4 space-y-8">
            <section className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-cyan-900/5 border border-white">
              <h2 className={`text-[10px] font-black uppercase tracking-[0.3em] mb-8 flex items-center ${currentThemeColor.replace('bg-', 'text-')}`}>
                <span className={`w-3 h-3 rounded-full mr-3 shadow-inner ${currentThemeColor}`}></span>
                Thiết lập đánh giá
              </h2>
              
              <div className="space-y-8">
                <div>
                  <label className="text-[10px] font-black text-slate-300 uppercase mb-4 block tracking-widest">Khối lớp</label>
                  <div className="grid grid-cols-5 gap-2.5">
                    {(['1', '2', '3', '4', '5'] as Grade[]).map(g => (
                      <button
                        key={g}
                        onClick={() => setConfig(prev => ({ ...prev, grade: g }))}
                        className={`py-4 rounded-[1.25rem] text-sm font-black transition-all transform active:scale-90 border-2 ${
                          config.grade === g 
                          ? `${GRADE_COLORS[g]} border-transparent text-white shadow-xl shadow-${GRADE_COLORS[g].replace('bg-', '')}/20` 
                          : 'bg-slate-50 border-transparent text-slate-400 hover:bg-cyan-50 hover:text-cyan-600'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-300 uppercase mb-4 block tracking-widest">Thời điểm đánh giá</label>
                  <div className="grid grid-cols-2 gap-2.5">
                    {TERMS.map(t => (
                      <button
                        key={t}
                        onClick={() => setConfig(prev => ({ ...prev, term: t }))}
                        className={`py-3 px-2 rounded-xl text-[10px] font-black transition-all border-2 uppercase tracking-tighter ${
                          config.term === t 
                          ? 'bg-cyan-600 border-transparent text-white shadow-lg' 
                          : 'bg-slate-50 border-transparent text-slate-400 hover:bg-cyan-50 hover:text-cyan-600'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-300 uppercase mb-4 block tracking-widest">Môn học</label>
                  <div className="relative group">
                    <select 
                      value={config.subjectContext}
                      onChange={(e) => setConfig({...config, subjectContext: e.target.value})}
                      className="w-full bg-slate-50 border-2 border-slate-50 rounded-2xl px-6 py-4 text-sm font-black outline-none focus:bg-white focus:border-cyan-400 appearance-none cursor-pointer shadow-inner transition-all"
                    >
                      {SUBJECT_MAP[config.grade].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-slate-300">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7"/></svg>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-300 uppercase mb-4 block tracking-widest">Hình thức nhận xét</label>
                  <div className="flex bg-slate-100 p-1.5 rounded-2xl">
                    <button 
                      onClick={() => setConfig({...config, evaluationBasis: 'score'})}
                      className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${config.evaluationBasis === 'score' ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      Điểm số
                    </button>
                    <button 
                      onClick={() => setConfig({...config, evaluationBasis: 'level'})}
                      className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${config.evaluationBasis === 'level' ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      Mức đạt
                    </button>
                    <button 
                      onClick={() => setConfig({...config, evaluationBasis: 'both'})}
                      className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${config.evaluationBasis === 'both' ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      Cả hai
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-10 space-y-4">
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className={`w-full py-8 border-2 border-dashed rounded-[2rem] flex flex-col items-center justify-center transition-all group ${
                    records.length > 0 ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-slate-50/50 border-slate-100 hover:border-cyan-200 hover:bg-white'
                  }`}
                >
                  <div className={`p-4 rounded-full mb-3 shadow-sm transition-transform group-hover:scale-110 ${records.length > 0 ? 'bg-white text-emerald-500' : 'bg-white text-slate-200 group-hover:text-cyan-500'}`}>
                    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                  </div>
                  <span className={`text-[10px] font-black uppercase tracking-widest ${records.length > 0 ? `Đã nạp ${records.length} hồ sơ` : 'Tải danh sách Excel'}`}>
                    {records.length > 0 ? `Đã nạp ${records.length} hồ sơ` : 'Tải danh sách Excel'}
                  </span>
                </button>
                <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls" onChange={handleFileUpload} />

                <button
                  disabled={records.length === 0 || isProcessing}
                  onClick={handleGenerate}
                  className={`w-full py-6 rounded-3xl font-black text-xs uppercase tracking-[0.25em] transition-all transform active:scale-95 shadow-2xl ${
                    records.length === 0 || isProcessing 
                    ? 'bg-slate-100 text-slate-300 cursor-not-allowed shadow-none' 
                    : `${currentThemeColor} text-white hover:brightness-105 shadow-cyan-900/10`
                  }`}
                >
                  {isProcessing ? 'AI đang phân tích chương trình...' : 'Bắt đầu tạo nhận xét'}
                </button>
              </div>
            </section>
          </div>

          <div className="lg:col-span-8">
            {records.length > 0 ? (
              <div className="bg-white rounded-[3rem] shadow-2xl shadow-cyan-900/5 border border-white overflow-hidden animate-in slide-in-from-bottom-8 duration-500">
                <div className="px-10 py-8 bg-slate-50/50 border-b border-slate-50 flex justify-between items-center">
                  <div className="flex flex-col">
                    <div className="flex items-center space-x-3 mb-1">
                      <span className={`px-3 py-0.5 rounded-full text-[8px] font-black text-white uppercase tracking-widest ${currentThemeColor}`}>
                        LỚP {config.grade}
                      </span>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        {config.term}
                      </span>
                    </div>
                    <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">{config.subjectContext}</h3>
                  </div>
                  <button 
                    onClick={exportToExcel} 
                    className="px-6 py-3 bg-emerald-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 shadow-xl active:scale-95 flex items-center transition-all"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                    Tải về Excel
                  </button>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] border-b border-slate-50">
                        <th className="px-10 py-6 text-left">Học sinh</th>
                        <th className="px-4 py-6 text-center">Kết quả</th>
                        <th className="px-10 py-6 text-left">Nội dung nhận xét AI</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {records.map(r => (
                        <tr key={r.id} className="hover:bg-cyan-50/20 transition-colors group">
                          <td className="px-10 py-8">
                            <div className="text-sm font-black text-slate-800 tracking-tight group-hover:text-cyan-700 transition-colors">{r.name}</div>
                          </td>
                          <td className="px-4 py-8 text-center">
                            <div className="inline-flex flex-col items-center">
                              <span className={`px-3 py-1.5 rounded-xl text-[9px] font-black shadow-sm mb-1.5 ${
                                r.level === AchievementLevel.T ? 'bg-green-50 text-green-600' :
                                r.level === AchievementLevel.H ? 'bg-blue-50 text-blue-600' : 'bg-rose-50 text-rose-600'
                              }`}>
                                {r.level === AchievementLevel.T ? 'TỐT' : r.level === AchievementLevel.H ? 'ĐẠT' : 'CHƯA ĐẠT'}
                              </span>
                              <span className="text-[10px] text-slate-400 font-black tabular-nums">{r.score}đ</span>
                            </div>
                          </td>
                          <td className="px-10 py-8 min-w-[300px]">
                            {r.status === 'processing' ? (
                              <div className="flex flex-col space-y-3 py-2">
                                <div className="h-1.5 bg-slate-100 animate-pulse rounded-full w-full"></div>
                                <div className="h-1.5 bg-slate-100 animate-pulse rounded-full w-4/5"></div>
                                <div className="h-1.5 bg-slate-100 animate-pulse rounded-full w-2/3"></div>
                              </div>
                            ) : (
                              <div className="relative group/comment">
                                <textarea 
                                  value={r.comment || ""}
                                  onChange={(e) => setRecords(prev => prev.map(p => p.id === r.id ? {...p, comment: e.target.value, status: 'completed'} : p))}
                                  className={`w-full text-[11px] p-5 pr-12 rounded-3xl border-2 bg-slate-50/30 transition-all focus:outline-none focus:bg-white focus:ring-4 focus:ring-cyan-50 italic leading-relaxed resize-none border-transparent hover:border-slate-100 focus:border-cyan-400`}
                                  rows={3}
                                  placeholder="..."
                                />
                                {r.comment && r.comment.length > 5 && (
                                  <button 
                                    onClick={() => handleCopy(r.comment || '', r.id)}
                                    className={`absolute right-4 top-4 p-2.5 rounded-xl transition-all shadow-sm z-10 ${
                                      copyStatus === r.id ? 'bg-emerald-500 text-white scale-110' : 'bg-white/90 text-slate-400 hover:text-cyan-600 opacity-0 group-hover/comment:opacity-100 border border-slate-100 hover:scale-105'
                                    }`}
                                    title="Sao chép lời nhận xét này"
                                  >
                                    {copyStatus === r.id ? (
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>
                                    ) : (
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
                                    )}
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-[4rem] border-4 border-dashed border-cyan-50 py-40 flex flex-col items-center justify-center text-center px-16 shadow-inner animate-in fade-in duration-700">
                <div className="w-28 h-28 rounded-full flex items-center justify-center mb-10 shadow-2xl bg-gradient-to-tr from-cyan-50 to-white">
                   <svg className="w-12 h-12 text-cyan-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                </div>
                <h3 className="text-2xl font-black text-slate-800 uppercase tracking-[0.1em] mb-6">Hệ thống nhận xét Thông tư 27</h3>
                <p className="text-[11px] text-slate-400 font-bold max-w-sm leading-relaxed uppercase tracking-widest mb-10">
                  Tải lên tệp Excel chứa tên, điểm số và mức đạt được để AI soạn thảo lời nhận xét chuẩn 2018 cho bạn.
                </p>
                <button 
                   onClick={() => fileInputRef.current?.click()}
                   className={`px-12 py-5 rounded-3xl font-black text-xs uppercase tracking-widest text-white shadow-2xl active:scale-95 transition-all ${currentThemeColor}`}
                >
                  Chọn tệp Excel ngay
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
      
      <ApiKeyModal 
        isOpen={isConfigOpen} 
        onClose={() => setIsConfigOpen(false)} 
        onSave={() => setIsConfigOpen(false)} 
      />
      <Footer />
    </div>
  );
};

export default App;
