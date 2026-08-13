// 진단 세션 시험. 기기 없이 돈다.
//
// 잡는 것
//   - 만료되면 스스로 배경 구독을 해제하는가 (앱이 계속 깨어나던 결함)
//   - 기록이 실행 맥락 재시작을 넘어 남는가 (1차 측정이 판정 불가였던 결함)
//   - 화면 꺼진 구간의 건수를 옳게 세는가
//   - 배경 권한이 없으면 시작하지 않는가
//   - 플랫폼이 주는 모양을 옳게 읽는가
//   - 음성을 부른 것과 끝까지 재생된 것을 가르는가 (웹이 빠진 틈)
//
// 실행: node test/run.mjs

import { readFileSync } from 'node:fs';
import { createDiagnosticSession, MAX_MS, SPEECH_MSG } from '../src/application/DiagnosticSession.js';
import { fakeClock, fakeTrace, fakeSession, fakeLocation, fakeSpeech, platformFix } from './doubles.mjs';

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function build(opts) {
  const o = opts || {};
  const clock = fakeClock();
  const trace = fakeTrace(); trace.bindClock(clock);
  const session = fakeSession();
  const location = fakeLocation(o.location);
  const speech = fakeSpeech(o.speech);
  const s = createDiagnosticSession({
    location, trace, session,
    now: clock.now,
    speak: speech.speak
  });
  return { s, clock, trace, session, location, speech, said: speech.said };
}

test('배경 권한이 없으면 시작하지 않는다', async function () {
  const { s, location, session } = build({
    location: { permissions: { foreground: 'granted', background: 'denied' } }
  });
  const r = await s.start();
  assert(r.started === false, '배경 권한이 없는데 시작했습니다');
  assert(r.reason === 'background-permission', '사유가 다릅니다: ' + r.reason);
  assert(location.state.startCalls === 0, '구독을 걸었습니다');
  assert(session.read() === null, '세션을 남겼습니다');
});

test('구독 실패하면 세션을 남기지 않는다', async function () {
  const { s, session } = build({ location: { failStart: true } });
  const r = await s.start();
  assert(r.started === false, '실패했는데 시작으로 보고했습니다');
  assert(session.read() === null, '세션이 남아 다음 실행이 만료 미판정 상태가 됩니다');
});

test('만료되면 배경 맥락이 스스로 구독을 해제한다', async function () {
  const { s, clock, location, session } = build();
  await s.start();
  assert(location.state.running === true, '구독이 걸리지 않았습니다');

  clock.advance(MAX_MS + 1000);
  await s.onBackgroundFixes({ error: null, fixes: [platformFix({})] });

  assert(location.state.stopCalls === 1, '만료됐는데 해제하지 않았습니다');
  assert(location.state.running === false, '구독이 살아 있습니다');
  assert(session.read() === null, '세션이 남았습니다');
});

test('만료 전에는 해제하지 않는다', async function () {
  const { s, clock, location } = build();
  await s.start();
  clock.advance(MAX_MS - 1000);
  await s.onBackgroundFixes({ error: null, fixes: [platformFix({})] });
  assert(location.state.stopCalls === 0, '만료 전에 해제했습니다');
  assert(s.view().backgroundFixes === 1, '위치를 세지 않았습니다');
});

test('세션 기록 없이 구독만 남은 상태를 만료로 본다', async function () {
  const { s, location } = build();
  // 앱이 종료되며 세션 파일이 사라졌는데 등록만 남은 상황
  location.state.running = true;
  assert(s.isExpired() === true, '기록이 없는데 만료로 보지 않습니다');
  const reaped = await s.reapStaleSubscription();
  assert(reaped === true, '남은 구독을 정리하지 않았습니다');
  assert(location.state.running === false, '구독이 살아 있습니다');
});

