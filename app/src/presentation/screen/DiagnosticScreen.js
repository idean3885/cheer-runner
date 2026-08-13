// 진단 화면. 개발자만 본다.
//
// 확인하는 것은 둘이다.
//   1. 화면을 끄고 기다리는 동안 위치가 계속 들어오는가
//   2. 그 동안 음성이 실제로 들리는가
//
// 웹에서는 1번이 0건이었다. 소리는 살고 자바스크립트도 돌았는데 위치만 멈췄다.
//
// 판단은 이 화면에 없다. DiagnosticSession 이 갖는다. 화면은 그것을 부르고 결과를 그린다.
// 판단을 화면에 두면 기기 없이 시험할 수 없고, 기기가 필요하면 확인이 사람 손으로 돌아간다.

import { useEffect, useRef, useState } from 'react';
import { AppState, Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ExpoLocationAdapter } from '../../infrastructure/location/ExpoLocationAdapter';
import { ExpoSpeechAdapter } from '../../infrastructure/speech/ExpoSpeechAdapter';
import { FileTrace } from '../../infrastructure/storage/FileTrace';
import { diagnosticSession as session } from '../../application/wiring';

export function DiagnosticScreen() {
  const [running, setRunning] = useState(false);
  const [perm, setPerm] = useState({ foreground: '?', background: '?' });
  const [registered, setRegistered] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);
  const [fgCount, setFgCount] = useState(0);
  const [hiddenBg, setHiddenBg] = useState(null);
  const [snap, setSnap] = useState({
    backgroundFixes: 0, speechRequests: 0, speechDone: 0, errors: 0, leftMs: null, trace: []
  });
  const fgWatch = useRef(null);
  const booted = useRef(false);

  function refresh() {
    setSnap(session.view());
    ExpoLocationAdapter.getPermissions().then(setPerm);
    ExpoLocationAdapter.isBackgroundRunning().then(function (on) {
      setRegistered(on);
      setRunning(on);
    });
  }

  async function start() {
    setHiddenBg(null);
    setFgCount(0);
    const r = await session.start();
    if (r.started) {
      // 전경 구독을 따로 건다. 배경이 0건일 때 위치 자체의 문제인지 가른다
      try {
        fgWatch.current = await ExpoLocationAdapter.watchForeground(function () {
          setFgCount(function (n) { return n + 1; });
        });
      } catch (e) { FileTrace.append('err', '전경 구독 실패: ' + e.message); }
    }
    refresh();
    return r;
  }

  async function stop() {
    await session.stop();
    if (fgWatch.current) { fgWatch.current.remove(); fgWatch.current = null; }
    ExpoSpeechAdapter.stop();
    refresh();
  }

  // 남은 구독 정리와 자동 시작 표식은 조립 지점이 본다. 화면에 두면 그 탭이
  // 열리지 않는 동안 아무도 보지 않는다
  useEffect(function () {
    if (booted.current) return;
    booted.current = true;
    refresh();
  }, []);

  useEffect(function () {
    const t = setInterval(refresh, 2000);
    return function () { clearInterval(t); };
  }, []);

  useEffect(function () {
    const sub = AppState.addEventListener('change', function (st) {
      setAppState(st);
      if (st === 'background') session.enterBackground();
      else if (st === 'active') {
        const n = session.returnToForeground();
        if (n != null) setHiddenBg(n);
        refresh();
      }
    });
    return function () { sub.remove(); };
  }, []);

  const left = snap.leftMs;

  return (
    <View style={s.root}>
      <Text style={s.title}>진단</Text>
      <Text style={s.sub}>시작 후 화면을 끄고 30초 기다립니다. «꺼진 동안» 과 «음성 재생» 이 판정입니다.</Text>

      <View style={s.grid}>
        <Stat label="꺼진 동안 배경" value={hiddenBg == null ? '미측정' : String(hiddenBg)}
          tone={hiddenBg == null ? 'warn' : (hiddenBg > 0 ? 'ok' : 'bad')} />
        <Stat label="배경 위치 전체" value={String(snap.backgroundFixes)} />
        <Stat label="전경 위치" value={String(fgCount)} />
      </View>

      <View style={s.rows}>
        <Row k="배경 작업 등록" v={registered ? '등록됨' : '미등록'} tone={registered ? 'ok' : 'bad'} />
        <Row k="전경 권한" v={perm.foreground} tone={perm.foreground === 'granted' ? 'ok' : 'bad'} />
        <Row k="배경 권한" v={perm.background} tone={perm.background === 'granted' ? 'ok' : 'bad'} />
        <Row k="음성 재생" v={snap.speechDone + ' / 요청 ' + snap.speechRequests}
          tone={snap.speechRequests === 0 ? null : (snap.speechDone > 0 ? 'ok' : 'bad')} />
        <Row k="앱 상태" v={appState} />
        <Row k="자동 해제까지"
          v={left == null ? '세션 없음' : (left > 0 ? Math.ceil(left / 60000) + '분' : '만료됨')}
          tone={left == null ? null : (left > 0 ? 'ok' : 'warn')} />
        <Row k="오류" v={String(snap.errors)} tone={snap.errors ? 'bad' : 'ok'} />
      </View>

      <View style={s.btns}>
        <Button title={running ? '중지' : '시작'} onPress={running ? stop : start} />
      </View>

      <ScrollView style={s.log}>
        {snap.trace.slice(-60).reverse().map(function (m, i) {
          return (
            <Text key={i} style={[s.line, s['k_' + m.kind] || s.k_vis]}>
              {new Date(m.at).toLocaleTimeString('ko-KR')} {m.msg}
            </Text>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Stat(props) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{props.label}</Text>
      <Text style={[s.statBig, props.tone ? s['t_' + props.tone] : null]}>{props.value}</Text>
    </View>
  );
}

function Row(props) {
  return (
    <View style={s.row}>
      <Text style={s.rowK}>{props.k}</Text>
      <Text style={[s.rowV, props.tone ? s['t_' + props.tone] : null]}>{props.v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 14 },
  title: { fontSize: 22, fontWeight: '700' },
  sub: { fontSize: 12, color: '#556', marginTop: 3, marginBottom: 12 },
  grid: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: '#f2f5f9', borderRadius: 10, padding: 9 },
  statLabel: { fontSize: 10, color: '#667' },
  statBig: { fontSize: 24, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  rows: { marginTop: 10, backgroundColor: '#f7f9fc', borderRadius: 10, paddingVertical: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 3 },
  rowK: { fontSize: 12, color: '#556' },
  rowV: { fontSize: 12, fontWeight: '600' },
  btns: { marginVertical: 12 },
  log: { flex: 1, backgroundColor: '#0b0f14', borderRadius: 10, padding: 9, marginBottom: 16 },
  line: { fontSize: 10.5, fontFamily: 'Menlo', marginBottom: 2 },
  t_ok: { color: '#1a7f37' },
  t_bad: { color: '#c4452b' },
  t_warn: { color: '#9a6700' },
  k_bg: { color: '#7ee08a' },
  k_err: { color: '#ff8a7a' },
  k_say: { color: '#8ab6ff' },
  k_mark: { color: '#ffd479' },
  k_vis: { color: '#cdd6e0' }
});
