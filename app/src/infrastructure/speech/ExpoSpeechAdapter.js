// 음성 출력 어댑터.
//
// 「호출했다」와 「끝까지 재생했다」는 다른 사실이다. 웹 프로토타입이 이 틈에 빠졌다.
// 재생 중인 것처럼 보였지만 실제로는 화면이 꺼지는 순간 멈춰 있었다.
//
// iOS 는 이 둘을 구분해서 알려준다. 자연 종료는 didFinish, 오디오 세션 중단은
// didCancel 이고 서로 배타적이다. expo-speech 가 각각 onDone 과 onStopped 로 올린다.
// 따라서 onDone 이 오면 합성기가 문장을 끝까지 읽었다는 뜻이다.
// 남는 변수는 기기 볼륨과 무음 스위치뿐이고, 그것은 소프트웨어가 볼 수 없다.
//
// 결과 하나당 콜백은 한 번만 온다. expo-speech 가 첫 종료 사건에서 등록을 지운다.

import * as Speech from 'expo-speech';

export const ExpoSpeechAdapter = {
  // onOutcome(결과, 상세). 결과는 started · done · stopped · error
  speak(text, onOutcome) {
    const report = onOutcome || function () {};
    Speech.speak(text, {
      language: 'ko-KR',
      // 기본값은 앱의 오디오 세션을 쓰는 것인데, 그 세션을 활성화한 적이 없어
      // 배경에서는 재생이 시작만 되고 끝나지 않았다. false 로 두면 시스템이
      // 음성 전용 세션을 만들어 중단과 겹침까지 스스로 관리한다
      useApplicationAudioSession: false,
      onStart: function () { report('started'); },
      onDone: function () { report('done'); },
      onStopped: function () { report('stopped'); },
      onError: function (e) { report('error', e && e.message ? e.message : String(e)); }
    });
  },

  stop() { Speech.stop(); }
};
