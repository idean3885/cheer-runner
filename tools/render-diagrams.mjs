// 그림을 이미지로 만들어 눈으로 확인할 수 있게 한다.
//
// 손으로 좌표를 적는 SVG 는 결과를 보지 않으면 라벨이 겹친다. 실제로 겹쳤고
// 사람이 알려줘서 알았다. 이 스크립트가 그 확인을 작성자에게 돌려준다.
//
// 시스템 크롬을 쓴다. 브라우저를 따로 내려받지 않는다.
// 실행: node tools/render-diagrams.mjs

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'docs', 'diagrams');
const OUT = path.join(ROOT, 'tools', 'rendered');

fs.mkdirSync(OUT, { recursive: true });

const files = fs.readdirSync(SRC).filter(function (f) { return f.endsWith('.svg'); });
if (!files.length) { console.log('그림이 없습니다'); process.exit(0); }

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ deviceScaleFactor: 2 });

for (const f of files) {
  const svg = fs.readFileSync(path.join(SRC, f), 'utf8');
  const m = svg.match(/width="(\d+)"\s+height="(\d+)"/);
  const w = m ? +m[1] : 900, h = m ? +m[2] : 600;
  await page.setViewportSize({ width: w, height: h });
  await page.setContent('<body style="margin:0">' + svg + '</body>');
  const png = path.join(OUT, f.replace('.svg', '.png'));
  await page.screenshot({ path: png });
  console.log('  ' + f + ' → ' + path.relative(ROOT, png) + '  (' + w + '×' + h + ')');
}

await browser.close();
console.log(files.length + '개 그림을 이미지로 만들었습니다');
