// 측정 세션 기록.
//
// 배경 위치 구독은 앱을 종료해도 등록이 남는다. 해제를 부르기 전까지 살아 있고
// iOS 가 위치 이벤트마다 앱을 다시 깨운다. 사용자가 중지를 누르지 않으면 끝나지 않는다.
//
// 그래서 세션에 만료 시각을 둔다. 배경 맥락이 깨어날 때마다 이 값을 확인하고
// 지났으면 스스로 구독을 해제한다. 화면이 없어도 끝난다.

import { File, Paths } from 'expo-file-system';

const NAME = 'session.json';

function handle() { return new File(Paths.document, NAME); }

export const SessionStore = {
  // owner 는 이 구독을 건 주체다. 배경 맥락이 새로 만들어지면 누가 걸었는지 알 수 없고,
  // 진단과 주행이 같은 구독을 나눠 쓰므로 잘못된 쪽이 받으면 남의 구독을 해제한다
  start(maxMs, at, owner) {
    const t = at || Date.now();
    const rec = { owner: owner || 'unknown', startedAt: t, expiresAt: t + maxMs };
    try {
      const f = handle();
      if (!f.exists) f.create();
      f.write(JSON.stringify(rec));
    } catch (e) {}
    return rec;
  },

  read() {
    try {
      const f = handle();
      if (!f.exists) return null;
      return JSON.parse(f.textSync());
    } catch (e) { return null; }
  },

  clear() {
    try { const f = handle(); if (f.exists) f.write(''); } catch (e) {}
  },

  // 만료 여부. 기록이 없으면 만료로 본다.
  // 기록 없이 구독만 남아 있는 상태가 가장 위험하다. 아무도 끄지 않는다
  isExpired() {
    const r = this.read();
    if (!r || !r.expiresAt) return true;
    return Date.now() > r.expiresAt;
  }
};
