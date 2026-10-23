// Logic thuần cho app Trợ Lý Đánh Giá TT27 — không phụ thuộc React/Gemini, có unit test riêng.
// Mọi hàm ở đây đều được kiểm chứng trong tests/logic.test.mjs (chạy bằng node sau khi biên dịch).

export type LevelCode = 'T' | 'H' | 'C';
export type PcnlLevel = 'Tốt' | 'Đạt' | 'Cần cố gắng';

const norm = (raw: string): string =>
  (raw || '').toString().trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * Ánh xạ mức môn học từ ô Excel sang mã T/H/C.
 * Vá lỗi cũ: code trước xét includes('T') đầu tiên nên "Hoàn thành" và cả
 * "Chưa hoàn thành" đều bị hiểu thành Hoàn thành tốt (chữ THÀNH chứa chữ T).
 * Thứ tự ở đây: mã ngắn trước → "CHƯA" → "HOÀN THÀNH TỐT" → "HOÀN THÀNH".
 * Không nhận diện được → trả null để app báo lỗi hàng đó, KHÔNG mặc định H như cũ.
 */
export function parseLevel(raw: string | null | undefined): LevelCode | null {
  if (raw === null || raw === undefined) return null;
  const s = norm(raw.toString());
  if (!s) return null;
  if (s === 'T' || s === 'HTT') return 'T';
  if (s === 'H' || s === 'HT') return 'H';
  if (s === 'C' || s === 'CHT') return 'C';
  if (s.includes('CHƯA')) return 'C';
  if (s.includes('CẦN CỐ GẮNG') || s.includes('CỐ GẮNG')) return 'C';
  if (s.includes('HOÀN THÀNH TỐT') || s.endsWith('TỐT')) return 'T';
  if (s.includes('HOÀN THÀNH')) return 'H';
  return null;
}

/**
 * Ánh xạ mức phẩm chất / năng lực (TT27 Điều 7): Tốt / Đạt / Cần cố gắng.
 * Chấp nhận cả chữ đầy đủ lẫn mã ngắn thường gặp trong file xuất CSDL: T, Đ/D, C/CCG.
 */
export function parsePcnl(raw: string | null | undefined): PcnlLevel | null {
  if (raw === null || raw === undefined) return null;
  const s = norm(raw.toString());
  if (!s) return null;
  if (s.includes('CẦN CỐ GẮNG') || s.includes('CỐ GẮNG') || s === 'CCG' || s === 'C') return 'Cần cố gắng';
  if (s === 'T' || s.includes('TỐT')) return 'Tốt';
  if (s === 'Đ' || s === 'D' || s.includes('ĐẠT')) return 'Đạt';
  return null;
}

export interface ScoreParse {
  value: number | null;
  issues: string[];
}

/** Đọc điểm từ ô Excel. Không có điểm → value null và KHÔNG bịa 0 như code cũ. */
export function parseScore(raw: string | null | undefined): ScoreParse {
  if (raw === null || raw === undefined) return { value: null, issues: [] };
  const text = raw.toString().trim();
  if (!text) return { value: null, issues: [] };
  const num = Number(text.replace(',', '.'));
  if (Number.isNaN(num)) {
    return { value: null, issues: [`Điểm không phải là số: "${text}"`] };
  }
  const issues: string[] = [];
  if (num < 0 || num > 10) issues.push(`Điểm ${text} ngoài thang 0–10`);
  if (!Number.isInteger(num)) issues.push(`Điểm ${text} là số thập phân — TT27 quy định điểm KTĐK không cho điểm thập phân`);
  return { value: num, issues };
}

/**
 * Cảnh báo mâu thuẫn cực đoan giữa điểm KTĐK và mức. Chỉ bắt hai đầu cực đoan,
 * vì mức theo TT27 còn căn cứ đánh giá thường xuyên, không suy thẳng từ 1 con điểm.
 * Trả về câu cảnh báo hoặc null. Đây là CẢNH BÁO để giáo viên rà lại, không tự sửa dữ liệu.
 */
