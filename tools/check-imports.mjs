// 구문과 import 해석 관문.
//
// 앱을 실제로 빌드하면 몇 분이 든다. 이 관문은 그 빌드가 잡는 것 중 가장 자주 나는
// 두 가지를 초 단위로 잡는다. 구문 오류와, 가리키는 파일이 없는 import.
//
// 이것이 빌드를 대신하지는 않는다. 네이티브 설정이 깨지는 것은 여기서 안 보인다.
// 그건 사람이 기기로 나갈 때 이미 확인된다. 관문에 10분을 넣지 않기로 한 근거는
// ADR 0010 에 있다.
//
// 실행: node tools/check-imports.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const APP = path.join(process.cwd(), 'app');
const ROOTS = [path.join(APP, 'src'), path.join(APP, 'test')];
const ENTRIES = [path.join(APP, 'App.js'), path.join(APP, 'index.js')];

// 확장자를 붙여 보는 순서. 리액트 네이티브 번들러가 보는 순서와 같게 둔다
const EXTS = ['', '.js', '.mjs', '.json', '/index.js'];

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.(js|mjs)$/.test(e.name)) out.push(full);
  });
  return out;
}

const files = ROOTS.flatMap(walk).concat(ENTRIES.filter(function (f) { return fs.existsSync(f); }));
const problems = [];

files.forEach(function (file) {
  const where = path.relative(process.cwd(), file);

  // 구문. node 가 파싱만 한다. 실행하지 않으므로 부작용이 없다
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (e) {
    // JSX 는 node 가 모른다. 그 파일은 구문 검사 대상이 아니다
    const msg = String(e.stderr || '');
    if (!/Unexpected token '<'|Unexpected token <|JSX/.test(msg)) {
      problems.push(where + ' 구문 오류\n    ' + msg.split('\n').slice(0, 3).join('\n    '));
    }
  }

  // 상대 경로 import 가 가리키는 파일이 있는가
  const src = fs.readFileSync(file, 'utf8');
  const re = /(?:from\s*|require\(\s*)['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const base = path.resolve(path.dirname(file), m[1]);
    const hit = EXTS.some(function (ext) { return fs.existsSync(base + ext); });
    if (!hit) problems.push(where + ' → 없는 파일 ' + m[1]);
  }
});

if (problems.length) {
  console.log('구문·import 문제 ' + problems.length + '건');
  problems.forEach(function (p) { console.log('  ' + p); });
  process.exit(1);
}

console.log('구문·import 통과 (' + files.length + '개 파일)');
