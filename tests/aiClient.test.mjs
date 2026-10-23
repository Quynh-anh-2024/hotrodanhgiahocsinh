// Harness kiểm tra cơ chế API (port từ app phiếu học tập) bằng fetch giả — không gọi mạng thật.
// Lưu ý: aiClient ghi nhớ model thắng theo key trong phiên, nên mỗi ca dùng một key khác nhau.
let calls = [];
let handler = () => { throw new Error('chưa đặt handler'); };
global.fetch = async (url, opts) => { calls.push(url); return handler(url, opts); };

const { validateApiKey, callGeminiJSON, extractKeyPattern } = await import('../services/aiClient.ts');

const resp = (status, jsonBody) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof jsonBody === 'string' ? jsonBody : JSON.stringify(jsonBody || {})),
  json: async () => jsonBody || {},
});
const genOk = (text) => resp(200, { candidates: [{ content: { parts: [{ text }] } }] });

let pass = 0, fail = 0;
const check = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL:', label); } };
const KEY = (n) => `AIza${'x'.repeat(30)}${n}`;

// 0. Định dạng key: nhận cả AIza... và AQ....
check(extractKeyPattern('dán nhầm chữ AIza' + 'a'.repeat(30) + ' cuối') === 'AIza' + 'a'.repeat(30), 'trích key AIza trong văn bản dán thừa');
check(extractKeyPattern('AQ.' + 'b'.repeat(25)) === 'AQ.' + 'b'.repeat(25), 'nhận key AQ.');

// 1. Key trống -> báo ngay, 0 lần gọi mạng
calls = [];
let r = await validateApiKey('');
check(r.ok === false && calls.length === 0, 'key trống: ok=false, 0 fetch');

// 2. ListModels 403 -> key sai thật, chỉ 1 lần gọi
calls = [];
handler = () => resp(403, 'forbidden');
r = await validateApiKey(KEY(2));
check(r.ok === false && /không hợp lệ/.test(r.message) && calls.length === 1, 'list 403: báo key sai, 1 fetch');

// 3. List 200 + probe model đầu ok -> ok, ghi nhớ; kiểm tra lần 2 chỉ còn 1 lần gọi list
calls = [];
handler = (url) => url.includes('generateContent') ? genOk('OK') : resp(200, { models: [] });
r = await validateApiKey(KEY(3));
check(r.ok === true && calls.length === 2, 'list 200 + probe ok: 2 fetch');
calls = [];
r = await validateApiKey(KEY(3));
check(r.ok === true && calls.length === 1, 'kiểm tra lần 2: chỉ 1 fetch (đã nhớ model)');

// 4. Probe: 3.8 -> 404, 3.7 -> 404, 3.6 -> ok : lướt đúng thứ tự ladder
calls = [];
handler = (url) => {
  if (!url.includes('generateContent')) return resp(200, { models: [] });
  if (url.includes('3.8')) return resp(404, 'nf');
  if (url.includes('3.7')) return resp(404, 'nf');
  return genOk('OK');
};
r = await validateApiKey(KEY(4));
check(r.ok === true && calls.filter(u => u.includes('generateContent')).length === 3, 'probe lướt 3.8->3.7->3.6');

// 5. Mọi model đều 404 -> key hợp lệ nhưng không gọi được model nào
calls = [];
handler = (url) => url.includes('generateContent') ? resp(404, 'nf') : resp(200, { models: [] });
r = await validateApiKey(KEY(5));
check(r.ok === false && /hợp lệ nhưng/.test(r.message), 'hết model: báo key hợp lệ nhưng không gọi được model');

// 6. ListModels 503 -> báo Google bận
calls = [];
handler = () => resp(503, 'busy');
r = await validateApiKey(KEY(6));
check(r.ok === false && /đang bận/.test(r.message), 'list 503: báo Google bận');

// 7. Mất mạng khi list -> báo kết nối
calls = [];
handler = () => { throw new Error('Failed to fetch'); };
r = await validateApiKey(KEY(7));
check(r.ok === false && /Không kết nối được/.test(r.message), 'mất mạng: báo kết nối');

// 8. Tạo nội dung: model đầu 404 -> lướt model sau, parse JSON đúng
calls = [];
handler = (url) => {
  if (url.includes('3.8')) return resp(404, 'nf');
  return genOk(JSON.stringify([{ id: 'a', comment: 'Nhận xét mẫu' }]));
};
const out = await callGeminiJSON('sys', 'prompt', KEY(8));
check(Array.isArray(out) && out[0].comment === 'Nhận xét mẫu', 'callGeminiJSON: lướt model + parse JSON');

// 9. Tạo nội dung: 401 -> dịch lỗi tiếng Việt, không lộ JSON gốc
handler = () => resp(401, '{"error":{"message":"API key not valid"}}');
let threw = '';
try { await callGeminiJSON('sys', 'prompt', KEY(9)); } catch (e) { threw = e.message; }
check(/không hợp lệ/.test(threw) && !/API key not valid/.test(threw), 'lỗi 401 dịch tiếng Việt, không lộ JSON gốc');

console.log(`\nKẾT QUẢ AI CLIENT: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
