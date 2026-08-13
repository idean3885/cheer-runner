// 배경 맥락과 화면 맥락 사이의 유일한 통로.
//
// iOS 가 앱을 종료하고 위치 이벤트로 다시 깨우면 자바스크립트 맥락이 새로 만들어진다.
// 그러면 메모리에 쌓은 기록은 사라지고, 배경에서 위치를 받았어도 화면에는 0으로 보인다.
// 1차 측정이 이 결함으로 판정 불가로 끝났다. 그래서 파일에 즉시 적는다.
//
// 기록 실패가 측정을 멈추게 하지 않는다. 삼키고 계속한다.
//
// 덧붙이기는 반드시 append 옵션으로 한다. 전체를 읽어 전체를 다시 쓰면 짧은 간격으로
// 연달아 적을 때 앞 줄이 사라진다. 실제로 음성 결과 줄을 잃어서 「재생 완료 0건」 으로
// 잘못 판정했다. 기록이 증거인 시험에서 기록 유실은 측정 실패와 구분되지 않는다.

import { File, Paths } from 'expo-file-system';

const NAME = 'trace.jsonl';

function handle() { return new File(Paths.document, NAME); }

export const FileTrace = {
  append(kind, msg) {
    const line = JSON.stringify({ at: Date.now(), kind: kind, msg: msg }) + '\n';
    try {
      const f = handle();
      if (!f.exists) f.create();
      f.write(line, { append: true });
    } catch (e) {}
  },

  read() {
    try {
      const f = handle();
      if (!f.exists) return [];
      return f.textSync().split('\n')
        .filter(function (s) { return s.length > 2; })
        .map(function (s) { try { return JSON.parse(s); } catch (e) { return null; } })
        .filter(Boolean);
    } catch (e) { return []; }
  },

  clear() {
    try { const f = handle(); if (f.exists) f.write(''); } catch (e) {}
  }
};
