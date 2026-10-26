const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'demo', 'index.html');
const dest = path.join(root, 'dist', 'index.html');

if (!fs.existsSync(path.join(root, 'dist'))) {
  console.error('dist/ not found. Run "npm run build" first.');
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log('Copied demo/index.html -> dist/index.html');
console.log('Serve with: npx serve dist  (or any static server on dist/)');
