// 주행 화면. 아직 만들지 않는다.
//
// 진단 화면이 배경 위치와 소리를 통과하기 전에는 이 화면을 만들지 않는다.
// 순서를 뒤집으면 여기 쌓은 것 전부가 배경 위치 하나에 걸린다.
//
// 통과하면 DOMAIN.md 의 계약대로 만든다. 거리·페이스·구간 템포·응원 순이다.

import { StyleSheet, Text, View } from 'react-native';

export function RunScreen() {
  return (
    <View style={s.root}>
      <Text style={s.title}>치어러너</Text>
      <Text style={s.body}>
        배경 위치와 소리를 먼저 확인합니다. 진단 화면에서 «꺼진 동안» 이 0 이 아니어야
        이 화면을 만듭니다.
      </Text>
      <Text style={s.note}>근거: docs/MVP.md 확인 0 단계</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, justifyContent: 'center' },
  title: { fontSize: 30, fontWeight: '800', marginBottom: 12 },
  body: { fontSize: 15, lineHeight: 23, color: '#334' },
  note: { fontSize: 12, color: '#889', marginTop: 16 }
});
