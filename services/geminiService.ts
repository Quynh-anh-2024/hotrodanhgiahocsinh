
import { GoogleGenAI, Type } from "@google/genai";
import { StudentRecord, GenerationConfig } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const generateComments = async (
  records: StudentRecord[],
  config: GenerationConfig
): Promise<{ id: string; comment: string }[]> => {
  const model = 'gemini-3-flash-preview';
  
  const systemInstruction = `
    Bạn là chuyên gia giáo dục tiểu học tại Việt Nam, am hiểu sâu sắc:
    1. Thông tư 27/2020/TT-BGDĐT về đánh giá học sinh tiểu học.
    2. Chương trình GDPT 2018.
    3. Bộ sách giáo khoa "KẾT NỐI TRI THỨC VỚI CUỘC SỐNG".

    NHIỆM VỤ: Viết nhận xét cho học sinh Lớp ${config.grade}, môn ${config.subjectContext}, giai đoạn: ${config.term}.

    YÊU CẦU NGHIỆP VỤ:
    - KIẾN THỨC CHUYÊN MÔN: Nhận xét phải bám sát ma trận kiến thức của bộ sách "Kết nối tri thức" cho giai đoạn ${config.term}. 
      Ví dụ: Toán lớp 1 giữa HK1 tập trung vào số 1-10; HK2 tập trung vào số trong phạm vi 100 và đo lường.
    - CẤM TỪ: Không dùng "em", "nắm được", "học sinh".
    - TÍNH ĐA DẠNG: Mỗi học sinh cùng điểm phải có cách diễn đạt khác nhau. Sử dụng từ đồng nghĩa phong phú.
    - PHÂN TÍCH SONG SONG: Kết hợp cả Mức đạt (T/H/C) và Điểm số để đưa ra nhận xét logic.
    - ĐỘ DÀI: 120 - 180 ký tự. Văn phong chuẩn sư phạm, tích cực, mang tính khích lệ.
    - CẤU TRÚC: Đánh giá Năng lực đặc thù môn học + Năng lực chung/Phẩm chất + Góp ý hướng phát triển.

    Bối cảnh nội dung cho môn ${config.subjectContext} giai đoạn ${config.term} (Bộ sách Kết nối tri thức):
    - Hãy phân tích các yêu cầu cần đạt (YCCĐ) cụ thể của chương trình 2018 tương ứng với giai đoạn này để nhận xét về kỹ năng, thái độ học tập.
  `;

  const prompt = `Viết nhận xét ĐA DẠNG và DUY NHẤT (không lặp lại câu chữ) cho danh sách học sinh sau (JSON mảng {id, comment}):
  ${records.map(r => `ID: ${r.id}, Tên: ${r.name}, Mức: ${r.level}, Điểm: ${r.score}`).join('\n')}
  
  Ghi chú: Đảm bảo nội dung nhận xét phản ánh đúng kiến thức môn ${config.subjectContext} lớp ${config.grade} tại thời điểm ${config.term} của bộ sách Kết nối tri thức.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        temperature: 0.95, // Cao để tăng sự đa dạng từ ngữ
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
    console.error("Gemini Error:", error);
    throw error;
  }
};
