import { parseLevel, parsePcnl, parseScore, scoreLevelMismatch, validateComment, classifyYearEnd, containsWord } from '../services/logic.ts';

let pass = 0, fail = 0;
const eq = (got, want, label) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`FAIL ${label}: got ${g}, want ${w}`); }
};

// --- parseLevel: mã 1 chữ + mã ghép (đúng như CSDL xuất) ---
eq(parseLevel('T'), 'T', 'T');
eq(parseLevel('H'), 'H', 'H');
eq(parseLevel('C'), 'C', 'C');
eq(parseLevel('HTT'), 'T', 'HTT');
eq(parseLevel('HT'), 'H', 'HT');
eq(parseLevel('CHT'), 'C', 'CHT');
eq(parseLevel(' t '), 'T', 't thường + khoảng trắng');
// --- parseLevel: chữ đầy đủ — nơi code cũ sai hàng loạt ---
eq(parseLevel('Hoàn thành tốt'), 'T', 'chữ HTT');
eq(parseLevel('Hoàn thành'), 'H', 'chữ HT (cũ -> T sai)');
eq(parseLevel('Chưa hoàn thành'), 'C', 'chữ CHT (cũ -> T sai)');
eq(parseLevel('HOÀN THÀNH'), 'H', 'hoa HT');
eq(parseLevel('CHƯA HOÀN THÀNH'), 'C', 'hoa CHT');
// --- parseLevel: lạ -> null, không mặc định H ---
eq(parseLevel('Xuất sắc'), null, 'lạ');
eq(parseLevel(''), null, 'rỗng');
eq(parseLevel(null), null, 'null');

// --- parsePcnl ---
eq(parsePcnl('Tốt'), 'Tốt', 'PC Tốt');
eq(parsePcnl('Đạt'), 'Đạt', 'PC Đạt');
eq(parsePcnl('Cần cố gắng'), 'Cần cố gắng', 'PC CCG');
eq(parsePcnl('T'), 'Tốt', 'PC mã T');
eq(parsePcnl('Đ'), 'Đạt', 'PC mã Đ');
eq(parsePcnl('C'), 'Cần cố gắng', 'PC mã C');
eq(parsePcnl('xyz'), null, 'PC lạ');

// --- parseScore ---
eq(parseScore(''), { value: null, issues: [] }, 'điểm trống -> null, không bịa 0');
eq(parseScore(null), { value: null, issues: [] }, 'điểm null');
eq(parseScore('9').value, 9, 'điểm 9');
eq(parseScore('7,5').value, 7.5, 'điểm phẩy');
eq(parseScore('7,5').issues.length, 1, 'điểm thập phân bị gắn cờ');
eq(parseScore('11').issues.length, 1, 'điểm ngoài thang');
eq(parseScore('abc').value, null, 'điểm chữ -> null');
eq(parseScore('abc').issues.length, 1, 'điểm chữ có issue');

// --- scoreLevelMismatch ---
eq(!!scoreLevelMismatch(9, 'C'), true, '9 điểm mức C -> cảnh báo');
eq(!!scoreLevelMismatch(2, 'T'), true, '2 điểm mức T -> cảnh báo');
eq(scoreLevelMismatch(8, 'H'), null, '8 điểm mức H -> bình thường (còn đánh giá thường xuyên)');
eq(scoreLevelMismatch(5, 'H'), null, '5 điểm mức H');
eq(scoreLevelMismatch(null, 'T'), null, 'không điểm -> không cảnh báo oan');

// --- containsWord / validateComment ---
eq(containsWord('Đạt điểm cao, xem bài cẩn thận', 'em'), false, '"em" trong điểm/xem không bị bắt oan');
eq(containsWord('Con em cần cố gắng', 'em'), true, '"em" đứng riêng bị bắt');
eq(containsWord('Thực hiện rất tốt', 'rất'), true, '"rất" bị bắt');
const good = 'Vận dụng linh hoạt kiến thức đã học vào bài tập, trình bày rõ ràng, tính toán chính xác. Phát biểu tự tin, biết hợp tác cùng bạn trong giờ học nhóm.';
eq(validateComment(good), [], 'nhận xét chuẩn -> 0 vi phạm');
eq(validateComment('Ngắn').length > 0, true, 'quá ngắn bị bắt');
eq(validateComment('AI gặp sự cố khi tạo nội dung. Vui lòng thử lại sau. ' + 'x'.repeat(60)).includes('Ô chứa câu báo lỗi của hệ thống'), true, 'câu báo lỗi bị bắt');
eq(validateComment('Học sinh nắm được bài rất tốt và làm bài quá nhanh so với các bạn trong lớp học này. Cần tiếp tục phát huy thêm nữa trong kỳ tới nhé con.').length >= 3, true, 'từ cấm bị bắt nhiều');

// --- classifyYearEnd (Điều 9) ---
const subjects = ['Tiếng Việt', 'Toán', 'Đạo đức'];
const scored = ['Tiếng Việt', 'Toán'];
const base = { subjects, scoredSubjects: scored, subjectLevels: { 'Tiếng Việt': 'T', 'Toán': 'T', 'Đạo đức': 'T' }, scores: { 'Tiếng Việt': 9, 'Toán': 10 }, pc: 'Tốt', nl: 'Tốt' };
eq(classifyYearEnd(base).result, 'Hoàn thành xuất sắc', 'Đ9 xuất sắc');
eq(classifyYearEnd(base).award, 'Học sinh Xuất sắc', 'Đ9 khen xuất sắc');
eq(classifyYearEnd({ ...base, scores: { 'Tiếng Việt': 8, 'Toán': 9 } }).result, 'Hoàn thành tốt', 'Đ9 HTT (điểm 8)');
eq(classifyYearEnd({ ...base, subjectLevels: { 'Tiếng Việt': 'T', 'Toán': 'H', 'Đạo đức': 'T' }, scores: { 'Tiếng Việt': 6, 'Toán': 6 } }).result, 'Hoàn thành', 'Đ9 HT');
eq(classifyYearEnd({ ...base, subjectLevels: { 'Tiếng Việt': 'T', 'Toán': 'C', 'Đạo đức': 'T' } }).result, 'Chưa hoàn thành', 'Đ9 CHT (1 môn C)');
eq(classifyYearEnd({ ...base, pc: 'Đạt' }).result, 'Hoàn thành', 'Đ9 PC Đạt -> tối đa HT');
eq(classifyYearEnd({ ...base, scores: { 'Tiếng Việt': 4, 'Toán': 9 } }).result, 'Chưa hoàn thành', 'Đ9 điểm 4 -> CHT');
const miss = classifyYearEnd({ ...base, scores: { 'Tiếng Việt': 9 } });
eq(miss.result, 'Thiếu dữ liệu', 'Đ9 thiếu điểm -> không xếp');
eq(miss.missing.length, 1, 'Đ9 liệt kê thiếu');

console.log(`\nKẾT QUẢ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
