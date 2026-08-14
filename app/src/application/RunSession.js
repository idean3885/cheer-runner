// 달리기 세션. 도메인과 플랫폼 사이를 잇는다.
//
// 도메인은 위치가 어디서 오는지 모르고, 화면은 거리를 어떻게 쌓는지 모른다.
// 그 둘을 붙이는 일만 여기서 한다. 판단은 도메인에 있고 이 파일에는 없다.
//
// 프레임워크를 모른다. 리액트 컴포넌트 안에서는 기기 없이 시험할 수 없고,
// 기기가 필요하면 확인이 사람 손으로 돌아간다.

import * as Run from '../domain/Run.js';
import * as Course from '../domain/Course.js';
import { windowPace, averagePace, segments } from '../domain/Track.js';
import { PACE_MIN_DIST } from '../domain/constants.js';

export const OWNER = 'run';
export const MAX_MS = 4 * 60 * 60 * 1000;   // 달리기 상한 4시간. 잊고 둔 구독을 끊는다

// 시작할 수 없는 사유. 화면이 이것으로 배너 문구를 고른다.
//
// 사유를 하나로 묶지 않는 이유는 사용자가 할 일이 다르기 때문이다. 위치 서비스가 꺼진
// 것은 설정에서 켜면 되고, 지하는 나가야 하고, 인터넷은 신호가 오는 곳으로 가야 한다.
// 「시작할 수 없습니다」 하나로 적으면 무엇을 해야 하는지 알 수 없다.
export const BLOCK = {
  service: 'location-service',   // 기기의 위치 서비스가 꺼졌다
  waiting: 'locating',           // 켜져 있고 아직 첫 위치를 기다린다
  fix: 'no-fix',                 // 기다렸는데 오지 않는다. 지하·실내다
  offline: 'offline'             // 지도를 그릴 수 없다
};

