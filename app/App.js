// 조립 지점. 화면을 고르는 것 외에는 아무것도 하지 않는다.
//
// 진단 화면과 주행 화면을 나눈 이유는, 진단을 버릴 코드로 두지 않기 위해서다.
// 위치 어댑터는 두 화면이 같은 것을 쓰므로 통과하면 그대로 남고,
// 진단 화면은 실측에서 문제가 날 때마다 다시 필요하다.

import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { DiagnosticScreen } from './src/presentation/screen/DiagnosticScreen';
import { RunScreen } from './src/presentation/screen/RunScreen';
import { diagnosticSession, runSession } from './src/application/wiring';
import { AutoStartMarker, MARK } from './src/infrastructure/storage/AutoStartMarker';
import { FileTrace } from './src/infrastructure/storage/FileTrace';

// 주행이 앞이다. 러너가 보는 화면이고, 진단은 문제가 났을 때만 본다
const TABS = [
  { key: 'run', label: '주행' },
  { key: 'diag', label: '진단' }
];

export default function App() {
  // 0 단계를 통과했으므로 주행을 먼저 띄운다. 진단은 실측에서 문제가 날 때 본다
  const [tab, setTab] = useState('run');
  const booted = useRef(false);

  // 부팅 시 할 일은 여기서 한다. 화면에 두면 그 탭이 열리지 않는 동안 아무도 하지 않는다.
  // 남은 구독을 정리하는 일은 어느 탭을 보든 해야 하고, 자동 시작 표식도 그렇다
  useEffect(function () {
    if (booted.current) return;
    booted.current = true;
    (async function () {
      await diagnosticSession.reapStaleSubscription();
      await runSession.reapStale();
      if (AutoStartMarker.consume(MARK.diagnostic)) {
        FileTrace.append('vis', '진단 자동 시작 표식을 확인했습니다');
        setTab('diag');
        await diagnosticSession.start();
      } else if (AutoStartMarker.consume(MARK.run)) {
        FileTrace.append('vis', '주행 자동 시작 표식을 확인했습니다');
        setTab('run');
        await runSession.start();
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
    <SafeAreaView style={s.root}>
      <StatusBar style="auto" />
      <View style={s.body}>
        {tab === 'diag' ? <DiagnosticScreen /> : <RunScreen />}
      </View>
      <View style={s.tabs}>
        {TABS.map(function (t) {
          const on = tab === t.key;
          return (
            <Pressable key={t.key} onPress={function () { setTab(t.key); }}
              style={[s.tab, on ? s.tabOn : null]}>
              <Text style={[s.tabText, on ? s.tabTextOn : null]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  body: { flex: 1 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#e3e8ef' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabOn: { borderTopWidth: 2, borderTopColor: '#c4452b', marginTop: -1 },
  tabText: { fontSize: 14, color: '#889' },
  tabTextOn: { color: '#c4452b', fontWeight: '700' }
});