test('화면 꺼진 구간에 들어온 건수만 센다', async function () {
  const { s, clock } = build();
  await s.start();

  // 화면이 켜져 있는 동안 두 건
  await s.onBackgroundFixes({ error: null, fixes: [platformFix({}), platformFix({})] });

  clock.advance(1000);   // 시간은 흐른다. 배경 진입은 앞선 기록보다 뒤다
  s.enterBackground();
  clock.advance(5000);
  await s.onBackgroundFixes({ error: null, fixes: [platformFix({}), platformFix({}), platformFix({})] });
  clock.advance(5000);

  const hidden = s.returnToForeground();
  assert(hidden === 3, '꺼진 동안 건수가 3 이 아니라 ' + hidden + ' 입니다');
  assert(s.view().backgroundFixes === 5, '전체 건수가 5 가 아니라 ' + s.view().backgroundFixes + ' 입니다');
});

test('배경에 들어가지 않았으면 판정값이 없다', async function () {
  const { s } = build();
  await s.start();
  assert(s.returnToForeground() === null, '배경 진입 없이 판정값이 나왔습니다');
});

test('기록은 실행 맥락이 새로 만들어져도 남는다', async function () {
  // 저장은 살아 있고 세션 객체만 새로 만들어지는 상황. 앱이 배경에서 깨어난 경우다
  const clock = fakeClock();
  const trace = fakeTrace(); trace.bindClock(clock);
  const session = fakeSession();
  const location = fakeLocation();

  const first = createDiagnosticSession({ location, trace, session, now: clock.now });
  await first.start();
  await first.onBackgroundFixes({ error: null, fixes: [platformFix({}), platformFix({})] });

  // 맥락 재시작
  const second = createDiagnosticSession({ location, trace, session, now: clock.now });
  assert(second.view().backgroundFixes === 2,
    '재시작 뒤 건수가 사라졌습니다 (' + second.view().backgroundFixes + ')');
});

test('플랫폼이 주는 정확도와 속도를 옳게 읽는다', async function () {
  const { s, trace } = build();
  await s.start();
  await s.onBackgroundFixes({ error: null, fixes: [platformFix({ acc: 12.4, speed: 3.27 })] });
  const line = trace.read().filter(function (m) { return m.kind === 'bg'; })[0].msg;
  assert(line.indexOf('±12m') === 0, '정확도 표기가 다릅니다: ' + line);
  assert(line.indexOf('3.3') > 0, '속도 표기가 다릅니다: ' + line);
});

test('속도가 없거나 음수면 없음으로 적는다', async function () {
  const { s, trace } = build();
  await s.start();
  await s.onBackgroundFixes({ error: null, fixes: [platformFix({ speed: -1 })] });
  await s.onBackgroundFixes({ error: null, fixes: [platformFix({ speed: null })] });
  const lines = trace.read().filter(function (m) { return m.kind === 'bg'; });
  assert(lines.length === 2, '두 건이 아닙니다');
  lines.forEach(function (l) {
    assert(l.msg.indexOf('n/a') > 0, '음수·없음을 n/a 로 적지 않았습니다: ' + l.msg);
  });
});

test('배경 작업 오류를 기록하고 위치로 세지 않는다', async function () {
  const { s } = build();
  await s.start();
  await s.onBackgroundFixes({ error: '위치 서비스 거부', fixes: [] });
  const v = s.view();
  assert(v.errors === 1, '오류를 기록하지 않았습니다');
  assert(v.backgroundFixes === 0, '오류를 위치로 셌습니다');
});

test('음성은 20초에 한 번만 나간다', async function () {
  const { s, clock, said } = build();
  await s.start();
  const before = said.length;
  await s.onBackgroundFixes({ error: null, fixes: [platformFix({})] });
  clock.advance(5000);
  await s.onBackgroundFixes({ error: null, fixes: [platformFix({})] });
  assert(said.length - before === 1, '5초 만에 두 번 말했습니다');
  clock.advance(21000);
  await s.onBackgroundFixes({ error: null, fixes: [platformFix({})] });
  assert(said.length - before === 2, '20초 뒤에 말하지 않았습니다');
});

test('끝까지 재생된 음성만 완료로 센다', async function () {
  const { s, trace } = build({ speech: { outcomes: ['started', 'done'] } });
  await s.start();
  const v = s.view();
  assert(v.speechRequests === 1, '요청을 세지 않았습니다 (' + v.speechRequests + ')');
  assert(v.speechDone === 1, '완료를 세지 않았습니다 (' + v.speechDone + ')');
  const msgs = trace.read().map(function (m) { return m.msg; });
  assert(msgs.indexOf(SPEECH_MSG.started) > 0, '재생 시작이 기록되지 않았습니다');
});

