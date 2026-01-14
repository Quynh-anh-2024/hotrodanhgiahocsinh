
import { GoogleGenAI, Type } from "@google/genai";
import { StudentRecord, GenerationConfig } from "../types";

export const generateComments = async (
  records: StudentRecord[],
  config: GenerationConfig
): Promise<{ id: string; comment: string }[]> => {
  const apiKey = localStorage.getItem('user_api_key') || process.env.API_KEY || '';
  const ai = new GoogleGenAI({ apiKey });
  
  const model = 'gemini-3-flash-preview';
  
  const basisText = config.evaluationBasis === 'score' 
    ? "tập trung vào Điểm số để phân tích mức độ hiểu bài" 
    : config.evaluationBasis === 'level' 
      ? "tập trung vào Mức đạt được (T/H/C) để đánh giá sự hoàn thành nhiệm vụ" 
      : "kết hợp chặt chẽ cả Điểm số và Mức đạt được để có cái nhìn tổng quát nhất";

  const systemInstruction = `
    Bạn là chuyên gia giáo dục tiểu học tại Việt Nam, am hiểu sâu sắc Chương trình GDPT 2018 và Thông tư 27/2020.
    
    NHIỆM VỤ: Soạn thảo lời nhận xét cho học sinh Lớp ${config.grade}, môn ${config.subjectContext}, giai đoạn: ${config.term}.

    YÊU CẦU NỘI DUNG (THEO CHƯƠNG TRÌNH 2018):
    1. Tập trung vào Yêu cầu cần đạt (YCCĐ) của môn học: Phân tích kỹ năng, kiến thức và thái độ học tập.
    2. Đánh giá Năng lực đặc thù: Ví dụ môn Toán là tư duy lập luận, môn Tiếng Việt là kỹ năng đọc hiểu/viết...
    3. Đánh giá Năng lực chung & Phẩm chất: Tự chủ, tự học, giao tiếp hợp tác, yêu nước, nhân ái, chăm chỉ, trung thực, trách nhiệm.
    4. CĂN CỨ ĐÁNH GIÁ: Bạn hãy ${basisText}. Nhận xét phải cực kỳ khớp với dữ liệu được cung cấp.
    
    QUY TẮC NGÔN NGỮ QUAN TRỌNG:
    - CẤM các từ: "em", "học sinh", "nắm được", "rất", "quá".
    - Dùng các động từ tích cực: "Vận dụng linh hoạt", "Thực hiện chính xác", "Trình bày rõ ràng", "Có ý thức học tập tốt", "Phát biểu tự tin", "Biết cách tương tác".
    - Sự Đa dạng: Mỗi học sinh phải có một câu riêng biệt, không trùng lặp cấu trúc câu dù cùng mức đạt hay cùng điểm.

    ĐỘ DÀI: 120 - 180 ký tự. Văn phong chuẩn mực, khích lệ.
  `;

  const prompt = `Dựa trên ${basisText}, hãy viết nhận xét chuẩn Chương trình 2018 cho danh sách học sinh Lớp ${config.grade} (${config.term}). 
  Môn: ${config.subjectContext}. Trả về JSON [{id, comment}]:
  ${records.map(r => `ID: ${r.id}, Tên: ${r.name}, Mức: ${r.level}, Điểm: ${r.score}`).join('\n')}
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        temperature: 1.0, 
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

    return JSON.parse(response.text || '[]');
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};
