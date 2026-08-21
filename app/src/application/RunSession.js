// 달리기 세션. 도메인과 플랫폼 사이를 잇는다.
//
// 도메인은 위치가 어디서 오는지 모르고, 화면은 거리를 어떻게 쌓는지 모른다.
// 그 둘을 붙이는 일만 여기서 한다. 판단은 도메인에 있고 이 파일에는 없다.
//
// 프레임워크를 모른다. 리액트 컴포넌트 안에서는 기기 없이 시험할 수 없고,
// 기기가 필요하면 확인이 사람 손으로 돌아간다.

import * as Run from '../domain/Run.js';
import * as Course from '../domain/Course.js';
import * as Shelf from '../domain/Shelf.js';
import { windowPace, averagePace, segments } from '../domain/Track.js';
import { PACE_MIN_DIST, PACE_SHOW_MAX } from '../domain/constants.js';

export const OWNER = 'run';
export const MAX_MS = 4 * 60 * 60 * 1000;   // 달리기 상한 4시간. 잊고 둔 구독을 끊는다

// 시작할 수 없는 사유. 화면이 이것으로 배너 문구를 고른다.
//
// 사유를 하나로 묶지 않는 이유는 사용자가 할 일이 다르기 때문이다. 위치 서비스가 꺼진
// 것은 설정에서 켜면 되고, 지하는 나가야 하고, 인터넷은 신호가 오는 곳으로 가야 한다.
// 「시작할 수 없습니다」 하나로 적으면 무엇을 해야 하는지 알 수 없다.
export const BLOCK = {
  permission: 'location-permission',  // 권한이 거부됐다. 앱 안에서는 되돌릴 수 없다
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
  // 보관함. 지금 달리는 코스와 수명이 다르다
  let shelf = Shelf.createShelf(store ? store.readShelf() : {});
  let lastSpokeAt = 0;
  // 달리기를 시작하기 전에도 지도를 러너 자리에 맞춰야 한다. 그때 쓸 마지막으로 안 위치
  let lastKnown = null;
  // 마지막 달리기 요약. 종료 직후가 아니어도 화면이 기록을 보여줄 수 있어야 한다.
  // 파일은 한 번만 읽고 이후에는 종료가 갱신한다. 화면이 매초 view 를 부르기 때문이다
  let lastRun = store && store.readRuns ? (store.readRuns().slice(-1)[0] || null) : null;

  // 시작할 수 있는 상태인가. 확인하기 전에는 모르는 상태로 둔다.
  // 참으로 두고 시작하면 지하에서 눌렀을 때 시작이 실패하며 바로 풀리고,
  // 거짓으로 두면 앱을 켠 직후 몇 초 동안 이유 없이 막힌다
  // 권한은 셋으로 갈린다. 아직 안 물음 · 허용 · 거부.
  // 이 셋을 하나로 묶으면 「물어보면 되는 상태」와 「설정에 가야 하는 상태」가 섞이고,
  // 그러면 물어볼 수 있는데도 막아 버린다. 새 기기가 그 상태에 갇혔다
  let ready = { permission: null, fix: null, services: null, online: null };
  // 권한을 한 번은 스스로 묻는다. 버튼을 누를 때까지 기다리면 사용자는 왜 안 되는지 모른다.
  // 두 번 이상 묻지 않는 이유는 iOS 가 한 번만 대화상자를 띄우기 때문이다.
  // 거부된 뒤에는 아무리 불러도 조용히 거부가 돌아온다
  let askedPermission = false;
  // 막힌 사유가 바뀔 때만 기록한다. 10초마다 같은 줄을 남기면 기록이 쓸모를 잃는다
  let notedBlocks = null;

  function say(text) {
    if (!speech) return;
    speech.speak(text, function () {});
  }

  // 조작이 먹었다는 것만 알린다. 무엇이 먹었는지는 화면이 적는다
  function beep() {
    if (cue) cue.play();
  }

  // 권한을 셋 중 하나로 읽는다. 전경 권한이 기준이다. 배경 권한은 시작할 때 따로 본다.
  // 물어볼 수 없는 상태(어댑터가 없는 시험 대역)는 허용으로 본다
  async function readPermission() {
    if (!location.getPermissions) return 'granted';
    try {
      const p = await location.getPermissions();
      if (p.foreground === 'granted') return 'granted';
      if (p.foreground === 'denied') return 'denied';
      return 'undetermined';
    } catch (e) {
      return 'undetermined';   // 모르는 것을 거부로 보면 물어볼 길을 막는다
    }
  }

  // 달리는 중인가. 끝난 달리기는 화면에 남지만 달리는 중은 아니다.
  // 이 구분이 없어서 종료 뒤에 다시 시작할 길이 잠겼다
  function inProgress() {
    return !!(run && run.state === Run.STATE.running);
  }

  // 화면에 실어 보낼 시작 조건. 달리는 중에는 막지 않고 알리지도 않는다.
  // 이미 시작한 달리기를 화면 상태로 끊으면 기록이 사라지고, 달리면서 배너를 읽지도 않는다.
  // 끝난 뒤에는 다시 시작해야 하므로 조건을 그대로 돌려준다.
  //
  // 버튼이 눌리는지까지 여기서 정한다. 화면이 상태를 보고 스스로 판단하면 그 식은
  // 시험 밖에 남고, 실제로 그 자리에서 결함 둘이 났다. 화면은 참·거짓만 읽는다
  function startFields() {
    return {
      canStart: inProgress() ? false : canStart(),
      blocks: inProgress() ? [] : blocks(),
      // 지금 여기를 표시할 수 있는가. 달리는 중이어야 하고 위치를 한 건은 받았어야 한다.
      // 위치가 없으면 표시할 좌표가 없다
      canMark: inProgress() && !!(run.track && run.track.prev),
      // 종료할 수 있는가. 달리는 중일 때만
      canFinish: inProgress(),
      // 주 버튼(달리기·종료 토글)이 눌리는가. 화면이 상태를 보고 두 값을 고르면
      // 그 고르는 식이 다시 시험 밖으로 나간다. 그래서 한 값으로 준다.
      // 달리는 중에는 언제나 종료할 수 있고, 그 밖에는 시작 조건을 따른다
      canToggle: inProgress() ? true : canStart()
    };
  }

  // 못 하는 것들. 비어 있으면 시작할 수 있다.
  //
  // 위치는 셋 중 하나만 적는다. 서비스가 꺼져 있으면 위치가 안 오는 것은 당연한 결과이므로
  // 원인만 적는다. 결과까지 같이 적으면 사용자가 두 가지를 고쳐야 한다고 읽는다
  function blocks() {
    const out = [];
    // 아직 묻지 않았으면 막지 않는다. 막으면 물어볼 경로가 사라진다.
    // 달리기를 누르는 것이 곧 권한을 묻는 것이고, 그 뒤에 조건이 다시 선다
    if (ready.permission === 'undetermined') {
      if (ready.online === false) out.push(BLOCK.offline);
      return out;
    }
    if (ready.permission === 'denied') out.push(BLOCK.permission);
    else if (ready.services === false) out.push(BLOCK.service);
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
    if (inProgress()) return { canStart: false, blocks: [], running: true };

    ready.permission = await readPermission();

    // 아직 묻지 않은 상태면 여기서 묻는다. 앱을 열면 대화상자가 뜨는 것이 사용자가
    // 기대하는 순서고, 버튼이 잠긴 화면에서 이유를 읽게 만드는 것보다 짧다
    if (ready.permission === 'undetermined' && !askedPermission && location.requestPermissions) {
      askedPermission = true;
      trace.append('vis', '위치 권한을 묻습니다');
      try {
        const asked = await location.requestPermissions();
        trace.append('vis', '권한 응답. 전경 ' + asked.foreground + ' / 배경 ' + asked.background);
        ready.permission = asked.foreground === 'granted' ? 'granted'
          : (asked.foreground === 'denied' ? 'denied' : 'undetermined');
      } catch (e) {
        trace.append('err', '권한을 묻지 못했습니다: ' + e.message);
      }
    }

    ready.services = location.servicesEnabled ? await location.servicesEnabled() : true;
    ready.online = network ? await network.isOnline() : true;

    // 권한이 없으면 위치를 묻지 않는다. 호출이 바로 거부되고, 그 실패를 「위치가 안 온다」로
    // 읽으면 지하와 구분되지 않는다. 실제로 새 기기가 그렇게 잘못 안내됐다
    if (ready.permission !== 'granted' || ready.services === false) {
      ready.fix = null;
    } else {
      const fix = await locate();
      ready.fix = fix != null;
      if (!ready.fix) trace.append('err', '위치를 한 건도 받지 못했습니다');
    }
    noteBlocks();
    onChange();
    return { canStart: canStart(), blocks: blocks() };
  }

  // 막힌 사유를 기기 기록에 남긴다. 실측에서 화면을 볼 수 없으므로, 왜 시작하지 못했는지는
  // 이 줄로만 알 수 있다. 실제로 새 기기가 막혔을 때 기록에 사유가 없어 추측해야 했다
  function noteBlocks() {
    const now2 = blocks().join(',') || '통과';
    if (now2 === notedBlocks) return;
    notedBlocks = now2;
    trace.append('mark', '시작 조건: ' + now2);
  }

  // 연결이 바뀌었다는 통지. 물어보지 않고 받은 값을 그대로 쓴다
  function setOnline(online) {
    if (ready.online === online) return;
    ready.online = online;
    trace.append('vis', online ? '인터넷 연결됨' : '인터넷 끊김');
    noteBlocks();
    onChange();
  }

  // 통지를 세션이 직접 받는다. 조립 파일에서 이어 붙이면 시험이 그 경로를 지나지 못하고,
  // 화면에서 받으면 화면이 없는 동안 상태가 낡는다
  if (network && network.subscribe) network.subscribe(setOnline);

  // 시작해도 되는지 묻고, 필요하면 권한까지 받아 온다.
  // start 에서 떼어낸 이유는 그 함수가 「허락을 받는 일」과 「달리기를 세우는 일」을
  // 겸하고 있었기 때문이다. 관문이 그것을 잡았다
  async function clearToStart() {
    // 한 번도 확인하지 않았으면 여기서 확인한다. 화면이 버튼을 잠그므로 보통은 이미
    // 확인된 상태로 들어오지만, 확인하지 않은 것을 「된다」 로 읽고 시작하지는 않는다
    if (ready.fix === null || ready.services === null || ready.online === null) {
      await checkReadiness();
    }

    // 시작할 수 없는 상태에서는 시작을 시도하지 않는다. 시도하면 배경 구독을 걸다가
    // 실패하고, 화면에는 눌렀다가 바로 풀린 것으로 보인다
    if (!canStart()) {
      trace.append('mark', '시작 조건이 아직 아닙니다: ' + blocks().join(','));
      return { ok: false, result: { started: false, reason: 'not-ready', blocks: blocks() } };
    }

    const p = await location.requestPermissions();
    // 물어본 결과를 조건에 반영한다. 반영하지 않으면 거부된 뒤에도 버튼이 살아 있어
    // 누를 때마다 같은 실패를 반복한다
    ready.permission = p.foreground === 'granted' ? 'granted'
      : (p.foreground === 'denied' ? 'denied' : 'undetermined');
    if (p.background !== 'granted') {
      onChange();
      return { ok: false, result: { started: false, reason: 'background-permission', permissions: p } };
    }
    return { ok: true, permissions: p };
  }

  async function start() {
    const cleared = await clearToStart();
    if (!cleared.ok) return cleared.result;
    const p = cleared.permissions;

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

  // 메인 계기판은 평균 페이스다. 지점 행위가 값을 재설정하지 않는다 (ADR 0011).
  // 표본이 모자라면 값을 내지 않는다. 제자리에서 잡음 몇 미터를 긴 시간으로 나누면
  // 사람이 낼 수 없는 페이스가 나오고, 그것을 화면에 그리면 고장으로 보인다
  function paceToShow(track, at) {
    if (track.dist < PACE_MIN_DIST) return null;
    return capPace(averagePace(track, at));
  }

  // 정지 잡음이 만드는 세 자리 분 페이스는 값이 아니라 소음이다
  function capPace(sec) {
    return sec != null && sec <= PACE_SHOW_MAX ? sec : null;
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
    // 만든 자리가 곧 지나는 자리다. 구간을 닫아 기록 달리기에도 지점 사이 페이스를 남긴다
    const split = Run.passSpot(run, course.spots.length - 1);
    if (store) store.writeCourse(course);
    trace.append('mark', '여기 표시. 지점 ' + course.spots.length + '곳'
      + (split ? ' 구간 ' + Math.round(split.segDist) + 'm' : ''));
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

  /* ── 보관함 ─────────────────────────────────────────────────── */

  // 지금 코스를 이름 붙여 저장한다. 칸이 차면 거절하고 사유를 낸다.
  // 화면은 그 사유로 코스 목록을 열어 하나를 지우도록 안내한다
  function saveCourse(name) {
    if (!course.path.length && !course.spots.length) {
      return { ok: false, reason: 'empty-course' };
    }
    const r = Shelf.save(shelf, course, name, now());
    if (!r.ok) {
      trace.append('mark', '보관함이 차서 저장을 거절했습니다');
      return r;
    }
    // 저장한 코스와 지금 달리는 코스가 같은 것을 가리키게 한다. 이름을 붙인 뒤에
    // 지점을 하나 더 찍으면 그 자리를 갱신해야 하고, 그러려면 식별자가 같아야 한다
    const oldId = course.id;
    course.id = r.course.id;
    course.name = r.course.name;
    // 저장된 코스는 자기 기록을 항상 갖는다. 식별자가 바뀌면 기록을 함께 이관한다 (ADR 0012)
    if (store && store.relinkRuns) store.relinkRuns(oldId, course.id, course.name);
    if (lastRun && (lastRun.courseId === oldId || lastRun.courseId === course.id)) {
      lastRun = Object.assign({}, lastRun, { courseId: course.id, courseName: course.name });
    }
    const written = store ? store.writeShelf(shelf) : true;
    if (store) store.writeCourse(course);
    if (!written) {
      trace.append('err', '보관함 저장에 실패했습니다');
      onChange();
      return { ok: false, reason: 'write-failed' };
    }
    trace.append('mark', '코스를 저장했습니다: ' + r.course.name);
    onChange();
    return r;
  }

  // 보관함에서 꺼내 지금 코스로 삼는다. 달리는 중에는 바꾸지 않는다.
  // 달리는 중에 코스를 갈면 이미 지난 지점과 새 지점의 순서가 어긋난다
  function loadCourse(id) {
    if (run && run.state === Run.STATE.running) {
      return { ok: false, reason: 'running' };
    }
    const found = Shelf.find(shelf, id);
    if (!found) return { ok: false, reason: 'not-found' };

    // 꺼낼 때도 복사한다. 지금 코스를 고치는 것이 보관함을 고치는 일이 되면
    // 불러온 코스에서 지점 하나 지우는 것만으로 저장해 둔 것이 사라진다
    course = Course.createCourse({
      id: found.id === Shelf.SLOT.last ? 'course' : found.id,
      name: found.name,
      path: found.path.map(function (p) { return { lat: p.lat, lon: p.lon }; }),
      spots: found.spots.map(function (p) { return { id: p.id, lat: p.lat, lon: p.lon, rad: p.rad }; })
    });
    run = null;   // 끝난 달리기 화면을 지운다. 다른 코스의 도달 기록이 남으면 섞인다
    if (store) store.writeCourse(course);
    trace.append('mark', '코스를 불러왔습니다: ' + (course.name || '이름 없음')
      + ' 지점 ' + course.spots.length + '곳');
    onChange();
    return { ok: true, course: course };
  }

  function removeCourse(id) {
    const ok = Shelf.remove(shelf, id);
    if (ok && store) store.writeShelf(shelf);
    if (ok) trace.append('mark', '보관함에서 코스를 지웠습니다');
    onChange();
    return ok;
  }

  // 코스 없이 시작한다. 지점도 기준 경로도 없는 상태로 되돌린다
  function clearCourse() {
    if (run && run.state === Run.STATE.running) return false;
    course = Course.createCourse({});
    run = null;
    if (store) store.writeCourse(course);
    onChange();
    return true;
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
      // 마지막 달리기는 항상 보관함에 남는다. 저장을 누르지 않아도 남아야 다음에
      // 그 코스를 다시 달릴 수 있다. 2회차가 이 앱의 값이고, 1회차 뒤 사용자가
      // 저장을 눌러야 한다면 그 값이 사용자의 기억에 달린다
      Shelf.keepLast(shelf, course, at);
      // 어느 코스로 달렸고 지점이 어디였는지를 요약에 남긴다. 코스는 뒤에 바뀔 수 있으므로
      // 기록은 그때의 지점을 제 것으로 갖는다. 기록 상세가 이걸로 핀을 그린다
      const rec = Object.assign({
        courseId: course.id,
        courseName: course.name || '',
        spots: course.spots.map(function (p) { return { lat: p.lat, lon: p.lon, rad: p.rad }; })
      }, done.summary);
      if (store) {
        store.writeCourse(course);
        store.writeShelf(shelf);
        store.appendRun(rec);
      }
      lastRun = rec;
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

  // 보관함 상태. 화면이 목록을 그리는 데 필요한 것만 담는다.
  // 경로 점 2,500개를 그대로 올리면 목록을 그릴 때마다 그것을 들고 다닌다
  function shelfView() {
    return Shelf.entries(shelf).map(function (e) {
      return {
        id: e.course.id,
        // 기록을 찾을 코스 식별자. 마지막 칸은 칸 식별자(last)와 다르다.
        // 이전 데이터에는 없을 수 있어 칸 식별자로 받친다
        origin: e.course.origin || e.course.id,
        slot: e.slot,
        name: e.course.name || '',
        savedAt: e.course.savedAt || null,
        spots: (e.course.spots || []).length,
        dist: Shelf.pathLength(e.course),
        current: e.course.id === course.id
      };
    });
  }

  // 기록 전체. 최근 것이 앞이다. 기록 화면이 목록을 그리는 데 쓴다
  function records() {
    if (!store || !store.readRuns) return [];
    return store.readRuns().slice().reverse();
  }

  // 이 코스로 달린 기록. 최근 것이 앞이다. 식별자가 우선이고,
  // 저장하며 식별자가 바뀐 경우를 이름이 받친다
  function courseRuns(id, name) {
    if (!store || !store.readRuns) return [];
    return store.readRuns().filter(function (r) {
      return r.courseId === id || (!!name && r.courseName === name);
    }).reverse();
  }

  // 지금 자리에서 시작할 만한 코스. 고르는 것은 사용자다
  function suggestView() {
    if (!lastKnown) return [];
    return Shelf.nearStart(shelf, lastKnown.lat, lastKnown.lon).map(function (e) {
      return {
        id: e.course.id, slot: e.slot, name: e.course.name || '',
        spots: (e.course.spots || []).length, dist: Shelf.pathLength(e.course),
        away: e.distance, current: e.course.id === course.id
      };
    });
  }

  // 달리기 전 화면. 값은 0 이고 대신 시작 조건과 코스 목록이 실린다.
  // 달리는 중 화면과 따로 둔 이유는 두 화면이 서로 다른 것을 묻기 때문이다.
  // 하나로 두면 한 함수가 「아직 안 달림」과 「달리는 중」을 겸한다
  function readyView() {
    return {
      state: 'ready', dist: 0, ms: 0, pace: null, wPace: null, seg: null, splits: [],
      target: null, targetDist: null,
      arrivals: [], spots: course.spots.slice(), fixCount: 0, gapMax: 0,
      here: lastKnown, segments: [], hasCourse: course.path.length > 0,
      coursePath: course.path.slice(), lastRun: lastRun,
      courseName: course.name || '', shelf: shelfView(), shelfFull: Shelf.isFull(shelf),
      suggested: suggestView(),
      ...startFields()
    };
  }

  function view() {
    if (!run) return readyView();
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
      // 현재(창) 페이스는 보조다. 정지 잡음이 만드는 사람 밖 값은 내지 않는다
      wPace: t ? capPace(windowPace(t)) : null,
      seg: Run.currentSegment(run, at),
      splits: run.splits.slice(),
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
      // 기준 경로. 따라가기 달리기에서 실제 궤적과 견주어 보인다
      coursePath: course.path.slice(), lastRun: lastRun,
      courseName: course.name || '', shelf: shelfView(), shelfFull: Shelf.isFull(shelf),
      // 달리는 중에는 추천하지 않는다. 코스를 갈 수 없는 상태에서 권하면 누를 곳이 없다
      suggested: inProgress() ? [] : suggestView(),
      ...startFields()
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
    saveCourse: saveCourse,
    loadCourse: loadCourse,
    removeCourse: removeCourse,
    clearCourse: clearCourse,
    courseRuns: courseRuns,
    records: records,
    view: view,
    course: function () { return course; }
  };
}
