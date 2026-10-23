import { GoogleGenAI, Type } from "@google/genai";
import { StudentRecord, GenerationConfig, SUBJECT_COMPETENCY, QUALITIES } from "../types";
import { isScoredSubject } from "../types";

// Danh sách model dự phòng: thử lần lượt khi model trước báo không khả dụng (404).
// Lỗi tạm thời (429/503/quá tải/mạng) thì thử lại chính model đó trước khi đổi.
const MODEL_CANDIDATES = ['gemini-3-flash-preview', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.0-flash'];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const isTransient = (e: any): boolean => {
  const msg = `${e?.status || ''} ${e?.message || e || ''}`;
  return /429|500|502|503|504|overload|unavailable|rate|fetch|network|timeout/i.test(msg);
};
const isModelMissing = (e: any): boolean => {
  const msg = `${e?.status || ''} ${e?.message || e || ''}`;
  return /404|not found|not supported/i.test(msg);
};

function getClient(): GoogleGenAI {
  const apiKey = localStorage.getItem('user_api_key') || process.env.API_KEY || '';
  return new GoogleGenAI({ apiKey });
}

/** Kiểm tra khoá THẬT bằng một lượt gọi nhẹ — nút "Xác thực & Lưu" phải hứa đúng việc nó làm. */
export async function validateApiKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  const key = (apiKey || '').trim();
  if (!key) return { ok: false, message: 'Chưa nhập khoá.' };
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000));
    const call = (async () => {
      for (const model of MODEL_CANDIDATES) {
        try {
          await ai.models.generateContent({
            model,
            contents: 'Trả lời đúng một chữ: OK',
            config: { maxOutputTokens: 8, thinkingConfig: { thinkingBudget: 0 } as any },
          });
          return model;
        } catch (e) {
          if (isModelMissing(e)) continue;
          throw e;
        }
      }
      throw new Error('no-model');
    })();
    await Promise.race([call, timeout]);
    return { ok: true, message: 'Khoá hợp lệ.' };
  } catch (e: any) {
    const msg = `${e?.status || ''} ${e?.message || e || ''}`;
    if (/401|403|api key|invalid|permission/i.test(msg)) return { ok: false, message: 'Khoá không hợp lệ hoặc không có quyền dùng Gemini.' };
    if (/no-model/i.test(msg)) return { ok: false, message: 'Khoá hợp lệ nhưng không gọi được model nào (dự án chưa bật model Gemini Flash).' };
    if (/timeout|fetch|network/i.test(msg)) return { ok: false, message: 'Không kết nối được tới Google. Kiểm tra mạng rồi thử lại.' };
    if (isTransient(e)) return { ok: true, message: 'Khoá có vẻ hợp lệ (Google đang quá tải nên chưa kiểm tra dứt điểm được).' };
    return { ok: false, message: 'Không kiểm tra được khoá. Thử lại sau.' };
  }
}

async function callGeminiJSON(systemInstruction: string, prompt: string): Promise<{ id: string; comment: string }[]> {
  const ai = getClient();
  let lastError: any = null;

  for (const model of MODEL_CANDIDATES) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            temperature: 0.7,
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  comment: { type: Type.STRING }
                },
                required: ["id", "comment"]
              }
            }
          }
        });
        const parsed = JSON.parse(response.text || '[]');
        if (Array.isArray(parsed)) return parsed;
        throw new Error('Định dạng trả về không đúng');
      } catch (e) {
        lastError = e;
        if (isModelMissing(e)) break; // đổi model khác
        if (isTransient(e) && attempt < 2) { await sleep(attempt === 0 ? 3000 : 8000); continue; }
        throw e;
      }
    }
  }
  throw lastError || new Error('Không gọi được AI');
}

const LANGUAGE_RULES = `
QUY TẮC NGÔN NGỮ (bắt buộc):
- KHÔNG dùng các từ: "em", "học sinh", "nắm được", "rất", "quá". Viết câu không chủ ngữ, mở đầu bằng động từ hoặc cụm danh từ (kiểu nhận xét trên CSDL/học bạ).
- Dùng động từ tích cực, cụ thể: "Vận dụng linh hoạt", "Thực hiện chính xác", "Trình bày rõ ràng", "Phát biểu tự tin", "Biết cách tương tác", "Hoàn thành tốt nhiệm vụ"...
- Mỗi học sinh một nhận xét RIÊNG BIỆT: khác nhau cả nội dung lẫn cấu trúc câu, không lặp lại một mẫu cho cả nhóm cùng mức.
- ĐỘ DÀI: 120–180 ký tự. Văn phong chuẩn mực, khích lệ, đúng sự thật theo dữ kiện được cấp — TUYỆT ĐỐI không bịa thêm thành tích hay kỹ năng ngoài dữ kiện.
`;

