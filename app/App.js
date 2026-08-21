// 조립 지점. 화면을 고르는 것 외에는 아무것도 하지 않는다.
//
// 사람이 보는 화면은 달리기 하나다. 진단 화면은 남아 있지만 눌러서 열 길이 없다.
// 기기 시험이 넣는 표식 파일로만 열리고, 실측 뒤에는 사람이 화면을 보는 대신
// 기기가 남긴 기록 파일을 읽는 쪽이 본다.
//
// 진단을 지우지 않는 이유는 실측에서 문제가 날 때마다 다시 필요하기 때문이다.
// 탭만 없앤 것이고 경로는 그대로다. 근거는 docs/adr/0006.

import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { DiagnosticScreen } from './src/presentation/screen/DiagnosticScreen';
import { RunScreen } from './src/presentation/screen/RunScreen';
import { CourseScreen } from './src/presentation/screen/CourseScreen';
import { RecordsScreen } from './src/presentation/screen/RecordsScreen';
import { COLOR } from './src/presentation/theme';
import { diagnosticSession, runSession } from './src/application/wiring';
import { AutoStartMarker, MARK } from './src/infrastructure/storage/AutoStartMarker';
import { FileTrace } from './src/infrastructure/storage/FileTrace';

export default function App() {
  // 진단은 표식이 있을 때만 열린다. 사람이 여는 길은 없다
  const [screen, setScreen] = useState('run');
  const booted = useRef(false);

  // 부팅 시 할 일은 여기서 한다. 화면에 두면 그 화면이 열리지 않는 동안 아무도 하지 않는다.
  // 남은 구독을 정리하는 일은 어느 화면을 보든 해야 하고, 자동 시작 표식도 그렇다
  useEffect(function () {
    if (booted.current) return;
    booted.current = true;
    (async function () {
      await diagnosticSession.reapStaleSubscription();
      await runSession.reapStale();
      if (AutoStartMarker.consume(MARK.diagnostic)) {
        FileTrace.append('vis', '진단 자동 시작 표식을 확인했습니다');
        setScreen('diag');
        await diagnosticSession.start();
      } else if (AutoStartMarker.consume(MARK.run)) {
        FileTrace.append('vis', '달리기 자동 시작 표식을 확인했습니다');
        setScreen('run');
        await runSession.start();
      } else if (AutoStartMarker.consume(MARK.course)) {
        // 화면만 연다. 달리기를 걸지 않는다
        FileTrace.append('vis', '코스 화면 표식을 확인했습니다');
        setScreen('course');
      } else if (AutoStartMarker.consume(MARK.records)) {
        FileTrace.append('vis', '기록 화면 표식을 확인했습니다');
        setScreen('records');
      }
    })();
  }, []);

  // 앱이 배경으로 밀린 사실을 남긴다. 기기 시험이 판정 경계를 여기서 찾고,
  // 실측에서도 어느 구간이 화면 꺼진 구간인지 이 줄로 가른다
  useEffect(function () {
    const sub = AppState.addEventListener('change', function (st) {
      if (st === 'background') FileTrace.append('vis', '배경 진입');
      else if (st === 'active') FileTrace.append('vis', '전경 복귀');
    });
    return function () { sub.remove(); };
  }, []);

  return (
    <LinearGradient colors={COLOR.canvas} locations={[0, 0.48, 1]} style={s.fill}>
      <SafeAreaView style={s.fill}>
        <StatusBar style="dark" />
        <View style={s.body}>
          {screen === 'diag' ? <DiagnosticScreen /> : null}
          {screen === 'course' ? (
            <CourseScreen onClose={function () { setScreen('run'); }} />
          ) : null}
          {screen === 'records' ? <RecordsScreen /> : null}
          {screen === 'run' ? <RunScreen /> : null}
        </View>
        {/* 하단 바. 진단은 표식으로만 열리는 화면이라 바에 두지 않는다 */}
        {screen !== 'diag' ? <TabBar current={screen} onSelect={setScreen} /> : null}
      </SafeAreaView>
    </LinearGradient>
  );
}

const TABS = [
  { key: 'run', label: '달리기' },
  { key: 'records', label: '기록' },
  { key: 'course', label: '코스' }
];

function TabBar(props) {
  return (
    <View style={s.bar}>
      {TABS.map(function (t) {
        const on = props.current === t.key;
        return (
          <Pressable key={t.key} style={s.tab} hitSlop={6}
            onPress={function () { props.onSelect(t.key); }}>
            <Text style={[s.tabText, on ? s.tabOn : null]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  body: { flex: 1 },
  bar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: COLOR.divider,
    backgroundColor: COLOR.card },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 11 },
  tabText: { fontSize: 14, fontWeight: '700', color: COLOR.inkSoft },
  tabOn: { color: COLOR.run }
});
