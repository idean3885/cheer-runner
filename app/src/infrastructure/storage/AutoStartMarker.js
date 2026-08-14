// 화면을 누르지 않고 측정을 시작시키는 통로.
//
// 배경 수신 확인은 앱을 배경으로 보내고 다시 불러와야 하는데, 그 과정에 사람이
// 버튼을 누르면 자동화가 성립하지 않는다. 그래서 호스트가 파일 하나를 넣어두고
// 앱이 켜질 때 그것을 보고 스스로 시작한다.
//
// 표식은 읽는 즉시 지운다. 남으면 다음에 앱을 열 때도 저절로 시작된다.

import { File, Paths } from 'expo-file-system';

// 확인해야 하는 화면마다 표식을 둔다.
//
// 코스 화면은 시작을 걸지 않고 화면만 연다. 그 화면은 오른쪽 위 버튼으로 여는 자리인데
// 호스트에서 화면을 누를 방법이 없어서, 그림을 남기려면 열린 상태로 띄울 길이 필요하다
export const MARK = { diagnostic: 'auto-start', run: 'auto-run', course: 'auto-course' };

export const AutoStartMarker = {
  // 있으면 지우고 참을 돌려준다
  consume(name) {
    try {
      const f = new File(Paths.document, name || MARK.diagnostic);
      if (!f.exists) return false;
      f.write('');
      f.delete();
      return true;
    } catch (e) { return false; }
  }
};
