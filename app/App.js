// 조립 지점. 화면을 고르는 것 외에는 아무것도 하지 않는다.
//
// 진단 화면과 주행 화면을 나눈 이유는, 진단을 버릴 코드로 두지 않기 위해서다.
// 위치 어댑터는 두 화면이 같은 것을 쓰므로 통과하면 그대로 남고,
// 진단 화면은 실측에서 문제가 날 때마다 다시 필요하다.

import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { DiagnosticScreen } from './src/presentation/screen/DiagnosticScreen';
import { RunScreen } from './src/presentation/screen/RunScreen';

const TABS = [
  { key: 'diag', label: '진단' },
  { key: 'run', label: '주행' }
];

export default function App() {
  // 0 단계를 통과하기 전이므로 진단을 먼저 띄운다
  const [tab, setTab] = useState('diag');

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
