// 後台自動翻譯（中文 → 英文，DeepL API Free）。部署時加上 --no-verify-jwt：函式自己檢查管理員身分與兩步驟驗證。
// 需要 Supabase secret：DEEPL_API_KEY
import { handleTranslate } from '../_shared/translate.js';

Deno.serve(req => handleTranslate(req, Deno.env.toObject()));