export function createRunSession(deps) {
  const location = deps.location;
  const speech = deps.speech;
  // 조작 확인은 소리 한 번으로 한다. 문장으로 되돌려 주면 말투가 걸려 듣기 싫어지고,
  // 정작 들어야 하는 지점 응원과 섞인다. 응원만 말로 남긴다
  const cue = deps.cue;
  // 인터넷은 지도 타일 때문에 본다. 거리와 응원은 끊겨도 돈다
  const network = deps.network;
  const session = deps.session;
  const store = deps.store;              // 코스와 달리기 기록 저장
  // 기록은 실측용이다. 러너가 돌아온 뒤 무엇이 일어났는지 읽을 수 있어야 하고,
  // 그것이 없으면 배경에서 벌어진 일은 아무도 모른다
  const trace = deps.trace || { append: function () {} };
  const now = deps.now || function () { return Date.now(); };
  const onChange = deps.onChange || function () {};

  let run = null;
  let course = Course.createCourse(store ? store.readCourse() : {});
  let lastSpokeAt = 0;
  // 달리기를 시작하기 전에도 지도를 러너 자리에 맞춰야 한다. 그때 쓸 마지막으로 안 위치
  let lastKnown = null;

  // 시작할 수 있는 상태인가. 확인하기 전에는 모르는 상태로 둔다.
  // 참으로 두고 시작하면 지하에서 눌렀을 때 시작이 실패하며 바로 풀리고,
  // 거짓으로 두면 앱을 켠 직후 몇 초 동안 이유 없이 막힌다
  let ready = { fix: null, services: null, online: null };

  function say(text) {
    if (!speech) return;
    speech.speak(text, function () {});
  }

  // 조작이 먹었다는 것만 알린다. 무엇이 먹었는지는 화면이 적는다
  function beep() {
    if (cue) cue.play();
  }

  // 못 하는 것들. 비어 있으면 시작할 수 있다.
  //
  // 위치는 셋 중 하나만 적는다. 서비스가 꺼져 있으면 위치가 안 오는 것은 당연한 결과이므로
  // 원인만 적는다. 결과까지 같이 적으면 사용자가 두 가지를 고쳐야 한다고 읽는다
  function blocks() {
    const out = [];
    if (ready.services === false) out.push(BLOCK.service);
    else if (ready.fix === null) out.push(BLOCK.waiting);
    else if (ready.fix === false) out.push(BLOCK.fix);
    if (ready.online === false) out.push(BLOCK.offline);
    return out;
  }

  // 확인하지 않은 것을 「된다」 로 읽지 않는다. 위치는 실제로 한 건 받아야 참이 된다
  function canStart() {
    return blocks().length === 0;
  }

  // 시작 조건을 다시 본다. 화면이 켜질 때, 앞으로 돌아올 때, 연결이 바뀔 때 부른다.
  //
  // 달리는 중에는 아무것도 묻지 않는다. 위치는 이미 배경 구독으로 들어오고 있고,
  // 그 와중에 한 건을 따로 달라고 하면 수신에 끼어든다. 그리고 달리는 중에 끊겼다고
  // 멈추지 않으므로 물어서 얻을 것이 없다
  async function checkReadiness() {
    if (run && run.state === Run.STATE.running) return { canStart: false, blocks: [], running: true };

    ready.services = location.servicesEnabled ? await location.servicesEnabled() : true;
    ready.online = network ? await network.isOnline() : true;

    if (ready.services === false) {
      // 꺼진 서비스에 위치를 달라고 하면 8초를 기다리고 못 받는다. 물을 필요가 없다
      ready.fix = null;
    } else {
      const fix = await locate();
      ready.fix = fix != null;
      if (!ready.fix) trace.append('err', '위치를 한 건도 받지 못했습니다');
    }
    onChange();
    return { canStart: canStart(), blocks: blocks() };
  }

  // 연결이 바뀌었다는 통지. 물어보지 않고 받은 값을 그대로 쓴다
  function setOnline(online) {
    if (ready.online === online) return;
    ready.online = online;
    trace.append('vis', online ? '인터넷 연결됨' : '인터넷 끊김');
    onChange();
  }

  // 통지를 세션이 직접 받는다. 조립 파일에서 이어 붙이면 시험이 그 경로를 지나지 못하고,
  // 화면에서 받으면 화면이 없는 동안 상태가 낡는다
  if (network && network.subscribe) network.subscribe(setOnline);

  async function start() {
    // 한 번도 확인하지 않았으면 여기서 확인한다. 화면이 버튼을 잠그므로 보통은 이미
    // 확인된 상태로 들어오지만, 확인하지 않은 것을 「된다」 로 읽고 시작하지는 않는다
    if (ready.fix === null || ready.services === null || ready.online === null) {
      await checkReadiness();
    }

    // 시작할 수 없는 상태에서는 시작을 시도하지 않는다. 시도하면 배경 구독을 걸다가
    // 실패하고, 화면에는 눌렀다가 바로 풀린 것으로 보인다. 그 자리에서 사용자는
    // 앱이 고장났다고 읽는다
    if (!canStart()) {
      trace.append('mark', '시작 조건이 아직 아닙니다: ' + blocks().join(','));
      return { started: false, reason: 'not-ready', blocks: blocks() };
    }

    const p = await location.requestPermissions();
    if (p.background !== 'granted') {
      return { started: false, reason: 'background-permission', permissions: p };
    }

    run = Run.createRun({ spots: course.spots.slice() });
    Run.start(run, now());
    session.start(MAX_MS, now(), OWNER);

    try {
      await location.startBackground();
    } catch (e) {
      run = null;
      session.clear();
      return { started: false, reason: 'start-failed', error: e.message };
    }
    trace.append('mark', '=== 달리기 시작 ===');
    beep();
    onChange();
    return { started: true, permissions: p };
  }

  // 배경 맥락이 깨어날 때마다 부른다. 화면이 없어도 돈다
  function onFixes(payload) {
    if (payload && payload.error) return Promise.resolve();
    if (!run) return Promise.resolve();

    (payload.fixes || []).forEach(function (fix) {
      const r = Run.accept(run, fix);
      if (!r.accepted) { trace.append('err', '위치를 받지 못했습니다: ' + r.reason); return; }
      const c = fix.coords;
      // 위치가 들어오는 중이라는 사실을 여기서 안다. 다음 달리기를 시작할 때
      // 이 값이 있으면 8초를 다시 기다리지 않는다
      ready.fix = true;
      lastKnown = { lat: c.latitude, lon: c.longitude };
      trace.append('bg', '±' + Math.round(c.accuracy) + 'm +' + Math.round(r.added)
        + 'm 누적 ' + Math.round(run.track.dist) + 'm' + (r.gap ? ' [결손]' : ''));
      if (r.arrival) announce(r.arrival);
    });

    // 러너가 종료를 누르지 않고 멈춰 있으면 스스로 끝낸다
    if (Run.isIdle(run, now())) {
      return Promise.resolve(finish('idle'));
    }
    onChange();
    return Promise.resolve();
  }

  // 응원 문구는 여기서 만든다. 무엇을 말할지는 표현이고 도메인의 일이 아니다
  function announce(arrival) {
    const n = arrival.idx + 1;
    const pace = arrival.pace != null ? paceWords(arrival.pace) : null;
    const parts = [n + '번 지점입니다'];
    if (pace) parts.push('구간 ' + pace);
    parts.push(arrival.isLast ? '마지막 지점입니다. 끝까지 갑니다' : '잘하고 있습니다');
    lastSpokeAt = now();
    trace.append('mark', n + '번 지점 도착. 구간 ' + Math.round(arrival.segDist) + 'm');
    say(parts.join('. '));
  }

  // 표본이 모자라면 값을 내지 않는다. 제자리에서 잡음 몇 미터를 긴 시간으로 나누면
  // 사람이 낼 수 없는 페이스가 나오고, 그것을 화면에 그리면 고장으로 보인다
  function paceToShow(track, at) {
    const w = windowPace(track);
    if (w != null) return w;
    if (track.dist < PACE_MIN_DIST) return null;
    return averagePace(track, at);
  }

  function paceWords(sec) {
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return m + '분 ' + (s < 10 ? '0' : '') + s + '초';
  }

  // 지금 여기를 응원받고 싶은 자리로 표시한다.
  // 이번 달리기에는 울리지 않는다. 방금 지난 자리라 바로 도달로 걸린다
  function markHere() {
    const last = run && run.track ? run.track.prev : null;
    if (!last) return { marked: false, reason: 'no-position' };
    const spot = Course.markHere(course, last.lat, last.lon);
    if (store) store.writeCourse(course);
    trace.append('mark', '여기 표시. 지점 ' + course.spots.length + '곳');
    beep();
    onChange();
    return { marked: true, spot: spot };
  }

  // 지도에서 찍어 지정한다. 코스를 벗어나면 거부한다.
  // 여기 표시와 달리 이번 달리기에도 목표가 된다. 아직 지나지 않은 자리일 수 있다
  function pin(lat, lon) {
    const r = Course.pin(course, lat, lon);
    if (!r.ok) {
      trace.append('mark', r.reason === 'no-course'
        ? '코스가 없어 지도 지정을 거절했습니다'
        : '코스에서 ' + Math.round(r.distance) + 'm 벗어나 지정을 거절했습니다');
      onChange();
      return r;
    }
    if (store) store.writeCourse(course);
    if (run) Run.addSpot(run, r.spot);
    trace.append('mark', '지도에서 지점 지정. 지점 ' + course.spots.length + '곳');
    onChange();
    return r;
  }

  // 위치를 한 번 받아 둔다. 달리기 전에 지도를 띄우기 위한 것이고 거리에는 넣지 않는다.
  //
  // 이번에 받은 것만 돌려준다. 지난번 값을 돌려주면 지금 못 받는 상태가 받은 것으로 읽히고,
  // 그 상태로 시작을 열어 주면 지하에서 눌렀을 때와 같은 일이 다시 난다
  async function locate() {
    let here = null;
    try {
      const fix = await location.once();
      if (fix && fix.coords) {
        here = { lat: fix.coords.latitude, lon: fix.coords.longitude };
        lastKnown = here;
        onChange();
      }
    } catch (e) { /* 위치를 못 받으면 지도를 띄우지 않는다. 측정과 무관하다 */ }
    return here;
  }

  function removeSpot(id) {
    const ok = Course.remove(course, id);
    if (ok && store) store.writeCourse(course);
    onChange();
    return ok;
  }

  async function finish(reason) {
    const at = now();
    const done = run ? Run.finish(run, at) : { finished: false };
    session.clear();
    await location.stopBackground();
    if (speech) speech.stop();

    if (done.finished) {
      // 이번 달리기의 경로를 코스의 기준 경로로 남긴다. 다음 달리기에서 이탈 판정에 쓴다
      course.path = run.track ? run.track.points.map(function (p) {
        return { lat: p.lat, lon: p.lon };
      }) : course.path;
      if (store) {
        store.writeCourse(course);
        store.appendRun(done.summary);
      }
      trace.append('mark', '=== 달리기 종료 (' + reason + '). '
        + (done.summary.dist / 1000).toFixed(2) + 'km, 위치 ' + done.summary.fixCount + '건 ===');
      // 스스로 끝난 것은 말로 알린다. 누르지 않았는데 끝났으므로 소리만 나면
      // 러너가 무엇이 끝났는지 모른 채로 계속 달린다
      if (reason === 'idle') say('움직임이 없어 달리기를 마칩니다');
      else beep();
    }
    onChange();
    return done;
  }

  // 남은 구독 정리. 달리기 기록이 없는데 구독만 살아 있으면 끊는다
  async function reapStale() {
    const on = await location.isBackgroundRunning();
    if (!on) return false;
    const rec = session.read();
    if (rec && rec.owner === OWNER && !run && now() <= rec.expiresAt) {
      // 앱이 종료된 뒤 배경에서만 살아 있던 달리기다. 기록만 정리하고 구독은 끊는다.
      // 궤적이 메모리에만 있었으므로 이어 붙일 수 없다
      session.clear();
      await location.stopBackground();
      return true;
    }
    return false;
  }

  function view() {
    if (!run) {
      return {
        state: 'ready', dist: 0, ms: 0, pace: null, target: null, targetDist: null,
        arrivals: [], spots: course.spots.slice(), fixCount: 0, gapMax: 0,
        here: lastKnown, segments: [], hasCourse: course.path.length > 0,
        canStart: canStart(), blocks: blocks()
      };
    }
    // 끝난 달리기는 끝난 시각으로 본다. 흐르는 시각을 넣으면 종료 뒤에도 시간이 늘고
    // 거리는 그대로이므로 페이스가 함께 무너진다
    const at = run.state === Run.STATE.finished && run.finishedAt != null
      ? run.finishedAt : now();
    const t = run.track;
    const target = Run.currentTarget(run);
    const here = t ? t.prev : null;
    return {
      state: run.state,
      dist: t ? t.dist : 0,
      ms: run.startedAt ? at - run.startedAt : 0,
      pace: t ? paceToShow(t, at) : null,
      target: target,
      targetDist: target && here ? Run.distanceToTarget(run, here.lat, here.lon) : null,
      arrivals: run.arrivals.slice(),
      spots: course.spots.slice(),
      fixCount: run.fixCount,
      gapMax: run.gapMax,
      lastSpokeAt: lastSpokeAt,
      here: here ? { lat: here.lat, lon: here.lon } : lastKnown,
      // 결손으로 끊긴 조각들. 이어 그리면 지나지 않은 길이 경로로 보인다
      segments: t ? segments(t) : [],
      hasCourse: course.path.length > 0,
      // 달리는 중에는 막지 않는다. 이미 시작한 달리기를 화면 상태로 끊으면 기록이 사라진다
      canStart: false, blocks: []
    };
  }

  return {
    start: start,
    finish: finish,
    onFixes: onFixes,
    markHere: markHere,
    pin: pin,
    locate: locate,
    removeSpot: removeSpot,
    reapStale: reapStale,
    checkReadiness: checkReadiness,
    setOnline: setOnline,
    view: view,
    course: function () { return course; }
  };
}
