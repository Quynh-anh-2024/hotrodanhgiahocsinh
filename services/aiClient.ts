// Cổng gọi Gemini — PORT NGUYÊN cơ chế đã chạy ổn định của app Tạo Phiếu Học Tập
// (services/geminiService.ts của phieubaitap), chỉ thay phần việc cụ thể (sinh JSON nhận xét).
// Khác biệt duy nhất so với bản gốc: app này KHÔNG nhúng key mặc định (repo công khai),
// key luôn là key giáo viên tự nhập, lưu ở localStorage 'user_api_key'.
//
// Cơ chế (giữ nguyên bản gốc):
// - validateApiKey 2 bước: (1) ListModels kiểm chính cái key (nhanh, không tốn lượt tạo nội dung;
//   400/401/403 = key sai thật, 5xx/mạng = báo đúng lý do đó); (2) probeModel dò model gọi được
//   (prompt "OK", thinkingBudget 0, timeout 12s — CHỈ 404 mới kết luận model không khả dụng,
//   429/5xx/timeout vẫn tính là gọi được) và GHI NHỚ model thắng theo từng key.
// - Khi tạo nội dung: thử model theo thứ tự [model đã ghi nhớ -> 3.8 -> 3.7 -> 3.6 -> 3.5 ->
//   3-flash-preview -> 2.5 -> 2.0]; model nào gọi thành công thì ghi nhớ cho các lượt sau.
//   Lỗi tạm thời của model tốt được ưu tiên báo ra thay vì 404 của model cuối danh sách.
// - Lớp ngoài tự thử lại 3 lượt (nghỉ 0s/4s/10s) khi gặp lỗi tạm thời; lỗi cuối dịch sang
//   tiếng Việt dễ hiểu, không lộ JSON gốc của Google ra giao diện.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const extractKeyPattern = (raw: string | null | undefined): string => {
  if (!raw) return '';
  // Key Gemini có 2 định dạng: cũ bắt đầu bằng "AIza...", mới bắt đầu bằng "AQ."
  const match =
    String(raw).match(/AIza[0-9A-Za-z\-_]{25,}/) || String(raw).match(/AQ\.[0-9A-Za-z\-_]{20,}/);
  return match ? match[0] : '';
};

export const getApiKey = (customKey?: string): string => {
  const fromCustom = extractKeyPattern(customKey) || (customKey && customKey.trim());
  if (fromCustom) return fromCustom;
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('user_api_key') : null;
    const fromStored = extractKeyPattern(stored) || (stored && stored.trim());
    if (fromStored) return fromStored;
  } catch { /* trình duyệt chặn storage */ }
  const envKey = typeof process !== 'undefined' && process.env ? process.env.API_KEY : '';
  return envKey ? String(envKey).trim() : '';
};

/** Dịch lỗi HTTP của Gemini sang thông báo tiếng Việt dễ hiểu cho giáo viên. */
export const friendlyGeminiError = (status: number): string => {
  if (status === 503 || status === 500 || status === 502 || status === 504) {
    return 'Máy chủ AI của Google đang quá tải tạm thời nên chưa xử lý được yêu cầu. Đây là lỗi phía Google, không phải do API key hay máy của bạn. App đã tự thử lại vài lần; bạn vui lòng đợi 1–2 phút rồi bấm tạo lại.';
  }
  if (status === 429) {
    return 'Đã chạm hạn mức miễn phí của Gemini (quá nhiều yêu cầu trong thời gian ngắn). Vui lòng đợi khoảng 1 phút rồi thử lại. Nếu vẫn báo liên tục, dự án có thể đã hết hạn mức ngày.';
  }
  if (status === 401 || status === 403) {
    return 'API key không hợp lệ hoặc không còn quyền truy cập. Vui lòng kiểm tra lại key đã nhập, hoặc tạo key mới trong Google AI Studio.';
  }
  if (status === 400) {
    return 'Yêu cầu gửi tới AI chưa hợp lệ (có thể do API key sai định dạng hoặc nội dung quá dài). Vui lòng kiểm tra lại API key rồi thử lại.';
  }
  if (status === 404) {
    return 'Không tìm thấy mô hình AI mà app đang cấu hình. Vui lòng báo lại lỗi này cho người quản trị app.';
  }
  if (status === 0) {
    return 'Không kết nối được tới máy chủ AI của Google. Vui lòng kiểm tra kết nối mạng rồi thử lại.';
  }
  return `Máy chủ AI đang gặp sự cố (mã lỗi ${status}). Vui lòng thử lại sau ít phút.`;
};

