
import React, { useState, useRef, useEffect } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import ApiKeyModal from './components/ApiKeyModal';
import { StudentRecord, AchievementLevel, GenerationConfig, Grade, SUBJECT_MAP, EvaluationBasis, Term } from './types';
import { generateComments } from './services/geminiService';
import * as XLSX from 'xlsx';

// New Color Scheme Map
const GRADE_CONFIG: Record<Grade, { bg: string, text: string, ring: string, activeBg: string }> = {
  '1': { bg: 'bg-emerald-100', text: 'text-emerald-600', ring: 'ring-emerald-400', activeBg: 'bg-emerald-500' }, // Green
  '2': { bg: 'bg-amber-100', text: 'text-amber-600', ring: 'ring-amber-400', activeBg: 'bg-amber-500' },     // Yellow
  '3': { bg: 'bg-orange-100', text: 'text-orange-600', ring: 'ring-orange-400', activeBg: 'bg-orange-500' },   // Orange
  '4': { bg: 'bg-sky-100', text: 'text-sky-600', ring: 'ring-sky-400', activeBg: 'bg-sky-500' },         // Blue
  '5': { bg: 'bg-purple-100', text: 'text-purple-600', ring: 'ring-purple-400', activeBg: 'bg-purple-500' }    // Purple
};

const TERMS: Term[] = ['Giữa học kỳ 1', 'Cuối học kỳ 1', 'Giữa học kỳ 2', 'Cuối học kỳ 2'];

