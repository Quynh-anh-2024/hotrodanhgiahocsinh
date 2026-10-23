import React, { useState, useRef, useEffect } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import ApiKeyModal from './components/ApiKeyModal';
import {
  StudentRecord, AchievementLevel, GenerationConfig, Grade, SUBJECT_MAP, Term, AppMode,
  isScoredSubject, PCNL_ITEMS, QUALITIES, CORE_COMPETENCIES
} from './types';
import { generateComments, generatePcnlComments, generateSummaryComments } from './services/geminiService';
import {
  parseLevel, parsePcnl, parseScore, scoreLevelMismatch, validateComment, normalizeComment,
  classifyYearEnd, type LevelCode, type PcnlLevel
} from './services/logic';
import * as XLSX from 'xlsx';

const GRADE_CONFIG: Record<Grade, { bg: string, text: string, ring: string, activeBg: string }> = {
  '1': { bg: 'bg-emerald-100', text: 'text-emerald-600', ring: 'ring-emerald-400', activeBg: 'bg-emerald-500' },
  '2': { bg: 'bg-amber-100', text: 'text-amber-600', ring: 'ring-amber-400', activeBg: 'bg-amber-500' },
  '3': { bg: 'bg-orange-100', text: 'text-orange-600', ring: 'ring-orange-400', activeBg: 'bg-orange-500' },
  '4': { bg: 'bg-sky-100', text: 'text-sky-600', ring: 'ring-sky-400', activeBg: 'bg-sky-500' },
  '5': { bg: 'bg-purple-100', text: 'text-purple-600', ring: 'ring-purple-400', activeBg: 'bg-purple-500' }
};

const TERMS: Term[] = ['Giữa học kỳ 1', 'Cuối học kỳ 1', 'Giữa học kỳ 2', 'Cuối năm học'];
const MODES: { key: AppMode; label: string }[] = [
  { key: 'subject', label: 'Môn học' },
  { key: 'pcnl', label: 'Phẩm chất & NL' },
  { key: 'summary', label: 'Tổng hợp cuối năm' },
];

const LEVEL_FROM_CODE: Record<LevelCode, AchievementLevel> = {
  T: AchievementLevel.T, H: AchievementLevel.H, C: AchievementLevel.C
};
const PCNL_RANK: Record<PcnlLevel, number> = { 'Tốt': 3, 'Đạt': 2, 'Cần cố gắng': 1 };

