// 顧客下單、重新付款與查詢訂單狀態（部署時加上 --no-verify-jwt）
import { handleCheckout } from '../_shared/handlers.js';

Deno.serve(req => handleCheckout(req, Deno.env.toObject()));
