// 把網站的 assets/store.js 與月費方案（assets/catalog-data.js 的 COFFEE_PLANS）同步到伺服器模組：
//   supabase/functions/_shared/store.js、supabase/functions/_shared/plans.js
// 修改上述網站檔案後執行：node scripts/sync-store.cjs（tests/server.test.mjs 會檢查是否一致）。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');

function build() {
  const source = fs.readFileSync(path.join(root, 'assets/store.js'), 'utf8');
  return '// 自動產生：由 assets/store.js 包成伺服器模組（node scripts/sync-store.cjs），請勿直接修改。\n' +
    'export function loadStore(window, localStorage, CustomEvent) {\n' + source + '\nreturn window.CoffeeStore;\n}\n';
}

function buildPlans() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/catalog-data.js'), 'utf8'), context);
  return '// 自動產生：由 assets/catalog-data.js 的 COFFEE_PLANS 同步（node scripts/sync-store.cjs），請勿直接修改。\n' +
    'export const PLANS = ' + JSON.stringify(context.window.COFFEE_PLANS, null, 2) + ';\n';
}

module.exports = { build, buildPlans };
if (require.main === module) {
  fs.writeFileSync(path.join(root, 'supabase/functions/_shared/store.js'), build());
  fs.writeFileSync(path.join(root, 'supabase/functions/_shared/plans.js'), buildPlans());
  console.log('supabase/functions/_shared/store.js and plans.js updated');
}