function studentFacts(r: StudentRecord, config: GenerationConfig): string {
  const parts = [`ID: ${r.id}`, `Tên: ${r.name}`];
  if (config.mode === 'subject') {
    parts.push(`Mức: ${r.level || 'Chưa rõ'}`);
    // Chỉ đưa điểm khi THẬT SỰ có điểm và căn cứ cho phép — không còn "Điểm: 0" bịa cho môn không điểm.
    if (isScoredSubject(config.subjectContext) && r.score !== null && r.score !== undefined && config.evaluationBasis !== 'level') {
      parts.push(`Điểm KTĐK: ${r.score}`);
    }
    if (r.strengths) parts.push(`Điểm mạnh (giáo viên ghi): ${r.strengths}`);
    if (r.needs) parts.push(`Cần cố gắng (giáo viên ghi): ${r.needs}`);
    if (r.note) parts.push(`Ghi chú (giáo viên ghi): ${r.note}`);
  }
  return parts.join(', ');
}

/** Chế độ 1: nhận xét theo môn học */
export async function generateComments(
  records: StudentRecord[],
  config: GenerationConfig
): Promise<{ id: string; comment: string }[]> {
  const scored = isScoredSubject(config.subjectContext);
  const basisText = !scored || config.evaluationBasis === 'level'
    ? "căn cứ Mức đạt được (T/H/C) và quá trình học tập — môn này đánh giá bằng nhận xét, không dùng điểm số"
    : config.evaluationBasis === 'score'
      ? "căn cứ Điểm kiểm tra định kỳ kết hợp Mức đạt được"
      : "kết hợp Mức đạt được và Điểm kiểm tra định kỳ";

  const systemInstruction = `
Bạn là chuyên gia giáo dục tiểu học tại Việt Nam, am hiểu sâu sắc Chương trình GDPT 2018 và Thông tư 27/2020/TT-BGDĐT.

NHIỆM VỤ: Soạn lời nhận xét ĐÁNH GIÁ ĐỊNH KỲ cho học sinh Lớp ${config.grade}, môn ${config.subjectContext}, giai đoạn: ${config.term}. Căn cứ đánh giá: ${basisText}.

TRỌNG TÂM MÔN HỌC: ${SUBJECT_COMPETENCY[config.subjectContext] || 'Theo yêu cầu cần đạt của môn học trong Chương trình GDPT 2018.'}
${config.classTopics.trim() ? `\nNỘI DUNG ĐÃ HỌC TRONG KỲ (giáo viên cung cấp — CHỈ nhận xét trong phạm vi này, không nhắc kỹ năng/chủ đề ngoài danh sách): ${config.classTopics.trim()}` : `\nChưa có danh sách nội dung đã học của kỳ: chỉ nhận xét ở mức biểu hiện chung theo trọng tâm môn, không tự bịa chủ đề bài học cụ thể.`}

QUY TẮC THEO MỨC:
- Hoàn thành tốt: nêu biểu hiện nổi bật, thường xuyên, có dẫn chứng theo trọng tâm môn.
- Hoàn thành: nêu phần đã thực hiện được + một hướng phát huy cụ thể.
- Chưa hoàn thành: nói rõ phần chưa thực hiện được MỘT CÁCH NHẸ NHÀNG và BẮT BUỘC kèm hướng rèn luyện cụ thể, khả thi (luyện thêm phần nào, bằng cách nào) — đúng yêu cầu nhận xét phải kèm biện pháp giúp đỡ của Thông tư 27.
${config.includeWeakness ? '- Với mọi mức: nếu dữ kiện có mục "Cần cố gắng" của giáo viên thì phải phản ánh vào nhận xét.' : ''}
- KHÔNG kết luận về phẩm chất (yêu nước, nhân ái...) trong nhận xét môn học — phẩm chất/năng lực được đánh giá riêng bởi giáo viên chủ nhiệm.

${LANGUAGE_RULES}
`;

  const prompt = `Viết nhận xét cho danh sách sau, trả về JSON [{id, comment}] đúng thứ tự id đã cho:\n${records.map(r => studentFacts(r, config)).join('\n')}`;
  return callGeminiJSON(systemInstruction, prompt);
}

