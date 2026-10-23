import type { LevelCode, PcnlLevel, YearEndResult } from './services/logic';

export enum AchievementLevel {
  T = 'Hoàn thành tốt',
  H = 'Hoàn thành',
  C = 'Chưa hoàn thành'
}

export type Grade = '1' | '2' | '3' | '4' | '5';
export type EvaluationBasis = 'score' | 'level' | 'both';
export type Term = 'Giữa học kỳ 1' | 'Cuối học kỳ 1' | 'Giữa học kỳ 2' | 'Cuối năm học';
export type AppMode = 'subject' | 'pcnl' | 'summary';

export interface StudentRecord {
  id: string;
  name: string;
  subject: string;
  score: number | string | null; // null = không có điểm (môn chỉ nhận xét hoặc file thiếu cột điểm) — KHÔNG mặc định 0
  level: AchievementLevel | null; // null = mức trong file không nhận diện được, cần giáo viên xử lý
  levelCode: LevelCode | null;
  comment?: string;
  status: 'pending' | 'processing' | 'completed' | 'error' | 'invalid';
  issues: string[]; // cảnh báo dữ liệu của riêng học sinh này (điểm lạ, mâu thuẫn điểm–mức, mức không đọc được...)
  strengths?: string; // cột tuỳ chọn trong Excel: "Điểm mạnh"
  needs?: string; // cột tuỳ chọn trong Excel: "Cần cố gắng"
  note?: string; // cột tuỳ chọn trong Excel: "Ghi chú"
  pcnl?: Record<string, PcnlLevel | null>; // chế độ phẩm chất & năng lực: từng tiêu chí -> mức
  yearEnd?: {
    result: YearEndResult;
    missing: string[];
    award: string;
    subjectLevels: Record<string, LevelCode | null>;
    scores: Record<string, number | null>;
    pc: PcnlLevel | null;
    nl: PcnlLevel | null;
  };
  originalData: any; // Store original row to preserve extra columns
}

export interface GenerationConfig {
  tone: 'professional' | 'encouraging';
  includeWeakness: boolean; // có nêu điểm cần cố gắng trong nhận xét (mức C luôn nêu, kèm hướng rèn luyện)
  subjectContext: string;
  grade: Grade;
  evaluationBasis: EvaluationBasis;
  term: Term;
  mode: AppMode;
  classTopics: string; // nội dung/YCCĐ đã học trong kỳ do giáo viên nhập — căn cứ để AI không bịa kỹ năng ngoài chương trình kỳ đó
}

export const SUBJECT_MAP: Record<Grade, string[]> = {
  '1': ['Tiếng Việt', 'Toán', 'Đạo đức', 'Tự nhiên và Xã hội', 'Giáo dục thể chất', 'Âm nhạc', 'Mỹ thuật', 'Hoạt động trải nghiệm'],
  '2': ['Tiếng Việt', 'Toán', 'Đạo đức', 'Tự nhiên và Xã hội', 'Giáo dục thể chất', 'Âm nhạc', 'Mỹ thuật', 'Hoạt động trải nghiệm'],
  '3': ['Tiếng Việt', 'Toán', 'Đạo đức', 'Tự nhiên và Xã hội', 'Tin học', 'Công nghệ', 'Giáo dục thể chất', 'Âm nhạc', 'Mỹ thuật', 'Hoạt động trải nghiệm'],
  '4': ['Tiếng Việt', 'Toán', 'Đạo đức', 'Khoa học', 'Lịch sử và Địa lý', 'Tin học', 'Công nghệ', 'Giáo dục thể chất', 'Âm nhạc', 'Mỹ thuật', 'Hoạt động trải nghiệm'],
  '5': ['Tiếng Việt', 'Toán', 'Đạo đức', 'Khoa học', 'Lịch sử và Địa lý', 'Tin học', 'Công nghệ', 'Giáo dục thể chất', 'Âm nhạc', 'Mỹ thuật', 'Hoạt động trải nghiệm'],
};

