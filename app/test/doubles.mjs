// 시험 대역. 플랫폼과 저장을 메모리로 대신한다.
//
// 위치 대역은 플랫폼이 주는 모양 그대로 넣는다. 좌표만 뽑아 넘기면 운영 어댑터의
// 필드 옮기기가 시험되지 않아서, 단위를 잘못 읽은 결함이 모든 시험을 통과한다.

export function fakeClock(start) {
  let t = start || 1_700_000_000_000;
  return {
    now: function () { return t; },
    advance: function (ms) { t += ms; }
  };
}

export function fakeTrace() {
  let lines = [];
  return {
    append: function (kind, msg) { lines.push({ at: this._now(), kind, msg }); },
    read: function () { return lines.slice(); },
    clear: function () { lines = []; },
    _now: function () { return Date.now(); },
    bindClock: function (clock) { this._now = clock.now; }
  };
}

export function fakeSession() {
  let rec = null;
  return {
    start: function (maxMs, at, owner) { rec = { owner: owner || 'unknown', startedAt: at, expiresAt: at + maxMs }; return rec; },
    read: function () { return rec; },
    clear: function () { rec = null; }
  };
}

export function fakeLocation(opts) {
  const o = opts || {};
  const state = {
    running: false,
    startCalls: 0,
    stopCalls: 0,
    // 기기 위치 서비스. 권한과 다른 값이다. 권한을 줬는데 설정에서 끈 상태가 있다
    services: o.services !== false,
    // 위치를 몇 번 물었나. 권한이 없을 때 묻지 않는 것을 시험이 봐야 한다
    onceCalls: 0,
    // 권한을 몇 번 물었나. 두 번 이상 묻지 않는 것을 시험이 봐야 한다
    requestCalls: 0,
    permissions: o.permissions || { foreground: 'granted', background: 'granted' }
  };
  return {
    state,
    servicesEnabled: async function () { return state.services; },
    onceCalls: function () { return state.onceCalls; },
    requestPermissions: async function () {
      state.requestCalls++;
      if (o.grantOnAsk) state.permissions = { foreground: 'granted', background: 'granted' };
      return state.permissions;
    },
    getPermissions: async function () { return state.permissions; },
    startBackground: async function () {
      state.startCalls++;
      if (o.failStart) throw new Error('시험용 실패');
      state.running = true;
    },
    stopBackground: async function () { state.stopCalls++; state.running = false; },
    isBackgroundRunning: async function () { return state.running; },
    watchForeground: async function () { return { remove: function () {} }; },
    once: async function () {
      state.onceCalls++;
      // 운영 어댑터는 기다려도 안 오면 없음을 돌려준다. 지하가 그 상태다.
      // 던지는 쪽도 함께 둔다. 두 실패가 같은 결과로 보여야 한다
      if (o.noFix) return null;
      if (o.failOnce) throw new Error('위치를 받지 못했습니다');
      return platformFix(o.at || {});
    }
  };
}

// 연결 대역. 인터넷에 닿는지만 답한다
export function fakeNetwork(opts) {
  const o = opts || {};
  const state = { online: o.online !== false, listeners: [] };
  return {
    state,
    isOnline: async function () { return state.online; },
    subscribe: function (fn) {
      state.listeners.push(fn);
      return { remove: function () { state.listeners = state.listeners.filter(function (f) { return f !== fn; }); } };
    },
    // 시험이 상태를 바꿀 때 쓴다. 플랫폼이 통지하는 자리다
    change: function (online) {
      state.online = online;
      state.listeners.forEach(function (fn) { fn(online); });
    }
  };
}

// 음성 대역. 플랫폼이 어떤 결과를 돌려주는지 시험이 정한다.
//
// 결과를 주지 않는 것이 기본값이다. 실제 플랫폼도 콜백이 나중에 오거나 오지 않을 수 있고,
// 그 상태에서 세는 쪽이 무너지지 않아야 한다.
export function fakeSpeech(opts) {
  const o = opts || {};
  const said = [];
  return {
    said,
    speak: function (text, onOutcome) {
      said.push(text);
      if (!o.outcomes || !onOutcome) return;
      o.outcomes.forEach(function (out) { onOutcome(out, o.detail); });
    },
    stop: function () {}
  };
}

// 알림음 대역. 몇 번 났는지만 센다.
//
// 소리는 끝까지 재생됐는지 묻지 않는다. 0.3초짜리 한 소리라 그 물음에 값이 없고,
// 음성과 달리 판정에 쓰지도 않는다. 시험이 보는 것은 「조작마다 한 번 났는가」다.
export function fakeCue() {
  const state = { plays: 0 };
  return {
    state,
    play: function () { state.plays++; }
  };
}

// 플랫폼이 주는 모양. expo-location 의 LocationObject 와 같은 구조로 만든다
export function platformFix(spec) {
  const s = spec || {};
  return {
    coords: {
      latitude: s.lat != null ? s.lat : 37.5665,
      longitude: s.lon != null ? s.lon : 126.978,
      accuracy: 'acc' in s ? s.acc : 8,
      speed: 'speed' in s ? s.speed : 2.5,
      altitude: null, heading: null, altitudeAccuracy: null, speedAccuracy: null
    },
    timestamp: s.t != null ? s.t : 1_700_000_000_000
  };
}
