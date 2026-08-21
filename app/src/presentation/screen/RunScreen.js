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
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View,
  useWindowDimensions } from 'react-native';
import MapView, { Marker, Polyline, Circle, PROVIDER_DEFAULT } from 'react-native-maps';
import { runSession } from '../../application/wiring';
import { BLOCK } from '../../application/RunSession';
import { WAYPOINT_RAD } from '../../domain/constants';
import { COLOR } from '../theme';
import { fmtDur, fmtPace, fmtWhen, splitText } from '../format';

// 시작 조건을 다시 보는 간격. 위치 서비스는 바뀌었다고 알려 주지 않으므로 물어봐야 한다.
// 앞으로 돌아올 때도 보므로 이 간격이 유일한 통로는 아니다
const RECHECK_MS = 10000;

// 못 하는 사유마다 무엇을 해야 하는지 적는다. 「시작할 수 없습니다」 하나로는
// 사용자가 할 일을 알 수 없다
const BANNER = {
  [BLOCK.permission]: '위치 권한이 거부돼 있습니다. 설정에서 «항상 허용» 으로 바꿔 주세요',
  [BLOCK.service]: '위치 서비스가 꺼져 있습니다. 기기 설정에서 위치를 켜 주세요',
  [BLOCK.waiting]: '위치를 받는 중입니다',
  [BLOCK.fix]: '위치를 받지 못하고 있습니다. 지하나 실내면 하늘이 보이는 곳으로 나가 주세요',
  [BLOCK.offline]: '인터넷이 끊겨 지도를 그릴 수 없습니다. 연결을 확인해 주세요'
};