// Môn có bài kiểm tra định kỳ + điểm số theo TT27 Điều 7 (Tin học và Công nghệ tách riêng theo cách tổ chức của trường: Tin học có điểm, Công nghệ chỉ nhận xét).
export const SCORED_SUBJECTS: string[] = ['Tiếng Việt', 'Toán', 'Khoa học', 'Lịch sử và Địa lý', 'Tin học'];

export const isScoredSubject = (subject: string): boolean => SCORED_SUBJECTS.includes(subject);

// Năng lực đặc thù / thành phần năng lực của từng môn theo CT GDPT 2018 — đưa vào prompt để AI nhận xét đúng trọng tâm môn, không nói chung chung.
export const SUBJECT_COMPETENCY: Record<string, string> = {
  'Tiếng Việt': 'Năng lực ngôn ngữ: đọc (đọc thành tiếng, đọc hiểu), viết (chính tả, viết đoạn/bài), nói và nghe. Nhận xét bám vào kỹ năng đọc, viết, trình bày.',
  'Toán': 'Năng lực tư duy và lập luận toán học, giải quyết vấn đề toán học, mô hình hoá toán học, giao tiếp toán học, sử dụng công cụ và phương tiện học toán.',
  'Đạo đức': 'Năng lực điều chỉnh hành vi: nhận biết chuẩn mực, tự đánh giá và điều chỉnh hành vi, thực hiện các hành vi đạo đức trong sinh hoạt và học tập.',
  'Tự nhiên và Xã hội': 'Năng lực khoa học: nhận thức khoa học, tìm hiểu môi trường tự nhiên và xã hội xung quanh, vận dụng kiến thức vào thực tiễn gần gũi.',
  'Khoa học': 'Năng lực khoa học: nhận thức khoa học, tìm hiểu môi trường tự nhiên, vận dụng kiến thức và kỹ năng đã học vào thực tiễn.',
  'Lịch sử và Địa lý': 'Năng lực tìm hiểu lịch sử và địa lý: nhận biết sự kiện, nhân vật, địa điểm; khai thác tranh ảnh/bản đồ; trình bày hiểu biết về quê hương, đất nước.',
  'Tin học': 'Năng lực tin học: sử dụng và quản lý các phương tiện công nghệ thông tin, ứng xử phù hợp trong môi trường số, sử dụng máy tính hỗ trợ học tập, thao tác chính xác theo hướng dẫn.',
  'Công nghệ': 'Năng lực công nghệ: nhận thức công nghệ, sử dụng công nghệ, giao tiếp công nghệ, đánh giá công nghệ, thiết kế kỹ thuật đơn giản, an toàn khi dùng sản phẩm công nghệ.',
  'Giáo dục thể chất': 'Năng lực thể chất: chăm sóc sức khoẻ, vận động cơ bản, hoạt động thể dục thể thao; ý thức rèn luyện thân thể.',
  'Âm nhạc': 'Năng lực âm nhạc: thể hiện âm nhạc (hát, gõ đệm), cảm thụ và hiểu biết âm nhạc, ứng dụng và sáng tạo âm nhạc đơn giản.',
  'Mỹ thuật': 'Năng lực thẩm mĩ và mĩ thuật: quan sát và nhận thức thẩm mĩ, sáng tạo và ứng dụng thẩm mĩ, phân tích và đánh giá thẩm mĩ.',
  'Hoạt động trải nghiệm': 'Năng lực thích ứng với cuộc sống, thiết kế và tổ chức hoạt động, định hướng nghề nghiệp đơn giản; kỹ năng tham gia hoạt động tập thể, lao động và sinh hoạt.',
};

// Phẩm chất chủ yếu (TT27 / CT GDPT 2018)
export const QUALITIES: string[] = ['Yêu nước', 'Nhân ái', 'Chăm chỉ', 'Trung thực', 'Trách nhiệm'];

// Năng lực chung cốt lõi
export const CORE_COMPETENCIES: string[] = ['Tự chủ và tự học', 'Giao tiếp và hợp tác', 'Giải quyết vấn đề và sáng tạo'];

export const PCNL_ITEMS: string[] = [...QUALITIES, ...CORE_COMPETENCIES];
