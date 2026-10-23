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

// Tự lưu nháp: danh sách + nhận xét đã tạo/sửa được lưu vào máy, mở lại app là làm tiếp
const DRAFT_KEY = 'danhgia_draft_v1';
function loadDraft(): { config: Partial<GenerationConfig>; records: StudentRecord[] } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.records) || d.records.length === 0) return null;
    const records = d.records.map((r: StudentRecord) => ({
      ...r,
      status: r.status === 'processing' ? 'pending' : r.status,
      issues: Array.isArray(r.issues) ? r.issues : [],
    }));
    return { config: d.config || {}, records };
  } catch {
    return null;
  }
}

const foldText = (s: string): string =>
  (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const PCNL_RANK: Record<PcnlLevel, number> = { 'Tốt': 3, 'Đạt': 2, 'Cần cố gắng': 1 };

const App: React.FC = () => {
  const [draft] = useState(loadDraft);
  const [records, setRecords] = useState<StudentRecord[]>(() => draft?.records || []);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Không khoá cứng giao diện khi chưa có khoá (bản cũ làm mờ + chặn toàn bộ app):
  // trạng thái khoá hiện bằng pill ở cột thiết lập, bấm vào mới mở hộp thoại — theo mẫu các app mới.
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const hasKey = !!localStorage.getItem('user_api_key') || !!process.env.API_KEY;

  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [config, setConfig] = useState<GenerationConfig>({
    tone: 'encouraging',
    includeWeakness: true,
    subjectContext: 'Tiếng Việt',
    grade: '1',
    evaluationBasis: 'both',
    term: 'Cuối học kỳ 1',
    mode: 'subject',
    classTopics: '',
    ...(draft?.config || {})
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cỡ chữ lớn (lưu lựa chọn vào máy)
  const [fontLarge, setFontLarge] = useState(() => { try { return localStorage.getItem('ui_font_large') === '1'; } catch { return false; } });
  useEffect(() => {
    try { localStorage.setItem('ui_font_large', fontLarge ? '1' : '0'); } catch { /* bỏ qua */ }
  }, [fontLarge]);

  // Lọc + tìm trong bảng kết quả (chỉ ảnh hưởng hiển thị)
  const [query, setQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [isDragging, setIsDragging] = useState(false);

  // Tự lưu nháp mỗi khi danh sách/cấu hình đổi (trì hoãn 400ms tránh ghi liên tục khi gõ)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (records.length > 0) {
          const safe = records.map(r => ({ ...r, status: r.status === 'processing' ? 'pending' as const : r.status }));
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ config, records: safe }));
        } else {
          localStorage.removeItem(DRAFT_KEY);
        }
      } catch { /* máy hết dung lượng lưu trữ thì bỏ qua */ }
    }, 400);
    return () => clearTimeout(t);
  }, [records, config]);

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
    const file = e.target.files?.[0];
    if (file) processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const processFile = (file: File) => {
    setErrorMessage(null);

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
    let firstError = '';

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
      } catch (e: any) {
        if (!firstError) firstError = e?.message || 'Lỗi kết nối AI.';
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
      if (firstError && working.some(r => r.status === 'error')) setErrorMessage(firstError);
      setIsProcessing(false);
      setProgress(null);
    }
  };

  const pendingTargets = records.filter(r => r.status === 'pending' || r.status === 'error');
  const errorCount = records.filter(r => r.status === 'error').length;
  const invalidCount = records.filter(r => r.status === 'invalid').length;
  const issueCount = records.filter(r => r.issues.length > 0).length;

  // Lọc theo mức + tìm theo tên — chỉ tác động hiển thị, tạo/xuất vẫn trên toàn bộ danh sách
  type FilterOpt = { key: string; label: string; count: number; match: (r: StudentRecord) => boolean };
  const filterOptions: FilterOpt[] = (() => {
    const all: FilterOpt = { key: 'all', label: 'Tất cả', count: records.length, match: () => true };
    if (config.mode === 'subject') {
      const by = (c: LevelCode) => records.filter(r => r.levelCode === c);
      return [
        all,
        { key: 'T', label: 'Hoàn thành tốt', count: by('T').length, match: r => r.levelCode === 'T' },
        { key: 'H', label: 'Hoàn thành', count: by('H').length, match: r => r.levelCode === 'H' },
        { key: 'C', label: 'Chưa hoàn thành', count: by('C').length, match: r => r.levelCode === 'C' },
        { key: 'invalid', label: 'Thiếu dữ liệu', count: invalidCount, match: r => r.status === 'invalid' },
      ];
    }
    if (config.mode === 'pcnl') {
      const has = (v: PcnlLevel) => records.filter(r => Object.values(r.pcnl || {}).includes(v));
      return [
        all,
        { key: 'tot', label: 'Có mức Tốt', count: has('Tốt').length, match: r => Object.values(r.pcnl || {}).includes('Tốt') },
        { key: 'dat', label: 'Có mức Đạt', count: has('Đạt').length, match: r => Object.values(r.pcnl || {}).includes('Đạt') },
        { key: 'ccg', label: 'Có Cần cố gắng', count: has('Cần cố gắng').length, match: r => Object.values(r.pcnl || {}).includes('Cần cố gắng') },
        { key: 'invalid', label: 'Thiếu dữ liệu', count: invalidCount, match: r => r.status === 'invalid' },
      ];
    }
    const byResult = (res: string) => records.filter(r => r.yearEnd?.result === res);
    return [
      all,
      { key: 'xs', label: 'Xuất sắc', count: byResult('Hoàn thành xuất sắc').length, match: r => r.yearEnd?.result === 'Hoàn thành xuất sắc' },
      { key: 'htt', label: 'Hoàn thành tốt', count: byResult('Hoàn thành tốt').length, match: r => r.yearEnd?.result === 'Hoàn thành tốt' },
      { key: 'ht', label: 'Hoàn thành', count: byResult('Hoàn thành').length, match: r => r.yearEnd?.result === 'Hoàn thành' },
      { key: 'cht', label: 'Chưa hoàn thành', count: byResult('Chưa hoàn thành').length, match: r => r.yearEnd?.result === 'Chưa hoàn thành' },
      { key: 'invalid', label: 'Thiếu dữ liệu', count: invalidCount, match: r => r.status === 'invalid' },
    ];
  })();
  const activeFilter = filterOptions.find(f => f.key === levelFilter) || filterOptions[0];
  const visibleRecords = records.filter(r =>
    activeFilter.match(r) && (!query.trim() || foldText(r.name).includes(foldText(query.trim())))
  );

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
    if (mode === config.mode) return;
    // Đổi chế độ làm mất danh sách đã tải — phải hỏi trước, không xoá lặng lẽ
    if (records.length > 0 && !window.confirm('Đổi chế độ sẽ xoá danh sách học sinh đã tải. Tiếp tục?')) return;
    setConfig(prev => ({ ...prev, mode, term: mode === 'summary' ? 'Cuối năm học' : prev.term }));
    setRecords([]);
    setErrorMessage(null);
  };

  const downloadSample = () => {
    let aoa: any[][];
    let fileName: string;
    if (config.mode === 'pcnl') {
      aoa = [
        ['Họ và tên', ...PCNL_ITEMS],
        ['Nguyễn Văn An', 'Tốt', 'Tốt', 'Tốt', 'Đạt', 'Tốt', 'Tốt', 'Đạt', 'Tốt'],
        ['Trần Thị Bình', 'Đạt', 'Tốt', 'Đạt', 'Đạt', 'Đạt', 'Đạt', 'Đạt', 'Cần cố gắng'],
      ];
      fileName = 'FileMau_PhamChatNangLuc.xlsx';
    } else if (config.mode === 'summary') {
      const subjects = SUBJECT_MAP[config.grade];
      const scored = subjects.filter(isScoredSubject);
      aoa = [
        ['Họ và tên', ...subjects.map(s => `Mức ${s}`), ...scored.map(s => `Điểm ${s}`), 'Phẩm chất', 'Năng lực'],
        ['Nguyễn Văn An', ...subjects.map(() => 'T'), ...scored.map(() => 9), 'Tốt', 'Tốt'],
        ['Trần Thị Bình', ...subjects.map((_, i) => (i === 1 ? 'C' : 'H')), ...scored.map(() => 5), 'Đạt', 'Đạt'],
      ];
      fileName = `FileMau_TongHopCuoiNam_Lop${config.grade}.xlsx`;
    } else {
      aoa = [
        ['Họ và tên', 'Mức đạt được', 'Điểm KTĐK', 'Điểm mạnh', 'Cần cố gắng', 'Ghi chú'],
        ['Nguyễn Văn An', 'Hoàn thành tốt', 9, '', '', ''],
        ['Trần Thị Bình', 'Hoàn thành', 7, '', '', ''],
        ['Lê Văn Cường', 'Chưa hoàn thành', 4, '', 'Phép chia', ''],
      ];
      fileName = 'FileMau_MonHoc.xlsx';
    }
    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Mau');
    XLSX.writeFile(workbook, fileName);
  };

  const commentTitle = config.mode === 'pcnl' ? 'Nhận xét phẩm chất, năng lực' : config.mode === 'summary' ? 'Nhận xét học bạ' : 'Nội dung nhận xét AI';

  const renderResultCell = (r: StudentRecord) => {
    if (config.mode === 'subject') {
      return (
        <div className="flex flex-col items-center gap-1">
          {r.levelCode ? (
            <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
              r.levelCode === 'T' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
              r.levelCode === 'H' ? 'bg-sky-50 text-sky-600 border-sky-100' : 'bg-rose-50 text-rose-600 border-rose-100'
            }`}>{r.levelCode}</span>
          ) : (
            <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold border bg-rose-50 text-rose-600 border-rose-100">Chưa rõ mức</span>
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
            <span key={k} className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border ${
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
        <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
          y?.result === 'Hoàn thành xuất sắc' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
          y?.result === 'Hoàn thành tốt' ? 'bg-teal-50 text-teal-600 border-teal-100' :
          y?.result === 'Hoàn thành' ? 'bg-sky-50 text-sky-600 border-sky-100' :
          y?.result === 'Chưa hoàn thành' ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-slate-50 text-slate-500 border-slate-200'
        }`}>{y?.result || '—'}</span>
        {y?.award && <span className="text-[11px] font-bold text-amber-600 text-center">{y.award}</span>}
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#e6fcf5] text-slate-800 font-sans selection:bg-[#20c997] selection:text-white" style={{ zoom: fontLarge ? 1.15 : 1 }}>
      <Header onOpenConfig={() => setIsConfigOpen(true)} />

      <main className={`flex-grow max-w-[1400px] mx-auto px-6 py-10 w-full ${records.length > 0 ? 'pb-28 lg:pb-10' : ''}`}>
        {errorMessage && (
          <div className="mb-8 bg-white border-l-4 border-red-500 p-6 rounded-2xl shadow-sm animate-in fade-in slide-in-from-top-4">
            <p className="text-xs font-black text-red-500 uppercase mb-1 tracking-widest">Lỗi hệ thống</p>
            <p className="text-sm text-slate-600 font-medium">{errorMessage}</p>
          </div>
        )}

        {records.length > 0 && issueCount > 0 && (
          <div className="mb-8 bg-white border-l-4 border-amber-400 p-6 rounded-2xl shadow-sm no-print">
            <p className="text-xs font-black text-amber-500 uppercase mb-1 tracking-widest">Dữ kiện cần rà lại: {issueCount} học sinh</p>
            <ul className="text-sm text-slate-600 font-medium space-y-1">
              {records.filter(r => r.issues.length).slice(0, 5).map(r => (
                <li key={r.id}><span className="font-bold">{r.name}:</span> {r.issues.join('; ')}</li>
              ))}
              {issueCount > 5 && <li>… và {issueCount - 5} học sinh khác (xem dòng chữ đỏ dưới tên từng em).</li>}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">

          <div className="lg:col-span-4 space-y-6">
            <section className="bg-white p-8 rounded-[24px] shadow-lg shadow-[#20c997]/5 border border-white lg:sticky lg:top-24 no-print">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-[15px] font-extrabold text-[#087f5b] uppercase tracking-widest flex items-center">
                  <span className="w-2 h-2 rounded-full bg-[#20c997] mr-3"></span>
                  Thiết lập đánh giá
                </h2>
                <button
                  onClick={() => setIsConfigOpen(true)}
                  className={`px-3 py-2 rounded-full text-[11px] font-bold uppercase tracking-wider transition-all ${
                    hasKey ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-amber-50 text-amber-600 border border-amber-200 animate-pulse'
                  }`}
                >
                  {hasKey ? 'Khoá AI: Đã nhập' : 'Chưa nhập khoá AI'}
                </button>
              </div>

              <div className="space-y-8">
                {/* Mode */}
                <div>
                  <label className="text-[13px] font-bold text-slate-500 uppercase mb-4 block tracking-wider">Chế độ</label>
                  <div className="grid grid-cols-3 gap-2">
                    {MODES.map(m => (
                      <button
                        key={m.key}
                        onClick={() => switchMode(m.key)}
                        className={`py-3.5 px-1 rounded-xl text-xs font-bold transition-all border border-transparent ${
                          config.mode === m.key ? 'bg-[#087f5b] text-white shadow-md shadow-[#087f5b]/30' : 'bg-slate-50 text-slate-500 hover:bg-[#20c997]/10 hover:text-[#20c997]'
                        }`}
                      >{m.label}</button>
                    ))}
                  </div>
                </div>

                {/* Cỡ chữ */}
                <div className="flex items-center justify-between">
                  <label className="text-[13px] font-bold text-slate-500 uppercase tracking-wider">Cỡ chữ</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setFontLarge(false)}
                      className={`py-2.5 px-4 rounded-xl text-xs font-bold transition-all ${!fontLarge ? 'bg-[#087f5b] text-white shadow-md shadow-[#087f5b]/30' : 'bg-slate-50 text-slate-500 hover:bg-[#20c997]/10'}`}
                    >Thường</button>
                    <button
                      onClick={() => setFontLarge(true)}
                      className={`py-2.5 px-4 rounded-xl text-xs font-bold transition-all ${fontLarge ? 'bg-[#087f5b] text-white shadow-md shadow-[#087f5b]/30' : 'bg-slate-50 text-slate-500 hover:bg-[#20c997]/10'}`}
                    >Lớn</button>
                  </div>
                </div>

                {/* Grade */}
                <div>
                  <label className="text-[13px] font-bold text-slate-500 uppercase mb-4 block tracking-wider">Khối lớp</label>
                  <div className="flex justify-between gap-2">
                    {(['1', '2', '3', '4', '5'] as Grade[]).map(g => (
                      <button
                        key={g}
                        onClick={() => {
                          if (g === config.grade) return;
                          if (config.mode === 'summary' && records.length > 0 && !window.confirm('Đổi khối ở chế độ Tổng hợp sẽ xoá danh sách đã tải. Tiếp tục?')) return;
                          setConfig(prev => ({ ...prev, grade: g }));
                          if (config.mode === 'summary') setRecords([]);
                        }}
                        className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold transition-all shadow-sm ${
                          config.grade === g
                          ? `${GRADE_CONFIG[g].activeBg} text-white shadow-lg scale-110 ring-4 ring-offset-2 ${GRADE_CONFIG[g].ring}`
                          : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                        }`}
                      >{g}</button>
                    ))}
                  </div>
                </div>

                {/* Term */}
                {config.mode !== 'summary' && (
                  <div>
                    <label className="text-[13px] font-bold text-slate-500 uppercase mb-4 block tracking-wider">Thời điểm</label>
                    <div className="grid grid-cols-2 gap-3">
                      {TERMS.map(t => (
                        <button
                          key={t}
                          onClick={() => setConfig(prev => ({ ...prev, term: t }))}
                          className={`py-3.5 px-2 rounded-xl text-xs font-bold transition-all border border-transparent ${
                            config.term === t ? 'bg-[#087f5b] text-white shadow-md shadow-[#087f5b]/30' : 'bg-slate-50 text-slate-500 hover:bg-[#20c997]/10 hover:text-[#20c997]'
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
                      <label className="text-[13px] font-bold text-slate-500 uppercase mb-4 block tracking-wider">Môn học</label>
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
                        <label className="text-[13px] font-bold text-slate-500 uppercase mb-4 block tracking-wider">Căn cứ đánh giá</label>
                        <div className="grid grid-cols-3 gap-2">
                          {([['score', 'Điểm số'], ['level', 'Mức đạt'], ['both', 'Cả hai']] as const).map(([key, label]) => (
                            <button
                              key={key}
                              onClick={() => setConfig({ ...config, evaluationBasis: key })}
                              className={`py-3.5 px-1 rounded-xl text-xs font-bold transition-all border border-transparent ${
                                config.evaluationBasis === key ? 'bg-[#087f5b] text-white shadow-md shadow-[#087f5b]/30' : 'bg-slate-50 text-slate-500 hover:bg-[#20c997]/10 hover:text-[#20c997]'
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
                      <label className="text-[13px] font-bold text-slate-500 uppercase mb-4 block tracking-wider">Nội dung đã học trong kỳ</label>
                      <textarea
                        value={config.classTopics}
                        onChange={(e) => setConfig({ ...config, classTopics: e.target.value })}
                        rows={3}
                        placeholder="VD: Đọc hiểu truyện dân gian; nhân, chia trong phạm vi 1000; viết đoạn văn tả đồ vật…"
                        className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4 text-sm font-medium text-slate-700 outline-none focus:bg-white focus:border-[#20c997] focus:ring-2 focus:ring-[#20c997]/20 transition-all resize-none"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="text-[13px] font-bold text-slate-500 uppercase tracking-wider">Nêu điểm cần cố gắng</label>
                      <button
                        onClick={() => setConfig({ ...config, includeWeakness: !config.includeWeakness })}
                        className={`py-2 px-4 rounded-xl text-[11px] font-bold transition-all ${config.includeWeakness ? 'bg-[#087f5b] text-white shadow-md shadow-[#087f5b]/30' : 'bg-slate-50 text-slate-500'}`}
                      >{config.includeWeakness ? 'Bật' : 'Tắt'}</button>
                    </div>
                  </>
                )}

                {/* Upload */}
                <div>
                  <label className="text-[13px] font-bold text-slate-500 uppercase mb-4 block tracking-wider">Dữ liệu nguồn</label>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) processFile(f); }}
                    className={`border-2 border-dashed rounded-[24px] p-8 flex flex-col items-center justify-center cursor-pointer transition-all group ${
                      isDragging ? 'border-[#087f5b] bg-[#087f5b]/10 scale-[1.02]' : records.length > 0 ? 'border-[#20c997] bg-[#20c997]/5' : 'border-slate-200 bg-slate-50 hover:border-[#20c997]/50 hover:bg-white'
                    }`}
                  >
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-3 shadow-sm transition-transform group-hover:scale-110 ${records.length > 0 ? 'bg-[#20c997] text-white' : 'bg-white text-[#20c997]'}`}>
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                    </div>
                    <p className={`text-xs font-bold text-center ${records.length > 0 ? 'text-[#20c997]' : 'text-slate-500 group-hover:text-[#20c997]'}`}>
                      {records.length > 0 ? `Đã tải ${records.length} học sinh` : 'Chạm để tải file Excel'}
                    </p>
                    {records.length === 0 && (
                      <p className="text-xs text-slate-500 mt-2 text-center max-w-[220px] leading-tight">
                        {config.mode === 'subject' && '(File dữ liệu đã nhập điểm số hoặc mức đạt được trên CSDL)'}
                        {config.mode === 'pcnl' && '(Cột mang tên từng phẩm chất/năng lực, giá trị Tốt/Đạt/Cần cố gắng)'}
                        {config.mode === 'summary' && '(Cột "Mức <tên môn>", "Điểm <tên môn>", Phẩm chất, Năng lực)'}
                      </p>
                    )}
                    <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls" onChange={handleFileUpload} />
                  </div>
                  <button
                    onClick={downloadSample}
                    className="mt-3 w-full py-2.5 rounded-xl text-[11px] font-bold bg-slate-50 text-slate-500 hover:bg-[#20c997]/10 hover:text-[#20c997] transition-all"
                  >
                    Tải file mẫu
                  </button>
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
                    : 'bg-gradient-to-r from-[#ffc107] to-[#fd7e14] text-[#4a2703] hover:shadow-orange-200 hover:-translate-y-1'
                  }`}
                >
                  {isProcessing ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5 text-[#4a2703]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
                {isProcessing && progress && progress.total > 0 && (
                  <div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#0ca678] rounded-full transition-all duration-500" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}></div>
                    </div>
                    <p className="text-[11px] font-bold text-slate-500 text-center mt-2">Đã xong {progress.done}/{progress.total} ({Math.round((progress.done / progress.total) * 100)}%)</p>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* MAIN CONTENT */}
          <div className="lg:col-span-8 print-full">
            {records.length > 0 ? (
              <div className="bg-white rounded-[24px] shadow-xl shadow-[#20c997]/5 border border-slate-100 overflow-hidden animate-in slide-in-from-bottom-8 duration-500">
                <div className="px-8 py-6 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">
                      {config.mode === 'subject' ? config.subjectContext : config.mode === 'pcnl' ? 'Phẩm chất & Năng lực' : 'Tổng hợp cuối năm'}
                    </h3>
                    <div className="flex gap-2 mt-1">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded uppercase ${GRADE_CONFIG[config.grade].bg} ${GRADE_CONFIG[config.grade].text}`}>Lớp {config.grade}</span>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded uppercase bg-slate-100 text-slate-500">{config.mode === 'summary' ? 'Cuối năm học' : config.term}</span>
                      {errorCount > 0 && <span className="text-[11px] font-bold px-2 py-0.5 rounded uppercase bg-rose-50 text-rose-600">{errorCount} dòng lỗi</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 no-print">
                    <span className="hidden md:inline-block text-[11px] font-bold text-slate-400 mr-1">Đã tự lưu nháp</span>
                    <button
                      onClick={() => window.print()}
                      className="px-4 py-3 bg-white text-slate-500 border border-slate-200 rounded-xl text-xs font-bold uppercase tracking-wider hover:text-[#087f5b] hover:border-[#0ca678] active:scale-95 transition-all"
                    >
                      In DS
                    </button>
                    <button
                      onClick={() => { if (window.confirm('Xoá danh sách học sinh đã tải?')) { setRecords([]); setErrorMessage(null); } }}
                      className="px-4 py-3 bg-white text-slate-500 border border-slate-200 rounded-xl text-xs font-bold uppercase tracking-wider hover:text-rose-500 hover:border-rose-200 active:scale-95 transition-all"
                    >
                      Xoá DS
                    </button>
                    <button
                      onClick={exportToExcel}
                      className="px-6 py-3 bg-[#087f5b] text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-[#0ca678] shadow-lg shadow-[#20c997]/20 active:scale-95 flex items-center gap-2 transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      Xuất Excel
                    </button>
                  </div>
                </div>

                <div className="px-8 py-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center gap-3 no-print">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Tìm theo tên..."
                    className="md:w-56 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm font-medium text-slate-700 outline-none focus:bg-white focus:border-[#0ca678] focus:ring-2 focus:ring-[#0ca678]/20 transition-all"
                  />
                  <div className="flex gap-2 flex-wrap">
                    {filterOptions.map(f => (
                      <button
                        key={f.key}
                        onClick={() => setLevelFilter(f.key)}
                        className={`px-3.5 py-2.5 rounded-full text-xs font-bold transition-all ${
                          activeFilter.key === f.key ? 'bg-[#087f5b] text-white shadow-md shadow-[#087f5b]/25' : 'bg-slate-50 text-slate-500 hover:bg-[#20c997]/10 hover:text-[#087f5b]'
                        }`}
                      >
                        {f.label} · {f.count}
                      </button>
                    ))}
                  </div>
                  {(query || activeFilter.key !== 'all') && (
                    <span className="text-xs font-bold text-slate-500">Đang hiện {visibleRecords.length}/{records.length}</span>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-xs font-extrabold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                        <th className="px-8 py-5 text-left bg-slate-50 sticky top-[74px] z-10">Học sinh</th>
                        <th className="px-4 py-5 text-center bg-slate-50 sticky top-[74px] z-10">Kết quả</th>
                        <th className="px-8 py-5 text-left bg-slate-50 sticky top-[74px] z-10">{commentTitle}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {visibleRecords.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-8 py-10 text-center text-sm font-bold text-slate-400">Không có học sinh nào khớp bộ lọc / từ khoá tìm kiếm.</td>
                        </tr>
                      )}
                      {visibleRecords.map(r => (
                        <tr key={r.id} className="hover:bg-slate-50/80 transition-colors group">
                          <td className="px-8 py-6 align-top">
                            <div className="text-[15px] font-bold text-slate-700 group-hover:text-[#087f5b] transition-colors">{r.name}</div>
                            {r.issues.length > 0 && (
                              <div className="text-[11px] text-rose-500 font-bold mt-1 max-w-[180px] leading-snug">{r.issues.join('; ')}</div>
                            )}
                            {r.status === 'error' && (
                              <div className="text-[11px] text-rose-500 font-bold mt-1">Tạo chưa thành công — bấm nút tạo để thử lại dòng này</div>
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
                                  className="w-full text-[15px] text-slate-600 bg-transparent border-2 border-transparent hover:border-slate-100 focus:border-[#20c997] focus:bg-white rounded-xl p-3 transition-all outline-none resize-none leading-[1.65]"
                                  rows={3}
                                  placeholder={r.status === 'invalid' ? 'Thiếu dữ liệu — chưa tạo được' : ''}
                                />
                                <button
                                  onClick={() => handleCopy(r.comment || '', r.id)}
                                  aria-label="Sao chép nhận xét"
                                  className={`absolute top-1 right-1 w-11 h-11 flex items-center justify-center rounded-lg transition-all ${copyStatus === r.id ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:text-[#087f5b] hover:bg-slate-50 opacity-100 lg:opacity-0 lg:group-hover/edit:opacity-100'}`}
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
                <p className="text-slate-500 max-w-md mx-auto leading-relaxed text-[15px] font-medium">
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

      {/* Thanh nút dính đáy cho điện thoại — khỏi cuộn lên đầu trang khi bảng dài */}
      {records.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 lg:hidden bg-white/90 backdrop-blur-md border-t border-[#20c997]/15 px-4 py-3 flex gap-3 no-print" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <button
            disabled={pendingTargets.length === 0 || isProcessing}
            onClick={() => generateFor(pendingTargets)}
            className={`flex-1 py-3.5 rounded-xl font-extrabold text-xs uppercase tracking-widest active:scale-95 transition-all ${
              pendingTargets.length === 0 || isProcessing ? 'bg-slate-100 text-slate-300' : 'bg-gradient-to-r from-[#ffc107] to-[#fd7e14] text-[#4a2703] shadow-lg'
            }`}
          >
            {isProcessing ? `Đang xử lý${progress ? ` ${progress.done}/${progress.total}` : ''}...` : pendingTargets.length === 0 ? 'Đã tạo xong' : `Tạo nhận xét (${pendingTargets.length})`}
          </button>
          <button
            onClick={exportToExcel}
            className="px-5 py-3.5 bg-[#20c997] text-white rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 shadow-lg"
          >
            Xuất Excel
          </button>
        </div>
      )}

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
