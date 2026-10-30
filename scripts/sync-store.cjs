// 把網站的 assets/store.js 包成伺服器模組 supabase/functions/_shared/store.js。
// 修改 assets/store.js 後執行：node scripts/sync-store.cjs（tests/server.test.mjs 會檢查兩者一致）。
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

function build() {
  const source = fs.readFileSync(path.join(root, 'assets/store.js'), 'utf8');
  return '// 自動產生：由 assets/store.js 包成伺服器模組（node scripts/sync-store.cjs），請勿直接修改。\n' +
    'export function loadStore(window, localStorage, CustomEvent) {\n' + source + '\nreturn window.CoffeeStore;\n}\n';
}

module.exports = { build };
if (require.main === module) {
  fs.writeFileSync(path.join(root, 'supabase/functions/_shared/store.js'), build());
  console.log('supabase/functions/_shared/store.js updated');
}
