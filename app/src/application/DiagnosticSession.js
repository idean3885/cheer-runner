// 진단 세션. 화면도 프레임워크도 모른다.
//
// 화면 안에 있던 판단을 여기로 옮겼다. 옮긴 이유는 하나다. 리액트 컴포넌트 안에서는
// 기기 없이 시험할 수 없고, 기기가 필요하면 확인이 사람 손으로 돌아간다.
//
// 위치 포트와 기록·세션 저장을 주입받는다. 시험에서는 가짜를 넣는다.
// 벽시계도 주입받는다. 만료 판정을 시험하려면 시각을 마음대로 옮겨야 한다.

export const MAX_MS = 30 * 60 * 1000;

// 음성은 부른 것과 들린 것이 다르다. 어디까지 갔는지를 기록에 남겨 구분한다.
// 문구를 상수로 두는 이유는 세는 쪽과 적는 쪽이 같은 값을 봐야 하기 때문이다
export const SPEECH_MSG = {
  request: '음성 출력 요청',
  started: '음성 재생 시작',
  done: '음성 재생 완료',
  stopped: '음성 재생 중단',
  error: '음성 재생 실패'
};

export function createDiagnosticSession(deps) {
  const location = deps.location;
  const trace = deps.trace;
  const session = deps.session;
  const speak = deps.speak || function () {};
  const now = deps.now || function () { return Date.now(); };

  let hiddenSince = null;
  let lastSpokeAt = 0;

  // 배경 맥락이 깨어날 때마다 부른다. 화면이 없어도, 앱이 종료된 뒤에도 돈다
  function onBackgroundFixes(payload) {
    // 만료됐으면 스스로 해제한다. 이 검사가 없으면 사용자가 중지를 누를 때까지
    // iOS 가 계속 앱을 깨운다. 실제로 그 상태가 됐다
    if (isExpired()) {
      trace.append('mark', '=== 측정 상한 도달. 배경 구독을 해제합니다 ===');
      session.clear();
      return location.stopBackground();
    }
    if (payload.error) {
      trace.append('err', '배경 작업 오류: ' + payload.error);
      return Promise.resolve();
    }
    (payload.fixes || []).forEach(function (loc) {
      const c = loc.coords;
      trace.append('bg', '±' + Math.round(c.accuracy) + 'm 속도 '
        + (c.speed == null || c.speed < 0 ? 'n/a' : c.speed.toFixed(1)));
    });
    // 화면이 꺼진 상태에서 소리가 들리는지가 두 번째 질문이다. 20초에 한 번만
    const t = now();
    if ((payload.fixes || []).length && t - lastSpokeAt > 20000) {
      lastSpokeAt = t;
      say('배경 위치 ' + countKind('bg') + '건');
    }
    return Promise.resolve();
  }

  function say(text) {
    trace.append('say', SPEECH_MSG.request);
    speak(text, function (outcome, detail) {
      const base = SPEECH_MSG[outcome] || ('음성 상태 ' + outcome);
      trace.append('say', detail ? base + ': ' + detail : base);
    });
  }

  function isExpired() {
    const rec = session.read();
    if (!rec || !rec.expiresAt) return true;   // 기록 없이 구독만 남은 상태가 가장 위험하다
    return now() > rec.expiresAt;
  }

  function countKind(kind) {
    return trace.read().filter(function (m) { return m.kind === kind; }).length;
  }

  function countMsg(msg) {
    return trace.read().filter(function (m) { return m.msg === msg; }).length;
  }

  async function start() {
    trace.clear();
    session.clear();
    hiddenSince = null;
    lastSpokeAt = 0;
    trace.append('mark', '=== 측정 시작 ===');

    const p = await location.requestPermissions();
    trace.append('vis', '전경 권한 ' + p.foreground + ' / 배경 권한 ' + p.background);
    if (p.background !== 'granted') {
      trace.append('err', '배경 권한이 «항상 허용» 이 아니면 이 측정은 성립하지 않습니다');
      return { started: false, reason: 'background-permission', permissions: p };
    }

    session.start(MAX_MS, now());
    try {
      await location.startBackground();
    } catch (e) {
      trace.append('err', '배경 구독 실패: ' + e.message);
      session.clear();
      return { started: false, reason: 'start-failed', permissions: p };
    }
    trace.append('mark', '배경 구독 등록 완료. ' + (MAX_MS / 60000) + '분 뒤 자동 해제');
    say('측정을 시작합니다. 화면을 끄고 기다리세요');
    return { started: true, permissions: p };
  }

  async function stop() {
    session.clear();
    await location.stopBackground();
    trace.append('mark', '=== 중지 ===');
  }

  function enterBackground() {
    hiddenSince = now();
    trace.append('vis', '배경 진입');
  }

  // 복귀할 때 화면이 꺼진 구간에 들어온 건수를 센다. 이 숫자가 판정이다
  function returnToForeground() {
    if (hiddenSince == null) return null;
    const since = hiddenSince;
    const n = trace.read().filter(function (m) {
      return m.kind === 'bg' && m.at >= since;
    }).length;
    trace.append('vis', '복귀. 꺼진 동안 배경 위치 ' + n + '건');
    hiddenSince = null;
    return n;
  }

  // 배경 맥락이 깨어나지 않으면 스스로 해제할 기회가 없다. 화면이 한 번 더 본다
  async function reapStaleSubscription() {
    const on = await location.isBackgroundRunning();
    if (!on || !isExpired()) return false;
    trace.append('mark', '=== 만료된 구독을 발견해 해제합니다 ===');
    session.clear();
    await location.stopBackground();
    return true;
  }

  function view() {
    const rec = session.read();
    return {
      backgroundFixes: countKind('bg'),
      speechRequests: countMsg(SPEECH_MSG.request),
      speechDone: countMsg(SPEECH_MSG.done),
      errors: countKind('err'),
      leftMs: rec && rec.expiresAt ? rec.expiresAt - now() : null,
      trace: trace.read()
    };
  }

  return {
    onBackgroundFixes: onBackgroundFixes,
    start: start,
    stop: stop,
    enterBackground: enterBackground,
    returnToForeground: returnToForeground,
    reapStaleSubscription: reapStaleSubscription,
    isExpired: isExpired,
    view: view
  };
}
