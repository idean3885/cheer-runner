// 기기 시험 공용부.
//
// 진단 경로와 달리기 경로가 같은 절차를 쓴다. 표식을 넣어 앱이 스스로 시작하게 하고,
// 다른 앱을 띄워 배경으로 보내고, 기록 파일을 가져와 판정한다.
//
// 화면 잠금은 호스트에서 걸 수 없다. 그래서 다른 앱을 띄우는 것으로 대신한다.
// 잠금보다 느슨한 조건이지만, 여기서 0건이면 잠금에서도 0건이므로 먼저 걸러낸다.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BUNDLE = 'me.idean.cheerrunner';
export const OTHER = 'com.apple.Preferences';   // 우리 앱을 배경으로 보내는 데만 쓴다

export function run(args, opts) {
  return new Promise(function (resolve, reject) {
    execFile('xcrun', args, { maxBuffer: 8 << 20, timeout: (opts && opts.timeout) || 120000 },
      function (err, stdout, stderr) {
        if (err && !(opts && opts.allowFail)) reject(new Error(stderr || stdout || err.message));
        else resolve(stdout + stderr);
      });
  });
}

export const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

export function fail(msg) { console.log('\n실패: ' + msg); process.exit(1); }

export function workDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cr-device-'));
}

export async function findDevice() {
  const out = await run(['devicectl', 'list', 'devices']);
  const line = out.split('\n').find(function (l) { return /iPhone|iPad/.test(l) && /connected/.test(l); });
  if (!line) throw new Error('연결된 기기가 없습니다. 케이블을 꽂고 잠금을 해제하세요');
  const id = line.trim().split(/\s+/).find(function (t) { return /^[0-9A-F]{8}-/.test(t); });
  if (!id) throw new Error('기기 식별자를 읽지 못했습니다: ' + line.trim());
  return id;
}

export async function pushMarker(dev, dir, name) {
  const marker = path.join(dir, name);
  fs.writeFileSync(marker, '');
  await run(['devicectl', 'device', 'copy', 'to', '--device', dev,
    '--domain-type', 'appDataContainer', '--domain-identifier', BUNDLE,
    '--source', marker, '--destination', 'Documents/' + name]);
}

export async function pullTrace(dev, dir) {
  // 목적지는 파일 경로여야 한다. 디렉토리를 주면 «Is a directory» 로 끊긴다
  const f = path.join(dir, 'trace.jsonl');
  fs.rmSync(f, { force: true });
  await run(['devicectl', 'device', 'copy', 'from', '--device', dev,
    '--domain-type', 'appDataContainer', '--domain-identifier', BUNDLE,
    '--source', 'Documents/trace.jsonl', '--destination', f], { allowFail: true });
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n')
    .filter(function (l) { return l.trim().length > 2; })
    .map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter(Boolean);
}

export async function launch(dev, bundle) {
  try {
    return await run(['devicectl', 'device', 'process', 'launch', '--device', dev,
      '--terminate-existing', bundle]);
  } catch (e) {
    // 무료 개인 팀 서명은 기기에서 개발자를 한 번 신뢰해야 실행된다.
    // 처음 한 번뿐이지만 사람이 해야 하므로 무엇을 해야 하는지 그대로 알린다
    if (/invalid code signature|not been explicitly trusted/.test(e.message)) {
      fail('기기가 이 개발자를 아직 신뢰하지 않습니다.\n'
        + '      설정 → 일반 → VPN 및 기기 관리 → 개발자 앱 → 신뢰\n'
        + '      그 뒤 홈 화면에서 앱을 한 번 실행하고 위치 권한을 «항상 허용» 으로 주세요');
    }
    if (/locked|passcode/i.test(e.message)) {
      fail('기기가 잠겨 있습니다. 잠금을 해제하고 다시 실행하세요');
    }
    throw e;
  }
}

// 배경으로 보낸 시각은 기기가 남긴 기록에서 찾는다. 노트북 시계로 잡으면
// 두 시계의 차이가 그대로 판정 오차가 된다
export function hiddenFrom(trace) {
  const entered = trace.filter(function (m) { return /배경 진입/.test(m.msg); });
  return entered.length ? entered[entered.length - 1].at : null;
}
