// 以伺服器金鑰呼叫 Supabase 資料庫（REST），只在 Edge Function 內使用。
export function db(env) {
  const base = env.SUPABASE_URL + '/rest/v1/', key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.SUPABASE_URL || !key) throw new Error('伺服器設定不完整');
  async function call(method, path, body, prefer) {
    const res = await fetch(base + path, {
      method,
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) { const err = new Error(`資料庫錯誤 ${res.status}: ${text.slice(0, 300)}`); err.internal = true; throw err; }
    return text ? JSON.parse(text) : null;
  }
  return {
    get: path => call('GET', path),
    insert: (table, row) => call('POST', table, row, 'return=representation'),
    update: (path, patch) => call('PATCH', path, patch, 'return=representation'),
    remove: path => call('DELETE', path),
    rpc: (fn, args) => call('POST', 'rpc/' + fn, args)
  };
}