const App: React.FC = () => {
  const [records, setRecords] = useState<StudentRecord[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
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

  return (
    <div className="min-h-screen flex flex-col bg-[#e6fcf5] text-slate-800 font-sans selection:bg-[#20c997] selection:text-white">
      <Header onOpenConfig={() => setIsConfigOpen(true)} />
      
      <main className="flex-grow max-w-[1400px] mx-auto px-6 py-10 w-full">
        {errorMessage && (
          <div className="mb-8 bg-white border-l-4 border-red-500 p-6 rounded-2xl shadow-sm animate-in fade-in slide-in-from-top-4">
            <p className="text-xs font-black text-red-500 uppercase mb-1 tracking-widest">Lỗi hệ thống</p>
            <p className="text-sm text-slate-600 font-medium">{errorMessage}</p>
          </div>
        )}

        {/* Lock Interface with Blur if No API Key */}
        <div className={`grid grid-cols-1 lg:grid-cols-12 gap-10 transition-all duration-500 ${isConfigOpen && !localStorage.getItem('user_api_key') ? 'blur-sm grayscale opacity-50 pointer-events-none' : ''}`}>
          
          {/* SIDEBAR CONFIGURATION */}
          <div className="lg:col-span-4 space-y-6">
            <section className="bg-white p-8 rounded-[24px] shadow-lg shadow-[#20c997]/5 border border-white">
              <h2 className="text-sm font-extrabold text-[#20c997] uppercase tracking-widest mb-8 flex items-center">
                <span className="w-2 h-2 rounded-full bg-[#20c997] mr-3"></span>
                Thiết lập đánh giá
              </h2>
              
              <div className="space-y-8">
                {/* 1. Grade Selector - Circles */}
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase mb-4 block tracking-wider">Khối lớp</label>
                  <div className="flex justify-between gap-2">
                    {(['1', '2', '3', '4', '5'] as Grade[]).map(g => (
                      <button
                        key={g}
                        onClick={() => setConfig(prev => ({ ...prev, grade: g }))}
                        className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold transition-all shadow-sm ${
                          config.grade === g 
                          ? `${GRADE_CONFIG[g].activeBg} text-white shadow-lg scale-110 ring-4 ring-offset-2 ${GRADE_CONFIG[g].ring}` 
                          : 'bg-slate-50 text-slate-400 hover:bg-slate-100'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. Term Selector */}
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase mb-4 block tracking-wider">Thời điểm</label>
                  <div className="grid grid-cols-2 gap-3">
                    {TERMS.map(t => (
                      <button
                        key={t}
                        onClick={() => setConfig(prev => ({ ...prev, term: t }))}
                        className={`py-3 px-2 rounded-xl text-[11px] font-bold transition-all border border-transparent ${
                          config.term === t 
                          ? 'bg-[#20c997] text-white shadow-md shadow-[#20c997]/30' 
                          : 'bg-slate-50 text-slate-500 hover:bg-[#20c997]/10 hover:text-[#20c997]'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. Subject Selector */}
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase mb-4 block tracking-wider">Môn học</label>
                  <div className="relative">
                    <select 
                      value={config.subjectContext}
                      onChange={(e) => setConfig({...config, subjectContext: e.target.value})}
                      className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-[#20c997] focus:ring-2 focus:ring-[#20c997]/20 appearance-none cursor-pointer transition-all"
                    >
                      {SUBJECT_MAP[config.grade].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7"/></svg>
                    </div>
                  </div>
                </div>

                {/* 4. Evaluation Basis Selector */}
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase mb-4 block tracking-wider">Căn cứ đánh giá</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => setConfig({ ...config, evaluationBasis: 'score' })}
                      className={`py-3 px-1 rounded-xl text-[11px] font-bold transition-all border border-transparent ${
                        config.evaluationBasis === 'score'
                        ? 'bg-[#20c997] text-white shadow-md shadow-[#20c997]/30'
                        : 'bg-slate-50 text-slate-500 hover:bg-[#20c997]/10 hover:text-[#20c997]'
                      }`}
                    >
                      Điểm số
                    </button>
                    <button
                      onClick={() => setConfig({ ...config, evaluationBasis: 'level' })}
                      className={`py-3 px-1 rounded-xl text-[11px] font-bold transition-all border border-transparent ${
                        config.evaluationBasis === 'level'
                        ? 'bg-[#20c997] text-white shadow-md shadow-[#20c997]/30'
                        : 'bg-slate-50 text-slate-500 hover:bg-[#20c997]/10 hover:text-[#20c997]'
                      }`}
                    >
                      Mức đạt
                    </button>
                    <button
                      onClick={() => setConfig({ ...config, evaluationBasis: 'both' })}
                      className={`py-3 px-1 rounded-xl text-[11px] font-bold transition-all border border-transparent ${
                        config.evaluationBasis === 'both'
                        ? 'bg-[#20c997] text-white shadow-md shadow-[#20c997]/30'
                        : 'bg-slate-50 text-slate-500 hover:bg-[#20c997]/10 hover:text-[#20c997]'
                      }`}
                    >
                      Cả hai
                    </button>
                  </div>
                </div>

                {/* 5. Upload Dropzone (Replaces Button) */}
                <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase mb-4 block tracking-wider">Dữ liệu nguồn</label>
                    <div 
                        onClick={() => fileInputRef.current?.click()}
                        className={`border-2 border-dashed rounded-[24px] p-8 flex flex-col items-center justify-center cursor-pointer transition-all group ${
                            records.length > 0 
                            ? 'border-[#20c997] bg-[#20c997]/5' 
                            : 'border-slate-200 bg-slate-50 hover:border-[#20c997]/50 hover:bg-white'
                        }`}
                    >
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-3 shadow-sm transition-transform group-hover:scale-110 ${records.length > 0 ? 'bg-[#20c997] text-white' : 'bg-white text-[#20c997]'}`}>
                             <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                        </div>
                        <p className={`text-xs font-bold text-center ${records.length > 0 ? 'text-[#20c997]' : 'text-slate-500 group-hover:text-[#20c997]'}`}>
                            {records.length > 0 ? `Đã tải ${records.length} học sinh` : 'Chạm để tải file Excel'}
                        </p>
                        {records.length === 0 && (
                            <p className="text-[10px] text-slate-400 mt-2 text-center max-w-[200px] leading-tight">
                                (File dữ liệu đã nhập điểm số hoặc mức đạt được trên CSDL)
                            </p>
                        )}
                        <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls" onChange={handleFileUpload} />
                    </div>
                </div>
              </div>

              {/* Generate Button - Gradient Orange */}
              <div className="mt-10">
                <button
                  disabled={records.length === 0 || isProcessing}
                  onClick={handleGenerate}
                  className={`w-full py-5 rounded-[20px] font-extrabold text-sm uppercase tracking-widest transition-all transform active:scale-95 shadow-xl ${
                    records.length === 0 || isProcessing 
                    ? 'bg-slate-100 text-slate-300 cursor-not-allowed shadow-none' 
                    : 'bg-gradient-to-r from-[#ffc107] to-[#fd7e14] text-white hover:shadow-orange-200 hover:-translate-y-1'
                  }`}
                >
                  {isProcessing ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Đang xử lý...
                    </span>
                  ) : 'Bắt đầu tạo nhận xét'}
                </button>
              </div>
            </section>
          </div>

          {/* MAIN CONTENT AREA */}
          <div className="lg:col-span-8">
            {records.length > 0 ? (
              <div className="bg-white rounded-[24px] shadow-xl shadow-[#20c997]/5 border border-slate-100 overflow-hidden animate-in slide-in-from-bottom-8 duration-500">
                <div className="px-8 py-6 bg-slate-50/50 border-b border-slate-100 flex justify-between items-center">
                  <div>
                     <h3 className="text-lg font-bold text-slate-800">{config.subjectContext}</h3>
                     <div className="flex gap-2 mt-1">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${GRADE_CONFIG[config.grade].bg} ${GRADE_CONFIG[config.grade].text}`}>Lớp {config.grade}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase bg-slate-100 text-slate-500">{config.term}</span>
                     </div>
                  </div>
                  <button 
                    onClick={exportToExcel} 
                    className="px-6 py-3 bg-[#20c997] text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-[#19b386] shadow-lg shadow-[#20c997]/20 active:scale-95 flex items-center gap-2 transition-all"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    Xuất Excel
                  </button>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                        <th className="px-8 py-5 text-left bg-slate-50/50">Học sinh</th>
                        <th className="px-4 py-5 text-center bg-slate-50/50">Kết quả</th>
                        <th className="px-8 py-5 text-left bg-slate-50/50">Nội dung nhận xét AI</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {records.map(r => (
                        <tr key={r.id} className="hover:bg-slate-50/80 transition-colors group">
                          <td className="px-8 py-6 align-top">
                            <div className="text-sm font-bold text-slate-700 group-hover:text-[#20c997] transition-colors">{r.name}</div>
                            <div className="text-[10px] text-slate-400 font-mono mt-1">{r.id.split('-')[1]}</div>
                          </td>
                          <td className="px-4 py-6 text-center align-top">
                             <div className="flex flex-col items-center gap-1">
                                <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${
                                    r.level === AchievementLevel.T ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                    r.level === AchievementLevel.H ? 'bg-sky-50 text-sky-600 border-sky-100' : 'bg-rose-50 text-rose-600 border-rose-100'
                                }`}>
                                    {r.level === AchievementLevel.T ? 'T' : r.level === AchievementLevel.H ? 'H' : 'C'}
                                </span>
                                <span className="text-xs font-bold text-slate-500">{r.score}</span>
                             </div>
                          </td>
                          <td className="px-8 py-6 min-w-[350px]">
                            {r.status === 'processing' ? (
                              <div className="space-y-2 py-1 max-w-sm">
                                <div className="h-2 bg-slate-100 rounded w-full animate-pulse"></div>
                                <div className="h-2 bg-slate-100 rounded w-3/4 animate-pulse"></div>
                              </div>
                            ) : (
                              <div className="relative group/edit">
                                <textarea 
                                  value={r.comment || ""}
                                  onChange={(e) => setRecords(prev => prev.map(p => p.id === r.id ? {...p, comment: e.target.value, status: 'completed'} : p))}
                                  className="w-full text-sm text-slate-600 bg-transparent border-2 border-transparent hover:border-slate-100 focus:border-[#20c997] focus:bg-white rounded-xl p-3 transition-all outline-none resize-none leading-relaxed"
                                  rows={3}
                                />
                                <button 
                                    onClick={() => handleCopy(r.comment || '', r.id)}
                                    className={`absolute top-2 right-2 p-1.5 rounded-lg transition-all ${copyStatus === r.id ? 'bg-emerald-500 text-white' : 'text-slate-300 hover:text-[#20c997] hover:bg-slate-50 opacity-0 group-hover/edit:opacity-100'}`}
                                >
                                    {copyStatus === r.id ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg> : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"/></svg>}
                                </button>
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
              /* EMPTY STATE - Glassmorphism */
              <div className="h-full min-h-[500px] flex flex-col items-center justify-center text-center p-12 glass rounded-[32px]">
                <div className="w-32 h-32 mb-8 bg-white rounded-full flex items-center justify-center shadow-2xl shadow-[#20c997]/10 animate-in zoom-in duration-700">
                    <svg className="w-16 h-16 text-[#20c997]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                    </svg>
                </div>
                <h3 className="text-2xl font-extrabold text-slate-800 mb-4">Sẵn sàng làm việc</h3>
                <p className="text-slate-500 max-w-md mx-auto leading-relaxed text-sm font-medium">
                  Vui lòng tải lên tệp Excel và chọn cấu hình ở cột bên trái để bắt đầu tạo nhận xét tự động.
                </p>
                <div className="mt-8 flex gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#20c997] animate-bounce"></div>
                    <div className="w-2 h-2 rounded-full bg-[#20c997] animate-bounce delay-100"></div>
                    <div className="w-2 h-2 rounded-full bg-[#20c997] animate-bounce delay-200"></div>
                </div>
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
