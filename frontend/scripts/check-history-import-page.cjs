const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'pages', 'HistoryImport.tsx');
const content = fs.readFileSync(filePath, 'utf8');

const requiredMarkers = [
  '印数文件',
  '点击或拖拽上传印数文件',
  'className="history-import-preview-action"',
];

const missing = requiredMarkers.filter((marker) => !content.includes(marker));

if (missing.length > 0) {
  console.error(`Missing markers: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('History import page markers verified.');
