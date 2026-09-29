// 固定种子的视觉核对图。标签仅用于开发检查，正式游戏中不展示。
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PAPER_GHOST_BROWSER ? { executablePath: process.env.PAPER_GHOST_BROWSER } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
    await context.setOffline(true);
    const page = await context.newPage();
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    await page.evaluate(() => {
      document.body.replaceChildren();
      document.body.style.cssText = 'padding:24px;background:#f2f0e7;color:#203b3b';
      const title = document.createElement('h1');
      title.textContent = '合成刺激检查 · 固定种子 701';
      title.style.cssText = 'font-size:24px;margin:0 0 18px';
      document.body.append(title);
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px';
      document.body.append(grid);
      for (const dPrime of [2, 4, 6]) for (const signal of [false, true]) {
        const cell = document.createElement('div');
        const label = document.createElement('p');
        label.textContent = `生成 d′ = ${dPrime} · ${signal ? '有水印' : '无水印'}`;
        label.style.margin = '0 0 8px';
        const canvas = document.createElement('canvas');
        canvas.width = 600;
        canvas.height = 420;
        canvas.style.cssText = 'width:100%;display:block';
        cell.append(label, canvas);
        grid.append(cell);
        PaperStimulus.draw(canvas, { seed: 701, signal, dPrime, phase: 'sample' });
      }
    });
    await page.screenshot({ path: path.resolve(__dirname, '../verification/10-stimulus-levels.png'), fullPage: true });
    console.log('Saved fixed-seed stimulus check. No player records were created.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