export function RunScreen(props) {
  const [v, setV] = useState(runSession.view());
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  // 추천을 접은 사실을 기억한다. 지운 카드가 10초 뒤 다시 올라오면 지운 것이 아니다
  const [hidden, setHidden] = useState([]);

  function refresh() { setV(runSession.view()); }

  useEffect(function () {
    // 달리기 전에도 지도를 띄운다. 위치를 한 번 받아 러너 자리에 맞추고,
    // 그 결과가 시작할 수 있는 상태인지를 함께 가른다
    runSession.checkReadiness();
    const off = runSession.onChange(refresh);
    // 화면이 켜져 있을 때만 시계를 돌린다. 배경에서는 위치 수신이 갱신을 부른다
    const t = setInterval(refresh, 1000);
    const recheck = setInterval(function () { runSession.checkReadiness(); }, RECHECK_MS);
    // 설정에서 위치를 켜고 돌아오는 길이 있다. 돌아온 자리에서 다시 본다
    const sub = AppState.addEventListener('change', function (st) {
      if (st === 'active') runSession.checkReadiness();
    });
    return function () { off(); clearInterval(t); clearInterval(recheck); sub.remove(); };
  }, []);

  async function onStart() {
    setBusy(true);
    const r = await runSession.start();
    setBusy(false);
    if (!r.started) {
      // 시작 조건이 아닌 것은 배너가 이미 말하고 있다. 같은 말을 두 자리에 적지 않는다
      if (r.reason !== 'not-ready') {
        setNotice(r.reason === 'background-permission'
          ? '위치 권한을 «항상 허용» 으로 주어야 화면이 꺼진 뒤에도 기록됩니다'
          : '시작하지 못했습니다: ' + (r.error || r.reason));
      }
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

  // 기기 대응. 13 미니 같은 짧은 화면에서 지도가 고정 요소에 눌려 작아진다.
  // 지도에 화면 높이의 몫을 보장하고, 짧은 화면에서는 큰 글자와 목록을 줄인다
  const { height } = useWindowDimensions();
  const short = height < 830;
  const mapMin = { minHeight: Math.round(height * 0.36) };

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

  // 달리는 중에는 배너를 띄우지 않는다. 이미 시작한 달리기는 막지 않으므로
  // 알려도 할 일이 없고, 달리면서 읽을 수 있는 것도 아니다
  const banner = running ? null : (v.blocks || []).map(function (b) { return BANNER[b]; }).filter(Boolean);

  // 추천은 한 개만 띄운다. 가장 가까운 것 하나면 고를 수 있고, 셋을 늘어놓으면
  // 시작 전에 목록을 읽게 된다. 나머지는 코스 화면에 있다.
  // 지금 코스와 같은 것은 권하지 않는다. 이미 불러온 것을 다시 불러올 이유가 없다
  const suggestion = (v.suggested || []).filter(function (c) {
    return !c.current && hidden.indexOf(c.id) < 0;
  })[0] || null;

  return (
    <View style={s.root}>
      {banner && banner.length ? (
        <View style={s.banner}>
          {banner.map(function (line, i) {
            return <Text key={i} style={s.bannerText}>{line}</Text>;
          })}
          {/* 권한 거부는 앱 안에서 되돌릴 수 없다. 그래서 갈 곳을 준다 */}
          {(v.blocks || []).indexOf(BLOCK.permission) >= 0 ? (
            <Pressable style={s.bannerBtn} onPress={function () { Linking.openSettings(); }}>
              <Text style={s.bannerBtnText}>설정 열기</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {suggestion ? (
        <View style={s.suggest}>
          <Text style={s.suggestK}>
            {'이 근처에서 달린 코스가 있습니다'}
          </Text>
          <Text style={s.suggestV}>
            {(suggestion.name || '마지막 달리기') + ' · 지점 ' + suggestion.spots + '곳 · '
              + (suggestion.dist / 1000).toFixed(2) + 'km'}
          </Text>
          <View style={s.suggestBtns}>
            <Pressable style={s.suggestGo} onPress={function () {
              const r = runSession.loadCourse(suggestion.id);
              setNotice(r.ok
                ? '코스를 불러왔습니다. 지점 ' + r.course.spots.length + '곳이 순서대로 응원합니다'
                : '불러오지 못했습니다');
              refresh();
            }}>
              <Text style={s.suggestGoText}>불러오기</Text>
            </Pressable>
            <Pressable hitSlop={8} onPress={function () {
              setHidden(hidden.concat([suggestion.id]));
            }}>
              <Text style={s.suggestSkip}>아니요</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={s.head}>
        <Text style={[s.km, short ? s.kmShort : null]}>{km}</Text>
        <Text style={s.kmUnit}>km</Text>
        <Pressable style={s.courseBtn} onPress={props.onOpenCourses} hitSlop={8}>
          <Text style={s.courseBtnText}>코스</Text>
        </Pressable>
        <Pressable style={[s.courseBtn, s.recordsBtn]} onPress={props.onOpenRecords} hitSlop={8}>
          <Text style={s.courseBtnText}>기록</Text>
        </Pressable>
      </View>

      <View style={s.grid}>
        <Cell label="시간" value={fmtDur(v.ms)} />
        {/* 메인은 평균 페이스다. 지점을 찍어도 재설정되지 않는다. 현재(창) 페이스는 보조 */}
        <Cell label="평균 페이스" value={fmtPace(v.pace)}
          sub={v.wPace != null ? '현재 ' + fmtPace(v.wPace) : null} />
        <Cell label="다음 지점" value={targetText(v)} />
      </View>

      {notice ? <Text style={s.notice}>{notice}</Text> : null}

      <View style={s.btns}>
        {/* 눌리는지는 세션이 정한다. 화면이 상태를 보고 판단하면 그 식이 시험 밖에 남는다 */}
        <Big label={running ? '종료' : '달리기'} tone={running ? 'stop' : 'go'}
          disabled={busy || !v.canToggle}
          onPress={running ? onFinish : onStart} />
        <Big label="여기 표시" tone="mark" disabled={busy || !v.canMark} onPress={onMarkHere} />
      </View>

      <View style={[s.mapBox, mapMin]}>
        {region ? (
          <MapView style={s.map} provider={PROVIDER_DEFAULT} initialRegion={region}
            showsUserLocation followsUserLocation={running} onPress={onMapPress}>
            {/* 기준 경로. 지난 달리기의 길이 어디였는지가 달리기 전에도 보인다 */}
            {v.coursePath && v.coursePath.length > 1 ? (
              <Polyline strokeColor={COLOR.coursePath} strokeWidth={3} lineDashPattern={[6, 6]}
                coordinates={v.coursePath.map(function (pt) {
                  return { latitude: pt.lat, longitude: pt.lon };
                })} />
            ) : null}
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

      {/* 종료 직후가 아니어도 마지막 달리기를 볼 수 있어야 한다. 달리는 중에는 계기판이 그 자리다 */}
      {v.state === 'ready' && v.lastRun ? <LastRunCard r={v.lastRun} /> : null}

      <Text style={s.h2}>
        {v.state === 'finished' ? '달리기 기록 · ' : ''}
        {v.courseName ? v.courseName + ' · ' : ''}응원받을 지점 {v.spots.length}곳
      </Text>
      {v.spots.length === 0 ? (
        <Text style={s.empty}>{v.hasCourse
          ? '지도를 눌러 지정하거나, 달리는 중에 «여기 표시» 를 누릅니다.'
          : '먼저 한 번 달립니다. 그 경로가 코스가 되고, 그때부터 지도에서 지정할 수 있습니다. 달리는 중에는 «여기 표시» 로 남깁니다.'}</Text>
      ) : (
      <ScrollView style={[s.list, short ? s.listShort : null]}>
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
        {/* 진행 중 구간. 마지막으로 지난 지점부터 지금까지가 실시간으로 바뀐다 */}
        {running && v.seg ? (
          <Text style={s.segLive}>
            진행 구간 {Math.round(v.seg.dist)}m · {fmtPace(v.seg.pace)}
          </Text>
        ) : null}
        {v.splits.map(function (sp, i) {
          return (
            <Text key={'s' + i} style={s.arrival}>{splitText(sp)}</Text>
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
// 러너가 남은 지점이 있다고 읽는다. 달리기 전에는 지나간 것이 없으므로 대기다
function targetText(v) {
  if (v.state === 'ready') return v.spots.length ? '대기' : '없음';
  if (v.target) return v.targetDist != null ? Math.round(v.targetDist) + 'm' : '계산 중';
  if (v.spots.length === 0) return '없음';
  return '모두 지남';
}

// 마지막 달리기. 이전 빌드가 남긴 요약에는 구간이 없으므로 있는 것만 그린다
function LastRunCard(props) {
  const r = props.r;
  return (
    <View style={s.lastRun}>
      <Text style={s.lastRunK}>마지막 달리기</Text>
      <Text style={s.lastRunV}>
        {fmtWhen(r.startedAt)} · {(r.dist / 1000).toFixed(2)}km · {fmtDur(r.ms)}
        {' · 평균 '}{fmtPace(r.pace)}
      </Text>
      {(r.splits || []).map(function (sp, i) {
        return <Text key={'ls' + i} style={s.lastRunSplit}>{splitText(sp)}</Text>;
      })}
    </View>
  );
}

function Cell(props) {
  return (
    <View style={s.cell}>
      <Text style={s.cellLabel}>{props.label}</Text>
      <Text style={s.cellValue}>{props.value}</Text>
      {props.sub ? <Text style={s.cellSub}>{props.sub}</Text> : null}
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
  banner: { marginTop: 6, marginHorizontal: -4, paddingVertical: 9, paddingHorizontal: 12,
    borderRadius: 10, backgroundColor: COLOR.bannerBg, borderWidth: 1, borderColor: COLOR.bannerLine },
  bannerText: { fontSize: 12.5, lineHeight: 18, color: COLOR.bannerInk, fontWeight: '600' },
  bannerBtn: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, paddingHorizontal: 12,
    borderRadius: 8, backgroundColor: COLOR.bannerInk },
  bannerBtnText: { fontSize: 12.5, fontWeight: '700', color: COLOR.onDark },
  suggest: { marginTop: 8, padding: 12, borderRadius: 12, backgroundColor: COLOR.card,
    borderWidth: 1, borderColor: COLOR.run },
  suggestK: { fontSize: 13, fontWeight: '700', color: COLOR.run },
  suggestV: { marginTop: 3, fontSize: 13, color: COLOR.ink },
  suggestBtns: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  suggestGo: { backgroundColor: COLOR.run, borderRadius: 9, paddingVertical: 8, paddingHorizontal: 14 },
  suggestGoText: { fontSize: 13, fontWeight: '700', color: COLOR.onDark },
  suggestSkip: { fontSize: 13, color: COLOR.inkSoft },
  // 거리 숫자가 커져도 겹치지 않게 오른쪽에 세로로 쌓는다
  courseBtn: { position: 'absolute', right: 0, bottom: 42, paddingVertical: 5, paddingHorizontal: 12,
    borderRadius: 9, borderWidth: 1, borderColor: COLOR.run },
  recordsBtn: { bottom: 6 },
  courseBtnText: { fontSize: 13, fontWeight: '700', color: COLOR.run },
  head: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', marginTop: 8 },
  km: { fontSize: 64, fontWeight: '800', fontVariant: ['tabular-nums'], color: COLOR.ink },
  kmShort: { fontSize: 50 },
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
  listShort: { maxHeight: 110 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1,
    borderBottomColor: COLOR.divider },
  rowK: { flex: 1, fontSize: 14, fontWeight: '600', color: COLOR.ink },
  rowDone: { color: COLOR.inkFaint, textDecorationLine: 'line-through' },
  rowV: { fontSize: 12, color: COLOR.inkSoft, marginRight: 14 },
  del: { fontSize: 12, color: COLOR.danger },
  lastRun: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: COLOR.card,
    borderWidth: 1, borderColor: COLOR.cardLine },
  lastRunK: { fontSize: 11, color: COLOR.inkSoft, fontWeight: '700' },
  lastRunV: { marginTop: 3, fontSize: 13, fontWeight: '600', color: COLOR.ink,
    fontVariant: ['tabular-nums'] },
  lastRunSplit: { marginTop: 3, fontSize: 12, color: COLOR.ok, fontVariant: ['tabular-nums'] },
  cellSub: { fontSize: 10.5, color: COLOR.inkSoft, marginTop: 1, fontVariant: ['tabular-nums'] },
  segLive: { fontSize: 12, fontWeight: '600', color: COLOR.run, paddingVertical: 3,
    fontVariant: ['tabular-nums'] },
  arrival: { fontSize: 12, color: COLOR.ok, paddingVertical: 3 }
});