/** Chế độ 2: nhận xét tổng hợp phẩm chất & năng lực (phần của GVCN, mức Tốt/Đạt/Cần cố gắng — TT27 Điều 7) */
export async function generatePcnlComments(
  records: StudentRecord[],
  config: GenerationConfig
): Promise<{ id: string; comment: string }[]> {
  const systemInstruction = `
Bạn là chuyên gia giáo dục tiểu học tại Việt Nam, am hiểu Chương trình GDPT 2018 và Thông tư 27/2020/TT-BGDĐT.

NHIỆM VỤ: Soạn nhận xét TỔNG HỢP về sự hình thành và phát triển PHẨM CHẤT CHỦ YẾU và NĂNG LỰC CỐT LÕI cho học sinh Lớp ${config.grade}, giai đoạn: ${config.term}. Đây là phần đánh giá của giáo viên chủ nhiệm, tách riêng với nhận xét từng môn học. Mức của từng phẩm chất/năng lực: Tốt / Đạt / Cần cố gắng.

QUY TẮC:
- Nêu trước các phẩm chất/năng lực đạt mức Tốt (biểu hiện rõ, thường xuyên), sau đó các mục Đạt.
- Mục nào Cần cố gắng: diễn đạt nhẹ nhàng + BẮT BUỘC kèm hướng rèn luyện cụ thể và vai trò phối hợp của gia đình.
- Chỉ dựa trên mức được cấp, không bịa sự kiện/hành vi cụ thể không có trong dữ kiện.
- ĐỘ DÀI: 150–260 ký tự (phần tổng hợp được dài hơn nhận xét môn).
${LANGUAGE_RULES.replace('ĐỘ DÀI: 120–180 ký tự.', 'ĐỘ DÀI: theo mục trên.')}
`;

  const prompt = `Viết nhận xét tổng hợp phẩm chất, năng lực cho danh sách sau, trả về JSON [{id, comment}]:\n${records.map(r => {
    const items = Object.entries(r.pcnl || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    const extra = [r.strengths ? `Điểm mạnh: ${r.strengths}` : '', r.needs ? `Cần cố gắng: ${r.needs}` : '', r.note ? `Ghi chú: ${r.note}` : ''].filter(Boolean).join('; ');
    return `ID: ${r.id}, Tên: ${r.name}, ${items.join(', ')}${extra ? `; ${extra}` : ''}`;
  }).join('\n')}`;
  return callGeminiJSON(systemInstruction, prompt);
}

/** Chế độ 3: nhận xét học bạ cuối năm — mức tổng hợp đã do CODE xếp theo Điều 9, AI chỉ viết câu chữ */
export async function generateSummaryComments(
  records: StudentRecord[],
  config: GenerationConfig
): Promise<{ id: string; comment: string }[]> {
  const systemInstruction = `
Bạn là chuyên gia giáo dục tiểu học tại Việt Nam, am hiểu Thông tư 27/2020/TT-BGDĐT.

NHIỆM VỤ: Soạn nhận xét HỌC BẠ cuối năm học cho học sinh Lớp ${config.grade}. Mức tổng hợp của từng em ĐÃ ĐƯỢC XẾP SẴN theo Điều 9 Thông tư 27 (dữ kiện kèm theo) — nhiệm vụ của bạn chỉ là viết câu nhận xét khớp đúng mức đó, TUYỆT ĐỐI không tự nâng/hạ mức trong câu chữ.

QUY TẮC:
- Hoàn thành xuất sắc / Hoàn thành tốt: nêu môn học nổi bật và phẩm chất, năng lực tiêu biểu.
- Hoàn thành: nêu kết quả đạt được + một hướng phấn đấu cho năm sau.
- Chưa hoàn thành: nhẹ nhàng, nêu rõ cần tiếp tục rèn luyện thêm ở môn/phần nào trong hè và đầu năm sau, kèm động viên.
- Chỉ dùng dữ kiện được cấp (mức từng môn, điểm, phẩm chất, năng lực), không bịa thành tích.
- ĐỘ DÀI: 150–260 ký tự.
${LANGUAGE_RULES.replace('ĐỘ DÀI: 120–180 ký tự.', 'ĐỘ DÀI: theo mục trên.')}
`;

  const prompt = `Viết nhận xét học bạ cho danh sách sau, trả về JSON [{id, comment}]:\n${records.map(r => {
    const y = r.yearEnd!;
    const lv = Object.entries(y.subjectLevels).filter(([, v]) => v).map(([k, v]) => `${k}: ${v === 'T' ? 'Hoàn thành tốt' : v === 'H' ? 'Hoàn thành' : 'Chưa hoàn thành'}`).join(', ');
    const sc = Object.entries(y.scores).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}: ${v} điểm`).join(', ');
    return `ID: ${r.id}, Tên: ${r.name}, Mức tổng hợp: ${y.result}, Mức các môn [${lv}], Điểm KTĐK [${sc}], Phẩm chất: ${y.pc || '—'}, Năng lực: ${y.nl || '—'}`;
  }).join('\n')}`;
  return callGeminiJSON(systemInstruction, prompt);
}
