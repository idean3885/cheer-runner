// 달리기 화면. 러너가 보는 화면이다.
//
// 이 화면이 하는 일은 셋이다. 세션을 부르고, 되돌아온 값을 그리고, 버튼을 연결한다.
// 거리를 쌓거나 도달을 판정하는 코드는 여기 없다. 그것은 도메인에 있다.
//
// 화면에 로직을 두면 두 가지가 무너진다. 기기 없이 시험할 수 없고, 같은 로직이
// 진단 화면과 달리기 화면에 각각 적힌다.
//
// 색은 적지 않고 theme.js 에서 가져온다. 같은 색이 여러 자리에 적히면 한쪽만 바뀐다.

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, Circle, PROVIDER_DEFAULT } from 'react-native-maps';
import { runSession } from '../../application/wiring';
import { WAYPOINT_RAD } from '../../domain/constants';
import { COLOR } from '../theme';

function fmtDur(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const two = function (n) { return (n < 10 ? '0' : '') + n; };
  return (h > 0 ? h + ':' : '') + two(m) + ':' + two(sec);
}

function fmtPace(sec) {
  if (sec == null || !isFinite(sec)) return '--\'--"';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m + "'" + (s < 10 ? '0' : '') + s + '"';
}

export function RunScreen() {
  const [v, setV] = useState(runSession.view());
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  function refresh() { setV(runSession.view()); }

  useEffect(function () {
    // 달리기 전에도 지도를 띄운다. 위치를 한 번 받아 러너 자리에 맞춘다
    runSession.locate();
    const off = runSession.onChange(refresh);
    // 화면이 켜져 있을 때만 시계를 돌린다. 배경에서는 위치 수신이 갱신을 부른다
    const t = setInterval(refresh, 1000);
    return function () { off(); clearInterval(t); };
  }, []);

  async function onStart() {
    setBusy(true);
    const r = await runSession.start();
    setBusy(false);
    if (!r.started) {
      setNotice(r.reason === 'background-permission'
        ? '위치 권한을 «항상 허용» 으로 주어야 화면이 꺼진 뒤에도 기록됩니다'
        : '시작하지 못했습니다: ' + (r.error || r.reason));
      return;
    }
    setNotice(null);
    refresh();
  }

  async function onFinish() {
    setBusy(true);
    await runSession.finish('user');
    setBusy(false);
    refresh();
  }

  function onMarkHere() {
    const r = runSession.markHere();
    setNotice(r.marked
      ? '여기를 표시했습니다. 이번 달리기에는 울리지 않고 다음부터 응원합니다'
      : '아직 위치를 받지 못했습니다');
    refresh();
  }

  const running = v.state === 'running';
  const km = (v.dist / 1000).toFixed(2);

  // 지도를 러너 자리에 맞춘다. 지도를 손으로 옮긴 뒤에는 따라가지 않는다.
  // 달리는 중에 화면이 계속 튀면 지점을 찍을 수 없다
  const region = v.here ? {
    latitude: v.here.lat, longitude: v.here.lon,
    latitudeDelta: 0.006, longitudeDelta: 0.006
  } : null;

  function onMapPress(e) {
    if (!e.nativeEvent || !e.nativeEvent.coordinate) return;
    const c = e.nativeEvent.coordinate;
    const r = runSession.pin(c.latitude, c.longitude);
    setNotice(pinNotice(r));
    refresh();
  }

  return (
    <View style={s.root}>
      <View style={s.head}>
        <Text style={s.km}>{km}</Text>
        <Text style={s.kmUnit}>km</Text>
      </View>

      <View style={s.grid}>
        <Cell label="시간" value={fmtDur(v.ms)} />
        <Cell label="페이스" value={fmtPace(v.pace)} />
        <Cell label="다음 지점" value={targetText(v)} />
      </View>

      {notice ? <Text style={s.notice}>{notice}</Text> : null}

      <View style={s.btns}>
        <Big label={running ? '종료' : '달리기'} tone={running ? 'stop' : 'go'}
          disabled={busy} onPress={running ? onFinish : onStart} />
        <Big label="여기 표시" tone="mark" disabled={!running || busy} onPress={onMarkHere} />
      </View>

      <View style={s.mapBox}>
        {region ? (
          <MapView style={s.map} provider={PROVIDER_DEFAULT} initialRegion={region}
            showsUserLocation followsUserLocation={running} onPress={onMapPress}>
            {v.segments.map(function (seg, i) {
              return (
                <Polyline key={'p' + i} strokeColor={COLOR.path} strokeWidth={4}
                  coordinates={seg.map(function (pt) {
                    return { latitude: pt.lat, longitude: pt.lon };
                  })} />
              );
            })}
            {v.spots.map(function (p, i) {
              const done = v.arrivals.some(function (a) { return a.idx === i; });
              return [
                <Circle key={'c' + p.id} center={{ latitude: p.lat, longitude: p.lon }}
                  radius={p.rad || WAYPOINT_RAD}
                  strokeColor={done ? COLOR.spotDone : COLOR.spot}
                  fillColor={done ? COLOR.spotDoneFill : COLOR.spotFill} />,
                <Marker key={'m' + p.id} coordinate={{ latitude: p.lat, longitude: p.lon }}
                  title={(i + 1) + '번 지점'} description={done ? '지남' : '대기'}
                  pinColor={done ? 'gray' : COLOR.spot} />
              ];
            })}
          </MapView>
        ) : (
          <View style={s.mapWait}>
            <Text style={s.empty}>위치를 받으면 지도가 나타납니다.</Text>
          </View>
        )}
      </View>

      <Text style={s.h2}>응원받을 지점 {v.spots.length}곳</Text>
      {v.spots.length === 0 ? (
        <Text style={s.empty}>{v.hasCourse
          ? '지도를 눌러 지정하거나, 달리는 중에 «여기 표시» 를 누릅니다.'
          : '먼저 한 번 달립니다. 그 경로가 코스가 되고, 그때부터 지도에서 지정할 수 있습니다. 달리는 중에는 «여기 표시» 로 남깁니다.'}</Text>
      ) : (
      <ScrollView style={s.list}>
        {v.spots.map(function (p, i) {
          const done = v.arrivals.some(function (a) { return a.idx === i; });
          return (
            <View key={p.id} style={s.row}>
              <Text style={[s.rowK, done ? s.rowDone : null]}>{i + 1}번 지점</Text>
              <Text style={s.rowV}>
                {done ? '지남' : (i === v.arrivals.length && running ? '다음' : '대기')}
              </Text>
              <Pressable onPress={function () { runSession.removeSpot(p.id); refresh(); }} hitSlop={8}>
                <Text style={s.del}>지우기</Text>
              </Pressable>
            </View>
          );
        })}
        {v.arrivals.map(function (a) {
          return (
            <Text key={'a' + a.idx} style={s.arrival}>
              {a.idx + 1}번 지점 도착 · 구간 {Math.round(a.segDist)}m · {fmtPace(a.pace)}
            </Text>
          );
        })}
      </ScrollView>
      )}
    </View>
  );
}

