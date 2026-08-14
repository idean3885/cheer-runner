// 알림음 생성. 조작 확인 소리 한 개를 합성해 앱 자산으로 넣는다.
//
// 파일을 받아 두지 않고 만드는 이유는 되돌릴 수 있게 하려는 것이다. 소리를 고치려면
// 값을 고쳐 다시 돌리면 되고, 어떤 소리인지가 코드에 적혀 있다.
//
// 두 음을 잇는다. 올라가는 두 음은 «됐다» 로 들리고, 내려가면 «안 됐다» 로 들린다.
// 조작 확인이므로 올린다.
//
// 실행: node tools/make-cue.mjs

import fs from 'node:fs';
import path from 'node:path';

const RATE = 44100;
const OUT = path.join(process.cwd(), 'app', 'assets', 'cue.wav');

// 음 하나. 시작 시각(초) · 주파수(Hz) · 길이(초) · 세기
const NOTES = [
  { at: 0.000, hz: 1567.98, sec: 0.10, gain: 0.5 },   // G6
  { at: 0.085, hz: 2093.00, sec: 0.20, gain: 0.5 }    // C7. 앞 음과 조금 겹쳐 «띠링» 으로 붙는다
];
const TOTAL = 0.30;

// 감쇠 곡선. 뚝 끊으면 «틱» 하는 잡음이 남는다
function envelope(t, dur) {
  const attack = 0.004;
  if (t < attack) return t / attack;
  return Math.pow(1 - (t - attack) / (dur - attack), 2.2);
}

const frames = Math.round(RATE * TOTAL);
const samples = new Float32Array(frames);

NOTES.forEach(function (n) {
  const from = Math.round(n.at * RATE);
  const len = Math.round(n.sec * RATE);
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const idx = from + i;
    if (idx >= frames) break;
    // 기본음에 3배음을 조금 섞는다. 순수 사인파는 «삐» 로 들려 알림보다 경고에 가깝다
    const wave = Math.sin(2 * Math.PI * n.hz * t) + 0.18 * Math.sin(2 * Math.PI * n.hz * 3 * t);
    samples[idx] += wave * n.gain * envelope(t, n.sec);
  }
});

// 겹친 자리가 1 을 넘으면 깨진다. 최대값으로 맞춰 내린다
let peak = 0;
samples.forEach(function (v) { if (Math.abs(v) > peak) peak = Math.abs(v); });
const scale = peak > 0 ? 0.89 / peak : 1;

const data = Buffer.alloc(frames * 2);
for (let i = 0; i < frames; i++) {
  data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * scale * 32767))), i * 2);
}

// WAV 머리말. 16비트 단일 채널
const head = Buffer.alloc(44);
head.write('RIFF', 0);
head.writeUInt32LE(36 + data.length, 4);
head.write('WAVE', 8);
head.write('fmt ', 12);
head.writeUInt32LE(16, 16);
head.writeUInt16LE(1, 20);          // PCM
head.writeUInt16LE(1, 22);          // 채널 1
head.writeUInt32LE(RATE, 24);
head.writeUInt32LE(RATE * 2, 28);   // 초당 바이트
head.writeUInt16LE(2, 32);          // 프레임당 바이트
head.writeUInt16LE(16, 34);
head.write('data', 36);
head.writeUInt32LE(data.length, 40);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([head, data]));
console.log(OUT + ' · ' + (TOTAL * 1000) + 'ms · ' + Math.round((head.length + data.length) / 1024) + 'KB');
