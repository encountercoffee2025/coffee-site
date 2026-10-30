// 綠界付款通知與付款後導回（部署時加上 --no-verify-jwt）
import { handleEcpay } from '../_shared/handlers.js';

Deno.serve(req => handleEcpay(req, Deno.env.toObject()));
