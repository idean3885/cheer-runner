// 조립 자리. 어느 구현체를 어느 포트에 끼우는지 여기서만 정한다.
//
// 모듈 최상위에서 조립하는 이유는 배경 맥락이다. 앱이 종료된 뒤 위치 이벤트로
// 다시 깨어나면 화면은 없고 이 파일만 다시 실행된다. 조립이 컴포넌트 안에 있으면
// 그 맥락에는 아무것도 없어 위치가 버려진다.
//
// 배경 구독은 하나이고 쓰는 쪽은 둘이다. 분배는 BackgroundRouter 가 파일에 적힌
// 주인을 보고 정한다. 여기서 정하면 배경 맥락에서 그 판단이 사라진다.

import { ExpoLocationAdapter, setSink } from '../infrastructure/location/ExpoLocationAdapter';
import { ExpoSpeechAdapter } from '../infrastructure/speech/ExpoSpeechAdapter';
import { ExpoCueAdapter } from '../infrastructure/sound/ExpoCueAdapter';
import { ExpoNetworkAdapter } from '../infrastructure/network/ExpoNetworkAdapter';
import { FileTrace } from '../infrastructure/storage/FileTrace';
import { SessionStore } from '../infrastructure/storage/SessionStore';
import { CourseStore } from '../infrastructure/storage/CourseStore';
import { createDiagnosticSession, OWNER as DIAGNOSTIC } from './DiagnosticSession';
import { createRunSession, OWNER as RUN } from './RunSession';
import { createBackgroundRouter } from './BackgroundRouter';

// 화면 갱신 통지. 세션은 화면을 모르므로 부를 대상만 모아둔다
const listeners = new Set();
function notify() { listeners.forEach(function (fn) { fn(); }); }

const diagnostic = createDiagnosticSession({
  location: ExpoLocationAdapter,
  trace: FileTrace,
  session: SessionStore,
  speak: ExpoSpeechAdapter.speak
});

const run = createRunSession({
  location: ExpoLocationAdapter,
  speech: ExpoSpeechAdapter,
  cue: ExpoCueAdapter,
  network: ExpoNetworkAdapter,
  session: SessionStore,
  store: CourseStore,
  trace: FileTrace,
  onChange: notify
});

const router = createBackgroundRouter({
  session: SessionStore,
  location: ExpoLocationAdapter,
  trace: FileTrace
});
router.register(DIAGNOSTIC, function (payload) { return diagnostic.onBackgroundFixes(payload); });
router.register(RUN, function (payload) { return run.onFixes(payload); });
setSink(function (payload) { return router.route(payload); });

export const diagnosticSession = diagnostic;

export const runSession = Object.assign({}, run, {
  onChange: function (fn) {
    listeners.add(fn);
    return function () { listeners.delete(fn); };
  }
});