export function scoreLevelMismatch(score: number | null, level: LevelCode | null): string | null {
  if (score === null || level === null) return null;
  if (score >= 8 && level === 'C') return `Điểm ${score} nhưng mức Chưa hoàn thành — cần rà lại`;
  if (score <= 3 && level === 'T') return `Điểm ${score} nhưng mức Hoàn thành tốt — cần rà lại`;
  return null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Kiểm tra "từ đứng riêng" — tránh bắt oan kiểu chữ "em" nằm trong "điểm", "xem", "kèm". */
export function containsWord(text: string, word: string): boolean {
  const re = new RegExp(`(^|[\\s,.;:!?()«»"“”])${escapeRe(word)}(?=[\\s,.;:!?()«»"“”]|$)`, 'i');
  return re.test(text);
}

export const BANNED_WORDS = ['em', 'học sinh', 'nắm được', 'rất', 'quá'];
export const ERROR_TEXTS = ['AI gặp sự cố', 'Lỗi kết nối AI'];

/**
 * Kiểm tra nhận xét SAU khi AI sinh (code cũ chỉ dặn trong prompt, không kiểm lại).
 * Ngưỡng độ dài nới hơn dải đích 120–180 ký tự một chút để không sinh lại oan;
 * vi phạm → app tự sinh lại đúng những em đó 1 lần.
 */
export function validateComment(text: string | null | undefined): string[] {
  const t = (text || '').trim();
  const problems: string[] = [];
  if (!t) return ['Nhận xét trống'];
  if (ERROR_TEXTS.some(e => t.includes(e))) problems.push('Ô chứa câu báo lỗi của hệ thống');
  if (t.length < 80) problems.push(`Quá ngắn (${t.length} ký tự, đích 120–180)`);
  if (t.length > 220) problems.push(`Quá dài (${t.length} ký tự, đích 120–180)`);
  for (const w of BANNED_WORDS) {
    if (containsWord(t, w)) problems.push(`Chứa từ cần tránh: "${w}"`);
  }
  return problems;
}

/** Hai nhận xét bị coi là trùng khi giống hệt nhau sau khi thường hoá + bỏ khoảng trắng thừa. */
export function normalizeComment(text: string): string {
  return (text || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export type YearEndResult = 'Hoàn thành xuất sắc' | 'Hoàn thành tốt' | 'Hoàn thành' | 'Chưa hoàn thành' | 'Thiếu dữ liệu';

export interface YearEndInput {
  subjects: string[];          // toàn bộ môn học/HĐGD của khối
  scoredSubjects: string[];    // các môn có điểm KTĐK cuối năm
  subjectLevels: Record<string, LevelCode | null>;
  scores: Record<string, number | null>;
  pc: PcnlLevel | null;        // phẩm chất (tổng hợp)
  nl: PcnlLevel | null;        // năng lực (tổng hợp)
}

export interface YearEndOutput {
  result: YearEndResult;
  missing: string[];
  award: string;
}

/**
 * Xếp loại tổng hợp cuối năm học theo Điều 9 TT27 — tính bằng CODE, không để AI đoán:
 * - Hoàn thành xuất sắc: mọi môn Hoàn thành tốt; phẩm chất, năng lực Tốt; mọi điểm KTĐK cuối năm ≥ 9.
 * - Hoàn thành tốt: như trên nhưng điểm ≥ 7 (và chưa đạt mức xuất sắc).
 * - Hoàn thành: mọi môn Hoàn thành tốt hoặc Hoàn thành; phẩm chất, năng lực Tốt hoặc Đạt; điểm ≥ 5.
 * - Chưa hoàn thành: còn lại.
 * Thiếu bất kỳ dữ kiện nào → "Thiếu dữ liệu" kèm danh sách thiếu, không xếp loại thay cho giáo viên.
 */
export function classifyYearEnd(input: YearEndInput): YearEndOutput {
  const missing: string[] = [];
  for (const s of input.subjects) {
    if (!input.subjectLevels[s]) missing.push(`Mức môn ${s}`);
  }
  for (const s of input.scoredSubjects) {
    if (input.scores[s] === null || input.scores[s] === undefined) missing.push(`Điểm KTĐK môn ${s}`);
  }
  if (!input.pc) missing.push('Mức phẩm chất');
  if (!input.nl) missing.push('Mức năng lực');
  if (missing.length > 0) return { result: 'Thiếu dữ liệu', missing, award: '' };

  const levels = input.subjects.map(s => input.subjectLevels[s] as LevelCode);
  const allT = levels.every(l => l === 'T');
  const allHorT = levels.every(l => l === 'T' || l === 'H');
  const pcGood = input.pc === 'Tốt' && input.nl === 'Tốt';
  const pcOk = (input.pc === 'Tốt' || input.pc === 'Đạt') && (input.nl === 'Tốt' || input.nl === 'Đạt');
  const scoreVals = input.scoredSubjects.map(s => input.scores[s] as number);
  const minScore = scoreVals.length ? Math.min(...scoreVals) : 10;

  let result: YearEndResult = 'Chưa hoàn thành';
  if (allT && pcGood && minScore >= 9) result = 'Hoàn thành xuất sắc';
  else if (allT && pcGood && minScore >= 7) result = 'Hoàn thành tốt';
  else if (allHorT && pcOk && minScore >= 5) result = 'Hoàn thành';

  let award = '';
  if (result === 'Hoàn thành xuất sắc') award = 'Học sinh Xuất sắc';
  else if (result === 'Hoàn thành tốt') award = 'Học sinh Tiêu biểu — dự kiến, cần thêm thành tích nổi bật ở ít nhất 1 môn/phẩm chất/năng lực và tập thể lớp công nhận (Điều 13)';
  return { result, missing: [], award };
}