const TRANSIENT_STATUSES = [0, 429, 500, 502, 503, 504];

/** Model đã gọi thành công gần nhất cho từng API key (ghi nhớ trong phiên). */
const rememberedModelByKey = new Map<string, string>();

const PRIMARY_MODEL = 'gemini-3.8-flash';

/** Mỗi dự án Google chỉ gọi được một số model — model ngoài danh sách được phép
 *  của dự án trả 404 — nên khi model chính 404, app tự lướt xuống model sau. */
const MODEL_FALLBACKS: string[] = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

export const modelCandidatesForKey = (apiKey: string): string[] => {
  const ordered = [rememberedModelByKey.get(apiKey), PRIMARY_MODEL, ...MODEL_FALLBACKS].filter(
    (m): m is string => !!m
  );
  return [...new Set(ordered)];
};

const JSON_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      id: { type: 'STRING' },
      comment: { type: 'STRING' },
    },
    required: ['id', 'comment'],
  },
};

const callGeminiRestApiOnce = async (
  systemInstruction: string,
  prompt: string,
  apiKey: string
): Promise<{ id: string; comment: string }[]> => {
  const models = modelCandidatesForKey(apiKey);
  let lastError = '';
  let firstTransientError = '';

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              responseMimeType: 'application/json',
              responseSchema: JSON_SCHEMA,
            },
          }),
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errBody = await response.text();
        lastError = `HTTP ${response.status}: ${errBody.slice(0, 200)}`;
        if ((response.status === 429 || response.status >= 500) && !firstTransientError) {
          firstTransientError = lastError;
        }
        continue;
      }

      const data = await response.json();
      const parts = data?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        const text = parts.filter((p: any) => !p?.thought).map((p: any) => p?.text || '').join('').trim();
        if (text) {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed)) {
            rememberedModelByKey.set(apiKey, model);
            return parsed;
          }
        }
      }
      lastError = 'AI trả về nội dung trống hoặc không đúng định dạng.';
    } catch (err: any) {
      lastError =
        err?.name === 'AbortError'
          ? 'Quá thời gian chờ (120 giây) khi gọi Gemini. Kiểm tra kết nối mạng rồi thử lại.'
          : err?.message || String(err);
      if (err?.name === 'AbortError' && !firstTransientError) {
        firstTransientError = lastError;
      }
    }
  }

  throw new Error(firstTransientError || lastError || 'Không thể kết nối tới Gemini API.');
};

/** Lớp bọc ngoài: tự thử lại khi gặp lỗi tạm thời phía Google, lỗi cuối dịch sang tiếng Việt. */
export const callGeminiJSON = async (
  systemInstruction: string,
  prompt: string,
  apiKey: string
): Promise<{ id: string; comment: string }[]> => {
  const delays = [0, 4000, 10000];
  let lastThrown: any;
  for (const delay of delays) {
    if (delay) await sleep(delay);
    try {
      return await callGeminiRestApiOnce(systemInstruction, prompt, apiKey);
    } catch (err: any) {
      lastThrown = err;
      const message = String(err?.message || err);
      const httpMatch = message.match(/^HTTP (\d{3}):/);
      const status = httpMatch ? Number(httpMatch[1]) : /failed to fetch|networkerror|load failed/i.test(message) ? 0 : -1;
      if (status === -1) throw err;
      if (!TRANSIENT_STATUSES.includes(status)) throw new Error(friendlyGeminiError(status));
    }
  }
  const message = String(lastThrown?.message || lastThrown);
  const httpMatch = message.match(/^HTTP (\d{3}):/);
  throw new Error(friendlyGeminiError(httpMatch ? Number(httpMatch[1]) : 0));
};

