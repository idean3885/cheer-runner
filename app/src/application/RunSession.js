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

export function createRunSession(deps) {
  const location = deps.location;
  const speech = deps.speech;
  // 조작 확인은 소리 한 번으로 한다. 문장으로 되돌려 주면 말투가 걸려 듣기 싫어지고,
  // 정작 들어야 하는 지점 응원과 섞인다. 응원만 말로 남긴다
  const cue = deps.cue;
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

  function say(text) {
    if (!speech) return;
    speech.speak(text, function () {});
  }

  // 조작이 먹었다는 것만 알린다. 무엇이 먹었는지는 화면이 적는다
  function beep() {
    if (cue) cue.play();
  }

  async function start() {
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

  // 위치를 한 번 받아 둔다. 달리기 전에 지도를 띄우기 위한 것이고 거리에는 넣지 않는다
  async function locate() {
    try {
      const fix = await location.once();
      if (fix && fix.coords) {
        lastKnown = { lat: fix.coords.latitude, lon: fix.coords.longitude };
        onChange();
      }
    } catch (e) { /* 위치를 못 받으면 지도를 띄우지 않는다. 측정과 무관하다 */ }
    return lastKnown;
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
      // 앱이 종료된 뒤 배경에서만 살아 있던 달리기가다. 기록만 정리하고 구독은 끊는다.
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
        here: lastKnown, segments: [], hasCourse: course.path.length > 0
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
      hasCourse: course.path.length > 0
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
    view: view,
    course: function () { return course; }
  };
}