function pinNotice(r) {
  if (r.ok) return '지점을 지정했습니다. 아직 지나지 않은 곳이면 이번 달리기에도 응원합니다';
  if (r.reason === 'no-course') {
    return '아직 코스가 없습니다. 한 번 달리면 그 경로가 코스가 되고, 그때부터 지도에서 지정할 수 있습니다';
  }
  return '코스에서 ' + Math.round(r.distance) + 'm 떨어진 자리입니다. '
    + r.limit + 'm 안쪽만 지정할 수 있습니다';
}

// 목표가 없는 것과 아직 거리를 모르는 것은 다르다. 다 지났는데 계산 중으로 두면
// 러너가 남은 지점이 있다고 읽는다
function targetText(v) {
  if (v.target) return v.targetDist != null ? Math.round(v.targetDist) + 'm' : '계산 중';
  if (v.spots.length === 0) return '없음';
  return '모두 지남';
}

function Cell(props) {
  return (
    <View style={s.cell}>
      <Text style={s.cellLabel}>{props.label}</Text>
      <Text style={s.cellValue}>{props.value}</Text>
    </View>
  );
}

function Big(props) {
  return (
    <Pressable onPress={props.onPress} disabled={props.disabled}
      style={[s.big, s['big_' + props.tone], props.disabled ? s.bigOff : null]}>
      <Text style={s.bigText}>{props.label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  head: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', marginTop: 8 },
  km: { fontSize: 64, fontWeight: '800', fontVariant: ['tabular-nums'], color: COLOR.ink },
  kmUnit: { fontSize: 18, color: COLOR.inkSoft, marginBottom: 12, marginLeft: 4 },
  grid: { flexDirection: 'row', gap: 8, marginTop: 4 },
  cell: { flex: 1, backgroundColor: COLOR.card, borderRadius: 12, borderWidth: 1,
    borderColor: COLOR.cardLine, paddingVertical: 10, alignItems: 'center' },
  cellLabel: { fontSize: 11, color: COLOR.inkSoft },
  cellValue: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 2, color: COLOR.ink },
  notice: { marginTop: 10, fontSize: 12, color: COLOR.warn, lineHeight: 17 },
  btns: { flexDirection: 'row', gap: 10, marginTop: 14 },
  big: { flex: 1, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  big_go: { backgroundColor: COLOR.run },
  big_stop: { backgroundColor: COLOR.stop },
  big_mark: { backgroundColor: COLOR.mark },
  bigOff: { opacity: 0.4 },
  bigText: { fontSize: 17, fontWeight: '700', color: COLOR.onDark },
  mapBox: { flex: 1, marginTop: 14, marginBottom: 2, borderRadius: 14, overflow: 'hidden',
    backgroundColor: COLOR.mapWait },
  map: { flex: 1 },
  mapWait: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  h2: { marginTop: 14, fontSize: 13, fontWeight: '700', color: COLOR.ink },
  empty: { marginTop: 4, marginBottom: 10, fontSize: 12, color: COLOR.inkSoft, lineHeight: 18 },
  list: { maxHeight: 160, marginTop: 6, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1,
    borderBottomColor: COLOR.divider },
  rowK: { flex: 1, fontSize: 14, fontWeight: '600', color: COLOR.ink },
  rowDone: { color: COLOR.inkFaint, textDecorationLine: 'line-through' },
  rowV: { fontSize: 12, color: COLOR.inkSoft, marginRight: 14 },
  del: { fontSize: 12, color: COLOR.danger },
  arrival: { fontSize: 12, color: COLOR.ok, paddingVertical: 3 }
});
