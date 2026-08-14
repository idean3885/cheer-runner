// 알림음 포트의 운영 구현체.
//
// 재생기를 모듈 최상위에서 한 번 만든다. 누를 때마다 만들면 첫 소리가 늦게 나온다.
// 지점을 표시하는 순간에 0.5초 뒤 소리가 나면 사용자는 다른 것이 눌렸다고 읽는다.
//
// 무음 스위치를 켠 상태에서도 나게 둔다. 달릴 때 주머니에 넣고 다니는 기기라
// 무음 스위치가 켜져 있는 것이 보통이고, 그 상태에서 안 나면 표시가 됐는지 알 수 없다.
// 소프트웨어가 볼 수 없는 것은 볼륨 하나로 좁혀진다.

import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

// 배경에서도 소리가 나야 한다. 달리는 중에는 화면이 꺼져 있다
setAudioModeAsync({
  playsInSilentMode: true,
  shouldPlayInBackground: true,
  interruptionMode: 'mixWithOthers'
}).catch(function () { /* 오디오 세션을 못 잡으면 소리만 안 난다. 기록은 계속된다 */ });

const player = createAudioPlayer(require('../../../assets/cue.wav'));

export const ExpoCueAdapter = {
  play() {
    try {
      // 앞 소리가 나는 중일 수 있다. 되감지 않으면 끝난 자리에서 다시 눌러도 아무 소리가 없다
      player.seekTo(0);
      player.play();
    } catch (e) { /* 소리 실패가 조작을 되돌리지 않는다 */ }
  }
};