const App: React.FC = () => {
  const [records, setRecords] = useState<StudentRecord[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
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
    term: 'Cuối học kỳ 1',
    mode: 'subject',
    classTopics: ''
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const availableSubjects = SUBJECT_MAP[config.grade];
    if (!availableSubjects.includes(config.subjectContext)) {
      setConfig(prev => ({ ...prev, subjectContext: availableSubjects[0] }));
    }
  }, [config.grade]);

  // Môn chỉ nhận xét: khoá căn cứ về Mức đạt, không dùng điểm
  useEffect(() => {
    if (config.mode === 'subject' && !isScoredSubject(config.subjectContext) && config.evaluationBasis !== 'level') {
      setConfig(prev => ({ ...prev, evaluationBasis: 'level' }));
    }
  }, [config.subjectContext, config.mode]);

  const handleCopy = (text: string, id: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopyStatus(id);
      setTimeout(() => setCopyStatus(null), 2000);
    });
  };

  const normalizeKey = (key: string) => key?.toLowerCase().trim().replace(/\s+/g, '') || '';

  // Dò giá trị theo danh sách tên cột ứng viên — duyệt theo THỨ TỰ ƯU TIÊN của danh sách, không theo thứ tự cột trong file
  const findValueByPossibleKeys = (item: any, possibleKeys: string[]) => {
    const itemKeys = Object.keys(item);
    for (const candidate of possibleKeys) {
      const nCandidate = normalizeKey(candidate);
      const rawKey = itemKeys.find(k => normalizeKey(k) === nCandidate);
      if (rawKey !== undefined) {
        const val = item[rawKey];
        if (val === undefined || val === null) return null;
        return val.toString().trim();
      }
    }
    return null;
  };

  const nameKeys = ['Họ và tên', 'Họ tên', 'Tên học sinh', 'Full Name', 'Họ & tên'];
  const levelKeys = ['Mức đạt được', 'Mức đạt', 'Xếp loại', 'Level', 'Mức'];
  const scoreKeys = ['Điểm KTĐK', 'Điểm kiểm tra định kỳ', 'Điểm số', 'Điểm', 'Score', 'Điểm KT', 'Kết quả'];
  const strengthKeys = ['Điểm mạnh', 'Ưu điểm', 'Strengths'];
  const needsKeys = ['Cần cố gắng', 'Điểm cần cố gắng', 'Hạn chế', 'Needs'];
  const noteKeys = ['Ghi chú', 'Nhận xét của giáo viên', 'Note'];

  const worstPcnl = (vals: (PcnlLevel | null)[]): PcnlLevel | null => {
    const ok = vals.filter(Boolean) as PcnlLevel[];
    if (!ok.length) return null;
    return ok.reduce((a, b) => (PCNL_RANK[a] <= PCNL_RANK[b] ? a : b));
  };

  const buildSubjectRecord = (item: any, index: number): StudentRecord => {
    const name = findValueByPossibleKeys(item, nameKeys);
    const issues: string[] = [];
    const levelRaw = findValueByPossibleKeys(item, levelKeys);
    const levelCode = parseLevel(levelRaw);
    if (!levelCode) issues.push(`Không đọc được mức "${levelRaw ?? ''}" — cần ghi T/H/C hoặc Hoàn thành tốt/Hoàn thành/Chưa hoàn thành`);

    let score: number | null = null;
    if (isScoredSubject(config.subjectContext)) {
      const parsed = parseScore(findValueByPossibleKeys(item, scoreKeys));
      score = parsed.value;
      issues.push(...parsed.issues);
      const mismatch = scoreLevelMismatch(score, levelCode);
      if (mismatch) issues.push(mismatch);
    }

    return {
      id: `st-${index}-${Date.now()}`,
      name: name || `Học sinh ${index + 1}`,
      subject: config.subjectContext,
      score,
      level: levelCode ? LEVEL_FROM_CODE[levelCode] : null,
      levelCode,
      status: levelCode ? 'pending' : 'invalid',
      issues,
      strengths: findValueByPossibleKeys(item, strengthKeys) || undefined,
      needs: findValueByPossibleKeys(item, needsKeys) || undefined,
      note: findValueByPossibleKeys(item, noteKeys) || undefined,
      originalData: item
    };
  };

  const buildPcnlRecord = (item: any, index: number): StudentRecord => {
    const name = findValueByPossibleKeys(item, nameKeys);
    const issues: string[] = [];
    const pcnl: Record<string, PcnlLevel | null> = {};
    for (const itemName of PCNL_ITEMS) {
      const v = parsePcnl(findValueByPossibleKeys(item, [itemName, `Mức ${itemName}`]));
      if (v) pcnl[itemName] = v;
    }
    // File chỉ có cột tổng hợp Phẩm chất / Năng lực
    if (!QUALITIES.some(q => pcnl[q])) {
      const pc = parsePcnl(findValueByPossibleKeys(item, ['Phẩm chất', 'Mức phẩm chất']));
      if (pc) pcnl['Phẩm chất (tổng hợp)'] = pc;
    }
    if (!CORE_COMPETENCIES.some(c => pcnl[c])) {
      const nl = parsePcnl(findValueByPossibleKeys(item, ['Năng lực', 'Mức năng lực']));
      if (nl) pcnl['Năng lực (tổng hợp)'] = nl;
    }
    const hasAny = Object.values(pcnl).some(Boolean);
    if (!hasAny) issues.push('Không đọc được mức phẩm chất/năng lực nào — cột cần mang tên đúng phẩm chất/năng lực hoặc Phẩm chất/Năng lực, giá trị Tốt/Đạt/Cần cố gắng');

    return {
      id: `st-${index}-${Date.now()}`,
      name: name || `Học sinh ${index + 1}`,
      subject: 'Phẩm chất & Năng lực',
      score: null,
      level: null,
      levelCode: null,
      status: hasAny ? 'pending' : 'invalid',
      issues,
      strengths: findValueByPossibleKeys(item, strengthKeys) || undefined,
      needs: findValueByPossibleKeys(item, needsKeys) || undefined,
      note: findValueByPossibleKeys(item, noteKeys) || undefined,
      pcnl,
      originalData: item
    };
  };

  const buildSummaryRecord = (item: any, index: number): StudentRecord => {
    const name = findValueByPossibleKeys(item, nameKeys);
    const subjects = SUBJECT_MAP[config.grade];
    const scoredSubjects = subjects.filter(isScoredSubject);
    const subjectLevels: Record<string, LevelCode | null> = {};
    const scores: Record<string, number | null> = {};
    const issues: string[] = [];

    for (const s of subjects) {
      subjectLevels[s] = parseLevel(findValueByPossibleKeys(item, [`Mức ${s}`, `${s} (mức)`, s]));
    }
    for (const s of scoredSubjects) {
      const parsed = parseScore(findValueByPossibleKeys(item, [`Điểm ${s}`, `Điểm KTĐK ${s}`, `KTĐK ${s}`, `${s} (điểm)`]));
      scores[s] = parsed.value;
      issues.push(...parsed.issues.map(t => `${s}: ${t}`));
    }
    const pcIndividual = QUALITIES.map(q => parsePcnl(findValueByPossibleKeys(item, [q, `Mức ${q}`])));
    const nlIndividual = CORE_COMPETENCIES.map(c => parsePcnl(findValueByPossibleKeys(item, [c, `Mức ${c}`])));
    const pc = pcIndividual.some(Boolean) ? worstPcnl(pcIndividual) : parsePcnl(findValueByPossibleKeys(item, ['Phẩm chất', 'Mức phẩm chất']));
    const nl = nlIndividual.some(Boolean) ? worstPcnl(nlIndividual) : parsePcnl(findValueByPossibleKeys(item, ['Năng lực', 'Mức năng lực']));

    const yearEnd = classifyYearEnd({ subjects, scoredSubjects, subjectLevels, scores, pc, nl });
    if (yearEnd.result === 'Thiếu dữ liệu') issues.push(`Thiếu dữ liệu: ${yearEnd.missing.join('; ')}`);

    return {
      id: `st-${index}-${Date.now()}`,
      name: name || `Học sinh ${index + 1}`,
      subject: 'Tổng hợp cuối năm',
      score: null,
      level: null,
      levelCode: null,
      status: yearEnd.result === 'Thiếu dữ liệu' ? 'invalid' : 'pending',
      issues,
      yearEnd: { result: yearEnd.result, missing: yearEnd.missing, award: yearEnd.award, subjectLevels, scores, pc, nl },
      originalData: item
    };
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
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];

        // Quét tối đa 10 hàng đầu để tìm hàng tiêu đề thật (file CSDL thường có dòng tiêu đề/trống phía trên)
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null }) as any[][];
        const nameNorms = nameKeys.map(k => normalizeKey(k));
        let headerIdx = rows.slice(0, 10).findIndex(row => row && row.some(c => c !== null && nameNorms.includes(normalizeKey(c.toString()))));
        if (headerIdx < 0) headerIdx = 0;

        const headers = (rows[headerIdx] || []).map((h, i) => (h === null || h === undefined || `${h}`.trim() === '' ? `Cột ${i + 1}` : `${h}`.trim()));
        const rawData = rows.slice(headerIdx + 1)
          .filter(row => row && row.some(c => c !== null && c !== undefined && `${c}`.trim() !== ''))
          .map(row => {
            const obj: any = {};
            headers.forEach((h, i) => { obj[h] = row[i] ?? null; });
            return obj;
          });

        if (!rawData || rawData.length === 0) {
          setErrorMessage("Tệp Excel này không có dữ liệu.");
          return;
        }

        const validRows = rawData.filter(item => findValueByPossibleKeys(item, nameKeys));
        if (validRows.length === 0) {
          setErrorMessage(`Không tìm thấy cột tên học sinh. Vui lòng kiểm tra lại tiêu đề cột.`);
          return;
        }

        const builder = config.mode === 'subject' ? buildSubjectRecord : config.mode === 'pcnl' ? buildPcnlRecord : buildSummaryRecord;
        setRecords(validRows.map((item, index) => builder(item, index)));
      } catch (err) {
        setErrorMessage("Lỗi xử lý tệp Excel.");
      }
    };
    reader.readAsArrayBuffer(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const serviceForMode = config.mode === 'subject' ? generateComments : config.mode === 'pcnl' ? generatePcnlComments : generateSummaryComments;

  // Sinh nhận xét cho một nhóm học sinh; tự kiểm tra sau sinh và sinh lại 1 lần với em vi phạm/trùng lặp
  const generateFor = async (targets: StudentRecord[]) => {
    if (targets.length === 0 || isProcessing) return;
    if (!localStorage.getItem('user_api_key') && !process.env.API_KEY) {
      setIsConfigOpen(true);
      return;
    }
    setIsProcessing(true);
    setErrorMessage(null);
    const working = [...records];
    const byId = new Map(working.map(r => [r.id, r]));
    setProgress({ done: 0, total: targets.length });
    let done = 0;

    const runBatch = async (batch: StudentRecord[]): Promise<void> => {
      batch.forEach(r => { const w = byId.get(r.id); if (w) w.status = 'processing'; });
      setRecords([...working]);
      try {
        const results = await serviceForMode(batch, config);
        batch.forEach(r => {
          const w = byId.get(r.id);
          if (!w) return;
          const res = results.find(x => x.id === r.id);
          if (res && res.comment && res.comment.trim()) {
            w.comment = res.comment.trim();
            w.status = 'completed';
          } else {
            w.status = 'error'; // để trống ô nhận xét — không ghi câu báo lỗi vào ô như bản cũ
          }
        });
      } catch (e) {
        batch.forEach(r => { const w = byId.get(r.id); if (w) w.status = 'error'; });
      }
      done += batch.length;
      setProgress({ done, total: targets.length });
      setRecords([...working]);
    };

    try {
      const batchSize = 5;
      for (let i = 0; i < targets.length; i += batchSize) {
        await runBatch(targets.slice(i, i + batchSize));
      }

      // Kiểm tra sau sinh: vi phạm quy tắc câu chữ hoặc trùng lặp với bạn khác -> sinh lại đúng những em đó 1 lần
      const completed = targets.map(t => byId.get(t.id)).filter(r => r && r.status === 'completed') as StudentRecord[];
      const seen = new Map<string, string>();
      const violators: StudentRecord[] = [];
      for (const r of completed) {
        const problems = validateComment(r.comment);
        const key = normalizeComment(r.comment || '');
        if (seen.has(key)) problems.push('Trùng lặp nhận xét với học sinh khác');
        else seen.set(key, r.id);
        if (problems.length) violators.push(r);
      }
      if (violators.length) {
        for (let i = 0; i < violators.length; i += batchSize) {
          const batch = violators.slice(i, i + batchSize);
          try {
            const results = await serviceForMode(batch, config);
            batch.forEach(r => {
              const res = results.find(x => x.id === r.id);
              if (res && res.comment && res.comment.trim()) {
                const newProblems = validateComment(res.comment);
                const dup = completed.some(o => o.id !== r.id && normalizeComment(o.comment || '') === normalizeComment(res.comment));
                if (newProblems.length === 0 && !dup) r.comment = res.comment.trim();
              }
            });
          } catch { /* giữ bản đầu */ }
        }
        // Gắn cờ những em vẫn còn vi phạm để giáo viên rà tay
        for (const r of violators) {
          const problems = validateComment(r.comment);
          if (problems.length) {
            r.issues = [...r.issues.filter(t => !t.startsWith('Nhận xét cần rà lại')), `Nhận xét cần rà lại: ${problems.join('; ')}`];
          }
        }
        setRecords([...working]);
      }
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };

  const pendingTargets = records.filter(r => r.status === 'pending' || r.status === 'error');
  const errorCount = records.filter(r => r.status === 'error').length;
  const invalidCount = records.filter(r => r.status === 'invalid').length;
  const issueCount = records.filter(r => r.issues.length > 0).length;

  const exportToExcel = () => {
    const notReady = records.filter(r => r.status !== 'completed' || !r.comment || !r.comment.trim());
    if (notReady.length > 0) {
      const ok = window.confirm(`Còn ${notReady.length} học sinh chưa có nhận xét hợp lệ (chưa tạo, lỗi hoặc thiếu dữ liệu). Vẫn xuất file?`);
      if (!ok) return;
    }
    let exportData: any[];
    let fileName: string;
    if (config.mode === 'pcnl') {
      exportData = records.map(r => ({ ...r.originalData, 'Nhận xét phẩm chất, năng lực': r.comment || '' }));
      fileName = `PhamChatNangLuc_Lop${config.grade}_${config.term.replace(/\s+/g, '_')}.xlsx`;
    } else if (config.mode === 'summary') {
      exportData = records.map(r => ({
        ...r.originalData,
        'Kết quả tổng hợp cuối năm': r.yearEnd?.result || '',
        'Khen thưởng dự kiến': r.yearEnd?.award || '',
        'Nhận xét học bạ': r.comment || ''
      }));
      fileName = `TongHopCuoiNam_Lop${config.grade}.xlsx`;
    } else {
      exportData = records.map(r => ({ ...r.originalData, 'Nội dung nhận xét AI': r.comment || '' }));
      fileName = `NhanXet_Lop${config.grade}_${config.term.replace(/\s+/g, '_')}.xlsx`;
    }
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "KetQua");
    XLSX.writeFile(workbook, fileName);
  };

  const switchMode = (mode: AppMode) => {
    setConfig(prev => ({ ...prev, mode, term: mode === 'summary' ? 'Cuối năm học' : prev.term }));
    setRecords([]);
    setErrorMessage(null);
  };

  const commentTitle = config.mode === 'pcnl' ? 'Nhận xét phẩm chất, năng lực' : config.mode === 'summary' ? 'Nhận xét học bạ' : 'Nội dung nhận xét AI';

  const renderResultCell = (r: StudentRecord) => {
    if (config.mode === 'subject') {
      return (
        <div className="flex flex-col items-center gap-1">
          {r.levelCode ? (
            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${
              r.levelCode === 'T' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
              r.levelCode === 'H' ? 'bg-sky-50 text-sky-600 border-sky-100' : 'bg-rose-50 text-rose-600 border-rose-100'
            }`}>{r.levelCode}</span>
          ) : (
            <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold border bg-rose-50 text-rose-600 border-rose-100">Chưa rõ mức</span>
          )}
          {r.score !== null && r.score !== undefined && <span className="text-xs font-bold text-slate-500">{r.score}</span>}
        </div>
      );
    }
    if (config.mode === 'pcnl') {
      const entries = Object.entries(r.pcnl || {}).filter(([, v]) => v);
      return (
        <div className="flex flex-wrap gap-1 justify-center max-w-[220px]">
          {entries.map(([k, v]) => (
            <span key={k} className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${
              v === 'Tốt' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
              v === 'Đạt' ? 'bg-sky-50 text-sky-600 border-sky-100' : 'bg-amber-50 text-amber-600 border-amber-100'
            }`}>{k}: {v}</span>
          ))}
        </div>
      );
    }
    const y = r.yearEnd;
    return (
      <div className="flex flex-col items-center gap-1">
        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${
          y?.result === 'Hoàn thành xuất sắc' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
          y?.result === 'Hoàn thành tốt' ? 'bg-teal-50 text-teal-600 border-teal-100' :
          y?.result === 'Hoàn thành' ? 'bg-sky-50 text-sky-600 border-sky-100' :
          y?.result === 'Chưa hoàn thành' ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-slate-50 text-slate-500 border-slate-200'
        }`}>{y?.result || '—'}</span>
        {y?.award && <span className="text-[10px] font-bold text-amber-600 text-center">{y.award}</span>}
      </div>
    );
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

        {records.length > 0 && issueCount > 0 && (
          <div className="mb-8 bg-white border-l-4 border-amber-400 p-6 rounded-2xl shadow-sm">
            <p className="text-xs font-black text-amber-500 uppercase mb-1 tracking-widest">Dữ kiện cần rà lại: {issueCount} học sinh</p>
            <ul className="text-sm text-slate-600 font-medium space-y-1">
              {records.filter(r => r.issues.length).slice(0, 5).map(r => (
                <li key={r.id}><span className="font-bold">{r.name}:</span> {r.issues.join('; ')}</li>
              ))}
              {issueCount > 5 && <li>… và {issueCount - 5} học sinh khác (xem dòng chữ đỏ dưới tên từng em).</li>}
            </ul>
          </div>
        )}

        <div className={`grid grid-cols-1 lg:grid-cols-12 gap-10 transition-all duration-500 ${isConfigOpen && !localStorage.getItem('user_api_key') ? 'blur-sm grayscale opacity-50 pointer-events-none' : ''}`}>

          <div className="lg:col-span-4 space-y-6">
            <section className="bg-white p-8 rounded-[24px] shadow-lg shadow-[#20c997]/5 border border-white">
              <h2 className="text-sm font-extrabold text-[#20c997] uppercase tracking-widest mb-8 flex items-center">
                <span className="w-2 h-2 rounded-full bg-[#20c997] mr-3"></span>
                Thiết lập đánh giá
              </h2>

              <div className="space-y-8">
                {/* Mode */}
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase mb-4 block tracking-wider">Chế độ</label>
                  <div className="grid grid-cols-3 gap-2">
                    {MODES.map(m => (
                      <button
                        key={m.key}
                        onClick={() => switchMode(m.key)}
                        className={`py-3 px-1 rounded-xl text-[11px] font-bold transition-all border border-transparent ${
                          config.mode === m.key ? 'bg-[#20c997] text-white shadow-md shadow-[#20c997]/30' : 'bg-slate-50 text-slate-500 hover:bg-[#20c997]/10 hover:text-[#20c997]'
                        }`}
                      >{m.label}</button>
                    ))}
                  </div>
                </div>

                {/* Grade */}
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase mb-4 block tracking-wider">Khối lớp</label>
                  <div className="flex justify-between gap-2">
                    {(['1', '2', '3', '4', '5'] as Grade[]).map(g => (
                      <button
                        key={g}
                        onClick={() => { setConfig(prev => ({ ...prev, grade: g })); if (config.mode === 'summary') setRecords([]); }}
                        className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold transition-all shadow-sm ${
                          config.grade === g
                          ? `${GRADE_CONFIG[g].activeBg} text-white shadow-lg scale-110 ring-4 ring-offset-2 ${GRADE_CONFIG[g].ring}`
                          : 'bg-slate-50 text-slate-400 hover:bg-slate-100'
                        }`}
                      >{g}</button>
                    ))}
                  </div>
                </div>

                {/* Term */}
                {config.mode !== 'summary' && (
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase mb-4 block tracking-wider">Thời điểm</label>
                    <div className="grid grid-cols-2 gap-3">
                      {TERMS.map(t => (
                        <button
                          key={t}
                          onClick={() => setConfig(prev => ({ ...prev, term: t }))}
                          className={`py-3 px-2 rounded-xl text-[11px] font-bold transition-all border border-transparent ${
                            config.term === t ? 'bg-[#20c997] text-white shadow-md shadow-[#20c997]/30' : 'bg-slate-50 text-slate-500 hover:bg-[#20c997]/10 hover:text-[#20c997]'
                          }`}
                        >{t}</button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Subject (mode subject) */}
                {config.mode === 'subject' && (
                  <>
                    <div>
                      <label className="text-[11px] font-bold text-slate-400 uppercase mb-4 block tracking-wider">Môn học</label>
                      <div className="relative">
                        <select
                          value={config.subjectContext}
                          onChange={(e) => setConfig({ ...config, subjectContext: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-[#20c997] focus:ring-2 focus:ring-[#20c997]/20 appearance-none cursor-pointer transition-all"
                        >
                          {SUBJECT_MAP[config.grade].map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7"/></svg>
                        </div>
                      </div>
                    </div>

                    {isScoredSubject(config.subjectContext) ? (
                      <div>
                        <label className="text-[11px] font-bold text-slate-400 uppercase mb-4 block tracking-wider">Căn cứ đánh giá</label>
                        <div className="grid grid-cols-3 gap-2">
                          {([['score', 'Điểm số'], ['level', 'Mức đạt'], ['both', 'Cả hai']] as const).map(([key, label]) => (
                            <button
                              key={key}
                              onClick={() => setConfig({ ...config, evaluationBasis: key })}
                              className={`py-3 px-1 rounded-xl text-[11px] font-bold transition-all border border-transparent ${
                                config.evaluationBasis === key ? 'bg-[#20c997] text-white shadow-md shadow-[#20c997]/30' : 'bg-slate-50 text-slate-500 hover:bg-[#20c997]/10 hover:text-[#20c997]'
                              }`}
                            >{label}</button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <span className="inline-block px-3 py-2 rounded-xl text-[11px] font-bold bg-slate-50 text-slate-500">Môn chỉ nhận xét — căn cứ: Mức đạt</span>
                      </div>
                    )}

                    <div>
                      <label className="text-[11px] font-bold text-slate-400 uppercase mb-4 block tracking-wider">Nội dung đã học trong kỳ</label>
                      <textarea
                        value={config.classTopics}
                        onChange={(e) => setConfig({ ...config, classTopics: e.target.value })}
                        rows={3}
                        placeholder="VD: Đọc hiểu truyện dân gian; nhân, chia trong phạm vi 1000; viết đoạn văn tả đồ vật…"
                        className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4 text-sm font-medium text-slate-700 outline-none focus:bg-white focus:border-[#20c997] focus:ring-2 focus:ring-[#20c997]/20 transition-all resize-none"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Nêu điểm cần cố gắng</label>
                      <button
                        onClick={() => setConfig({ ...config, includeWeakness: !config.includeWeakness })}
                        className={`py-2 px-4 rounded-xl text-[11px] font-bold transition-all ${config.includeWeakness ? 'bg-[#20c997] text-white shadow-md shadow-[#20c997]/30' : 'bg-slate-50 text-slate-500'}`}
                      >{config.includeWeakness ? 'Bật' : 'Tắt'}</button>
                    </div>
                  </>
                )}

                {/* Upload */}
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase mb-4 block tracking-wider">Dữ liệu nguồn</label>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-[24px] p-8 flex flex-col items-center justify-center cursor-pointer transition-all group ${
                      records.length > 0 ? 'border-[#20c997] bg-[#20c997]/5' : 'border-slate-200 bg-slate-50 hover:border-[#20c997]/50 hover:bg-white'
                    }`}
                  >
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-3 shadow-sm transition-transform group-hover:scale-110 ${records.length > 0 ? 'bg-[#20c997] text-white' : 'bg-white text-[#20c997]'}`}>
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                    </div>
                    <p className={`text-xs font-bold text-center ${records.length > 0 ? 'text-[#20c997]' : 'text-slate-500 group-hover:text-[#20c997]'}`}>
                      {records.length > 0 ? `Đã tải ${records.length} học sinh` : 'Chạm để tải file Excel'}
                    </p>
                    {records.length === 0 && (
                      <p className="text-[10px] text-slate-400 mt-2 text-center max-w-[220px] leading-tight">
                        {config.mode === 'subject' && '(File dữ liệu đã nhập điểm số hoặc mức đạt được trên CSDL)'}
                        {config.mode === 'pcnl' && '(Cột mang tên từng phẩm chất/năng lực, giá trị Tốt/Đạt/Cần cố gắng)'}
                        {config.mode === 'summary' && '(Cột "Mức <tên môn>", "Điểm <tên môn>", Phẩm chất, Năng lực)'}
                      </p>
                    )}
                    <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls" onChange={handleFileUpload} />
                  </div>
                </div>
              </div>

              {/* Generate buttons */}
              <div className="mt-10 space-y-3">
                <button
                  disabled={pendingTargets.length === 0 || isProcessing}
                  onClick={() => generateFor(pendingTargets)}
                  className={`w-full py-5 rounded-[20px] font-extrabold text-sm uppercase tracking-widest transition-all transform active:scale-95 shadow-xl ${
                    pendingTargets.length === 0 || isProcessing
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
                      Đang xử lý{progress ? ` ${progress.done}/${progress.total}` : ''}...
                    </span>
                  ) : records.length > 0 && pendingTargets.length === 0 ? 'Đã tạo xong' : 'Bắt đầu tạo nhận xét'}
                </button>
                {invalidCount > 0 && !isProcessing && (
                  <p className="text-[11px] font-bold text-rose-500 text-center">{invalidCount} học sinh thiếu/không đọc được dữ liệu — sửa file Excel rồi tải lại</p>
                )}
              </div>
            </section>
          </div>

          {/* MAIN CONTENT */}
          <div className="lg:col-span-8">
            {records.length > 0 ? (
              <div className="bg-white rounded-[24px] shadow-xl shadow-[#20c997]/5 border border-slate-100 overflow-hidden animate-in slide-in-from-bottom-8 duration-500">
                <div className="px-8 py-6 bg-slate-50/50 border-b border-slate-100 flex justify-between items-center">
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">
                      {config.mode === 'subject' ? config.subjectContext : config.mode === 'pcnl' ? 'Phẩm chất & Năng lực' : 'Tổng hợp cuối năm'}
                    </h3>
                    <div className="flex gap-2 mt-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${GRADE_CONFIG[config.grade].bg} ${GRADE_CONFIG[config.grade].text}`}>Lớp {config.grade}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase bg-slate-100 text-slate-500">{config.mode === 'summary' ? 'Cuối năm học' : config.term}</span>
                      {errorCount > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase bg-rose-50 text-rose-600">{errorCount} dòng lỗi</span>}
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
                        <th className="px-8 py-5 text-left bg-slate-50/50">{commentTitle}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {records.map(r => (
                        <tr key={r.id} className="hover:bg-slate-50/80 transition-colors group">
                          <td className="px-8 py-6 align-top">
                            <div className="text-sm font-bold text-slate-700 group-hover:text-[#20c997] transition-colors">{r.name}</div>
                            <div className="text-[10px] text-slate-400 font-mono mt-1">{r.id.split('-')[1]}</div>
                            {r.issues.length > 0 && (
                              <div className="text-[10px] text-rose-500 font-bold mt-1 max-w-[180px] leading-snug">{r.issues.join('; ')}</div>
                            )}
                            {r.status === 'error' && (
                              <div className="text-[10px] text-rose-500 font-bold mt-1">Tạo chưa thành công — bấm nút tạo để thử lại dòng này</div>
                            )}
                          </td>
                          <td className="px-4 py-6 text-center align-top">{renderResultCell(r)}</td>
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
                                  onChange={(e) => setRecords(prev => prev.map(p => p.id === r.id ? { ...p, comment: e.target.value, status: 'completed' } : p))}
                                  className="w-full text-sm text-slate-600 bg-transparent border-2 border-transparent hover:border-slate-100 focus:border-[#20c997] focus:bg-white rounded-xl p-3 transition-all outline-none resize-none leading-relaxed"
                                  rows={3}
                                  placeholder={r.status === 'invalid' ? 'Thiếu dữ liệu — chưa tạo được' : ''}
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