export interface ApiKeyCheckResult {
  ok: boolean;
  /** Lý do dễ hiểu khi ok = false, để hiện thẳng cho giáo viên. */
  message: string;
}

type ModelProbe = 'ok' | 'missing' | 'keybad' | 'busy' | 'slow';

/** Dò nhanh một model bằng yêu cầu "OK" tối giản (tắt tư duy, timeout 12 giây).
 *  Chỉ 404 mới kết luận model không khả dụng ('missing'); 429/5xx/mạng = 'busy';
 *  quá giờ = 'slow' (gọi được nhưng chậm). */
export const probeModel = async (model: string, apiKey: string, timeoutMs = 12000): Promise<ModelProbe> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'OK' }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 8, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
    if (response.ok) return 'ok';
    if (response.status === 404) return 'missing';
    if (response.status === 401 || response.status === 403) return 'keybad';
    return 'busy';
  } catch (err: any) {
    return err?.name === 'AbortError' ? 'slow' : 'busy';
  } finally {
    clearTimeout(timeoutId);
  }
};

const KEY_INVALID_MESSAGE =
  'API key không hợp lệ hoặc không có quyền dùng Gemini. Vui lòng kiểm tra lại key đã dán, hoặc tạo key mới trong Google AI Studio (aistudio.google.com/apikey).';

/**
 * Kiểm tra API Key khi giáo viên nhập — 2 bước như bản gốc phiếu học tập:
 * (1) ListModels kiểm chính cái key, rất nhanh, không tốn lượt tạo nội dung;
 * (2) dò model gọi được cho key này và ghi nhớ để khâu tạo nhận xét dùng luôn.
 */
export const validateApiKey = async (apiKey?: string): Promise<ApiKeyCheckResult> => {
  const keyToTest = getApiKey(apiKey);
  if (!keyToTest) {
    return { ok: false, message: 'Chưa nhập API key. Vui lòng dán API key lấy từ Google AI Studio.' };
  }

  const listController = new AbortController();
  const listTimeoutId = setTimeout(() => listController.abort(), 15000);
  let listStatus = 0;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(keyToTest)}&pageSize=1000`,
      { signal: listController.signal }
    );
    listStatus = response.status;
  } catch {
    return {
      ok: false,
      message: 'Không kết nối được tới Google để kiểm tra key. Vui lòng kiểm tra kết nối mạng rồi thử lại.',
    };
  } finally {
    clearTimeout(listTimeoutId);
  }
  if (listStatus === 400 || listStatus === 401 || listStatus === 403) {
    return { ok: false, message: KEY_INVALID_MESSAGE };
  }
  if (listStatus !== 200 && listStatus !== 429) {
    return {
      ok: false,
      message: 'Google đang bận nên chưa kiểm tra được key. Vui lòng đợi một lát rồi thử lại.',
    };
  }

  // Bước 2: dò model gọi được (bỏ qua nếu đã ghi nhớ). Model đang bận (503) vẫn
  // ghi nhớ tạm nhưng dò tiếp, ưu tiên model đang trả lời ngay cho lượt đầu tiên.
  if (!rememberedModelByKey.has(keyToTest)) {
    let firstBusyModel = '';
    for (const model of modelCandidatesForKey(keyToTest)) {
      const probe = await probeModel(model, keyToTest);
      if (probe === 'keybad') return { ok: false, message: KEY_INVALID_MESSAGE };
      if (probe === 'missing') continue;
      if (probe === 'busy') {
        if (!firstBusyModel) firstBusyModel = model;
        continue;
      }
      rememberedModelByKey.set(keyToTest, model);
      break;
    }
    if (!rememberedModelByKey.has(keyToTest) && firstBusyModel) {
      rememberedModelByKey.set(keyToTest, firstBusyModel);
    }
  }
  if (!rememberedModelByKey.has(keyToTest)) {
    return {
      ok: false,
      message:
        'Key này hợp lệ nhưng dự án của key chưa gọi được mô hình AI nào mà app hỗ trợ. Thường gặp khi key không tạo từ Google AI Studio — thầy/cô hãy tạo key mới ngay tại aistudio.google.com/apikey rồi nhập lại.',
    };
  }

  return { ok: true, message: '' };
};