test('중간에 끊긴 음성은 완료로 세지 않는다', async function () {
  // 오디오 세션이 끊기면 iOS 는 done 대신 stopped 를 준다. 이 둘은 함께 오지 않는다
  const { s, trace } = build({ speech: { outcomes: ['started', 'stopped'] } });
  await s.start();
  const v = s.view();
  assert(v.speechRequests === 1, '요청을 세지 않았습니다');
  assert(v.speechDone === 0, '끊긴 음성을 완료로 셌습니다');
  const msgs = trace.read().map(function (m) { return m.msg; });
  assert(msgs.indexOf(SPEECH_MSG.stopped) > 0, '중단이 기록되지 않았습니다');
});

test('음성 결과가 오지 않아도 요청은 남는다', async function () {
  // 콜백이 오지 않는 것과 실패한 것은 다르다. 요청만 남고 완료가 없으면 그 사실이 판정이다
  const { s } = build();
  await s.start();
  const v = s.view();
  assert(v.speechRequests === 1, '요청이 남지 않았습니다');
  assert(v.speechDone === 0, '결과가 없는데 완료로 셌습니다');
  assert(v.errors === 0, '결과가 없는 것을 오류로 셌습니다');
});

test('음성 실패는 사유를 기록한다', async function () {
  const { s, trace } = build({ speech: { outcomes: ['error'], detail: '합성기 없음' } });
  await s.start();
  const line = trace.read().filter(function (m) {
    return m.msg.indexOf(SPEECH_MSG.error) === 0;
  })[0];
  assert(line, '실패가 기록되지 않았습니다');
  assert(line.msg.indexOf('합성기 없음') > 0, '사유가 빠졌습니다: ' + line.msg);
});

test('중지하면 구독과 세션이 모두 사라진다', async function () {
  const { s, location, session } = build();
  await s.start();
  await s.stop();
  assert(location.state.running === false, '구독이 남았습니다');
  assert(session.read() === null, '세션이 남았습니다');
});

/* ── 소스 관문 ─────────────────────────────────────────────────
   대역으로는 잡히지 않는 결함이 있다. 기록 저장이 파일 전체를 다시 쓰면 줄이 사라지는데,
   메모리 대역은 그 구조를 갖지 않아 시험이 전부 통과한다. 그래서 소스를 직접 본다. */

const traceSrc = readFileSync(new URL('../src/infrastructure/storage/FileTrace.js', import.meta.url), 'utf8');

function bodyOf(src, name) {
  const from = src.indexOf('  ' + name + '(');
  if (from < 0) return '';
  const to = src.indexOf('\n  },', from);
  return src.slice(from, to < 0 ? src.length : to);
}

test('기록 덧붙이기는 파일 전체를 다시 쓰지 않는다', function () {
  const body = bodyOf(traceSrc, 'append');
  assert(body.length > 0, 'append 를 찾지 못했습니다');
  assert(/append:\s*true/.test(body), '덧붙이기 옵션 없이 씁니다. 앞 줄이 덮입니다');
  assert(!/textSync|\.text\(/.test(body), '덧붙이면서 파일을 읽습니다. 읽고-다시-쓰기 구조입니다');
});

test('기록 실패가 측정을 멈추지 않는다', function () {
  const body = bodyOf(traceSrc, 'append');
  assert(/catch/.test(body), '기록 실패를 삼키지 않습니다. 측정이 함께 멈춥니다');
});

/* ── 실행 ─────────────────────────────────────────────────────── */
let pass = 0, fail = 0;
const t0 = Date.now();
for (const c of cases) {
  try { await c.fn(); pass++; console.log('  ok    ' + c.name); }
  catch (e) { fail++; console.log('  FAIL  ' + c.name + '\n        ' + e.message); }
}
console.log('\n' + pass + ' 통과 · ' + fail + ' 실패 · ' + ((Date.now() - t0) / 1000).toFixed(1) + '초');
process.exit(fail ? 1 : 0);
