// 계층 규칙 관문. 의존 방향이 뒤집히면 실패한다.
//
// 이 검사가 막는 것은 시험 비용의 폭발이다. 도메인이 플랫폼을 알게 되면 그 순간부터
// 도메인 시험에 기기가 필요해지고, 기기가 필요하면 확인이 사람 손으로 돌아간다.
// 실제로 진단 화면이 어댑터를 직접 부르고 있었고, 사람은 그것을 못 봤다.
//
// 규칙은 docs/ARCHITECTURE.md 의 계층 표와 같아야 한다. 다르면 이 파일이 틀렸다.
//
// 실행: node tools/check-layers.mjs

import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'app', 'src');

// 각 계층이 부를 수 있는 계층. 자기 계층은 언제나 허용한다
const ALLOWED = {
  domain: [],
  application: ['domain'],
  infrastructure: ['domain', 'application'],
  presentation: ['application', 'domain']
};

// 도메인은 프레임워크를 모른다. 패키지를 하나라도 부르면 그 순간 순수함이 깨진다.
// 나머지 계층은 패키지를 부를 수 있다
const NO_PACKAGES = ['domain'];

// 화면이 도메인을 부르는 것까지 막지 않는다. 상수와 도메인 낱말은 화면도 쓴다.
// 막는 것은 화면이 어댑터를 직접 잡는 것이다.
//
// 예외는 조립 지점 하나다. 어느 구현체를 어느 포트에 끼우는지 정하는 자리이므로
// 정의상 양쪽을 다 알아야 한다. 예외를 파일 하나로 못박아 두면, 다른 파일이
// 같은 이유를 들 수 없다. 「조립이니까」는 이 파일에서만 통한다
const COMPOSITION_ROOT = 'application/wiring.js';

function layerOf(file) {
  const rel = path.relative(SRC, file);
  return rel.split(path.sep)[0];
}

function walk(dir) {
  const out = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.name.endsWith('.js')) out.push(full);
  });
  return out;
}

// import 문에서 부르는 대상만 뽑는다. 주석 안의 예시는 세지 않는다
function importsOf(src) {
  const out = [];
  const re = /^\s*(?:import\s[^'"]*from\s*|import\s*)['"]([^'"]+)['"]/gm;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  const req = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = req.exec(src)) !== null) out.push(m[1]);
  return out;
}

const problems = [];

walk(SRC).forEach(function (file) {
  const layer = layerOf(file);
  const allowed = ALLOWED[layer];
  if (!allowed) return;
  const src = fs.readFileSync(file, 'utf8');
  const where = path.relative(process.cwd(), file);
  if (path.relative(SRC, file).split(path.sep).join('/') === COMPOSITION_ROOT) return;

  importsOf(src).forEach(function (spec) {
    if (spec.startsWith('.')) {
      const target = path.resolve(path.dirname(file), spec);
      if (!target.startsWith(SRC)) return;          // 자산 등 계층 밖 파일
      const targetLayer = layerOf(target);
      if (targetLayer === layer) return;
      if (allowed.indexOf(targetLayer) < 0) {
        problems.push(where + ' → ' + targetLayer + ' (' + spec + ')');
      }
      return;
    }
    // 패키지
    if (NO_PACKAGES.indexOf(layer) >= 0) {
      problems.push(where + ' → 패키지 ' + spec + ' (도메인은 프레임워크를 모른다)');
    }
  });
});

if (problems.length) {
  console.log('계층 규칙 위반 ' + problems.length + '건');
  problems.forEach(function (p) { console.log('  ' + p); });
  console.log('\n허용 방향: domain ← application ← infrastructure·presentation');
  console.log('화면이 어댑터를 직접 부르면 세션에 통로를 두고 그것을 부른다');
  process.exit(1);
}

console.log('계층 규칙 통과');
