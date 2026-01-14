
export enum AchievementLevel {
  T = 'Hoàn thành tốt',
  H = 'Hoàn thành',
  C = 'Chưa hoàn thành'
}

export type Grade = '1' | '2' | '3' | '4' | '5';
export type EvaluationBasis = 'score' | 'level' | 'both';
export type Term = 'Giữa học kỳ 1' | 'Cuối học kỳ 1' | 'Giữa học kỳ 2' | 'Cuối học kỳ 2';

export interface StudentRecord {
  id: string;
  name: string;
  subject: string;
  score: number | string;
  level: AchievementLevel;
  comment?: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  originalData: any; // Store original row to preserve extra columns
}

export interface GenerationConfig {
  tone: 'professional' | 'encouraging';
  includeWeakness: boolean;
  subjectContext: string;
  grade: Grade;
  evaluationBasis: EvaluationBasis;
  term: Term;
}

export const SUBJECT_MAP: Record<Grade, string[]> = {
  '1': ['Tiếng Việt', 'Toán', 'Đạo đức', 'Tự nhiên và Xã hội', 'Giáo dục thể chất', 'Âm nhạc', 'Mỹ thuật', 'Hoạt động trải nghiệm'],
  '2': ['Tiếng Việt', 'Toán', 'Đạo đức', 'Tự nhiên và Xã hội', 'Giáo dục thể chất', 'Âm nhạc', 'Mỹ thuật', 'Hoạt động trải nghiệm'],
  '3': ['Tiếng Việt', 'Toán', 'Đạo đức', 'Tự nhiên và Xã hội', 'Tin học', 'Công nghệ', 'Giáo dục thể chất', 'Âm nhạc', 'Mỹ thuật', 'Hoạt động trải nghiệm'],
  '4': ['Tiếng Việt', 'Toán', 'Đạo đức', 'Khoa học', 'Lịch sử và Địa lý', 'Tin học', 'Công nghệ', 'Giáo dục thể chất', 'Âm nhạc', 'Mỹ thuật', 'Hoạt động trải nghiệm'],
  '5': ['Tiếng Việt', 'Toán', 'Đạo đức', 'Khoa học', 'Lịch sử và Địa lý', 'Tin học', 'Công nghệ', 'Giáo dục thể chất', 'Âm nhạc', 'Mỹ thuật', 'Hoạt động trải nghiệm'],
};
