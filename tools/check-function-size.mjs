// 함수 크기 관문. 한 함수가 커지면 그 안에서 여러 일을 한다.
//
// 도메인과 응용 계층에만 걸린다. 화면은 JSX 라 줄 수가 로직 크기를 뜻하지 않는다.
// 그림을 그리는 줄과 판단하는 줄을 같은 자로 재면, 화면을 쪼개려고 컴포넌트를
// 늘리는 일이 생기고 그건 이 관문이 막으려던 것과 무관하다.
//
// 세는 방법은 여는 중괄호와 닫는 중괄호의 깊이다. 문자열·정규식 안의 괄호를 세지
// 않으려고 그 부분을 먼저 지운다. 정확한 파서는 아니지만, 이 프로젝트의 코드 형태
// (함수 선언과 함수 표현식만 쓴다)에서는 같은 값을 낸다.
//
// **가장 안쪽 함수만 잰다.** 세션은 안에 함수 여러 개를 담는 팩토리라 껍데기 줄 수가
// 400줄을 넘는데, 그 값은 「한 함수가 여러 일을 한다」를 뜻하지 않는다. 다른 함수를
// 품은 함수는 세지 않고, 품긴 쪽을 센다.
//
// 한계값을 어디서 가져왔나. ADR 0003 이 40줄을 적었고, 지금 코드의 최대가 그보다
// 작다. 그래서 40 을 그대로 쓴다. 넘는 함수가 생기면 한계를 올리는 대신 쪼갠다.
//
// 실행: node tools/check-function-size.mjs [--report]

import fs from 'node:fs';
import path from 'node:path';

const MAX = 40;
const DIRS = ['domain', 'application'];
const SRC = path.join(process.cwd(), 'app', 'src');
const report = process.argv.indexOf('--report') >= 0;

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.name.endsWith('.js')) out.push(full);
  });
  return out;
}

// 문자열·주석·정규식을 지운다. 남은 것에서만 괄호를 센다
function strip(line) {
  return line
    .replace(/\\./g, '')
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""')
    .replace(/`[^`]*`/g, '``')
    .replace(/\/\/.*$/, '')
    .replace(/\/[^/*][^/]*\//g, '//');
}

function functionsOf(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const found = [];
  const open = [];       // { name, line, depth }
  let depth = 0;

  lines.forEach(function (raw, i) {
    const line = strip(raw);
    const m = /(?:function\s+([A-Za-z0-9_$]+)\s*\(|([A-Za-z0-9_$]+)\s*[:=]\s*(?:async\s*)?function\s*\(|(?:async\s+)?function\s*\()/.exec(line);
    const opens = (line.match(/{/g) || []).length;
    const closes = (line.match(/}/g) || []).length;

    if (m) open.push({ name: m[1] || m[2] || '(익명)', line: i + 1, depth: depth });

    depth += opens - closes;

    // 열려 있던 함수 중 자기 깊이로 돌아온 것을 닫는다
    while (open.length && depth <= open[open.length - 1].depth) {
      const fn = open.pop();
      // 안에 다른 함수를 품었으면 껍데기다. 품긴 쪽이 이미 목록에 있다
      const wraps = found.some(function (f) { return f.from > fn.line && f.to <= i + 1; });
      if (!wraps) found.push({ name: fn.name, from: fn.line, to: i + 1, size: i + 1 - fn.line + 1 });
    }
  });
  return found;
}

const all = [];
DIRS.forEach(function (d) {
  walk(path.join(SRC, d)).forEach(function (file) {
    functionsOf(file).forEach(function (fn) {
      all.push({ where: path.relative(process.cwd(), file), ...fn });
    });
  });
});

all.sort(function (a, b) { return b.size - a.size; });

if (report) {
  console.log('큰 함수 10개 (한계 ' + MAX + '줄)');
  all.slice(0, 10).forEach(function (fn) {
    console.log('  ' + String(fn.size).padStart(3) + '줄  ' + fn.name + '  ' + fn.where + ':' + fn.from);
  });
  process.exit(0);
}

const over = all.filter(function (fn) { return fn.size > MAX; });
if (over.length) {
  console.log('한계 ' + MAX + '줄을 넘는 함수 ' + over.length + '개');
  over.forEach(function (fn) {
    console.log('  ' + fn.size + '줄  ' + fn.name + '  ' + fn.where + ':' + fn.from);
  });
  console.log('\n한계를 올리는 대신 쪼갠다. 한 함수가 커지면 그 안에서 여러 일을 한다');
  process.exit(1);
}

console.log('함수 크기 통과 (최대 ' + (all.length ? all[0].size : 0) + '줄, 한계 ' + MAX + '줄)');
