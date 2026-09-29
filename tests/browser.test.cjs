/* Development-only checks. Run with Playwright installed; the website itself has no dependencies. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const out = path.resolve(__dirname, '../verification');
fs.mkdirSync(out, {recursive:true});
const url = process.env.PAPER_GHOST_URL || pathToFileURL(path.resolve(__dirname,'../index.html')).href;
const checks=[];
function pass(name){checks.push(name);console.log(`PASS ${name}`);}

(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PAPER_GHOST_BROWSER?{executablePath:process.env.PAPER_GHOST_BROWSER}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1050},deviceScaleFactor:1,acceptDownloads:true});
  await context.setOffline(true);
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
  const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
  const advance=ms=>page.evaluate(ms=>window.advanceTime(ms),ms);
  const screenshot=name=>page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
  const toResponse=async()=>{
    for(let i=0;i<8;i++){const s=await state();if(s.phase==='response')return;if(s.phase==='feedback'||!s.phase)throw new Error(`Cannot advance ${s.phase}`);await advance(1500);}
    throw new Error('response not reached');
  };
  const complete=async(answerFn)=>{
    for(let i=0;i<90;i++){
      let s=await state();if(s.view==='results')return;
      await toResponse();s=await state();
      await page.locator(answerFn(s.trial)?'#answer-yes':'#answer-no').click();
      await advance(400);
    }
    throw new Error('round did not finish');
  };
  const beginFormal=async()=>{await page.locator('#direct-start').click();await page.getByRole('button',{name:'开灯，开始观察',exact:true}).click();};
  try{
    await page.goto(url);await page.waitForFunction(()=>typeof window.render_game_to_text==='function');
    assert.equal((await state()).view,'home');assert.equal((await state()).historyCount,0);
    await screenshot('01-home');pass('Offline file:// startup, empty history, desktop layout');
    await page.locator('[data-view="lab"]').first().click();
    assert.equal(await page.locator('#distribution-chart svg').count(),1);
    const setRange=async(id,value)=>page.locator(id).evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},String(value));
    const labText=()=>page.locator('#lab-metrics').innerText();
    const before=await labText();await setRange('#lab-c',1);assert.notEqual(await labText(),before);
    const hitBefore=await page.locator('#lab-metrics b').nth(0).innerText();
    await setRange('#lab-prior',.8);assert.equal(await page.locator('#lab-metrics b').nth(0).innerText(),hitBefore);
    await setRange('#lab-d',0);assert.equal(await page.locator('#lab-metrics b').nth(0).innerText(),await page.locator('#lab-metrics b').nth(1).innerText());
    for(const [d,c] of [[6,3],[6,-3],[0,-3],[0,3]]){await setRange('#lab-d',d);await setRange('#lab-c',c);assert.equal(await page.locator('#lab').evaluate(el=>/NaN|Infinity/.test(el.innerHTML)),false);}
    await page.locator('#lab-reset').click();await screenshot('04-lab');pass('d′/c/prior linked model, zero sensitivity, boundary SVGs');
    await page.locator('.nav [data-view="home"]').click();
    await page.selectOption('#trial-count','20');await page.selectOption('#difficulty','6');await page.selectOption('#prior','0.25');
    await page.locator('#start-btn').click();
    await advance(380);assert.equal((await state()).phase,'sample');
    await screenshot('02-practice-sample');
    for(let i=0;i<6;i++){await toResponse();await page.locator(i%2===0?'#answer-yes':'#answer-no').click();assert.equal((await state()).historyCount,0);await page.locator('#practice-next').click();}
    await page.getByRole('button',{name:'开灯，开始观察',exact:true}).click();
    assert.equal((await state()).practice,false);assert.equal((await state()).total,20);pass('Six practice trials excluded; formal configuration preserved');
    await advance(380);assert.equal((await state()).phase,'sample');
    await page.keyboard.press('ArrowRight');assert.equal((await state()).answered,0);
    await page.locator('#pause-btn').click();assert.equal((await state()).paused,true);assert.equal((await state()).interrupted,1);
    await advance(5000);assert.equal((await state()).answered,0);
    await page.getByRole('button',{name:'继续观察',exact:true}).click();assert.equal((await state()).trial,1);
    await toResponse();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');assert.equal((await state()).answered,1);
    await advance(400);pass('Sample input ignored, pause discards stimulus, duplicate answers ignored');
    await toResponse();
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'hidden',{configurable:true,value:false});});
    assert.equal((await state()).paused,true);assert.equal((await state()).answered,1);await page.keyboard.press('Escape');assert.equal((await state()).paused,false);
    pass('Hidden tab pauses; Escape resumes without inventing an answer');
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal((await state()).paused,true);await page.keyboard.press('Escape');assert.equal((await state()).paused,false);
    pass('Window blur pauses an unfinished trial');
    await complete(()=>true);
    const r=(await state()).lastResult;assert.equal(r.n,20);assert.equal(r.ns,5);assert.equal(r.nn,15);assert.equal(r.counts.H,5);assert.equal(r.counts.FA,15);assert.ok(Number.isFinite(r.dPrime));assert.ok(Number.isFinite(r.criterion));
    await screenshot('03-results');pass('20-trial all-yes round, exact prior quotas, finite corrected statistics');
    const dl=page.waitForEvent('download');await page.locator('#result-csv').click();const download=await dl;await download.saveAs(path.join(out,'qa-round.csv'));assert.ok(fs.readFileSync(path.join(out,'qa-round.csv'),'utf8').includes('虚报'));
    await page.locator('.nav [data-view="home"]').click();await page.locator('#challenge-start').click();await page.getByRole('button',{name:'已熟悉，直接开始',exact:true}).click();await page.getByRole('button',{name:'开灯，开始观察',exact:true}).click();
    await complete(i=>i%3!==0);assert.equal(await page.locator('#result-next-challenge').isVisible(),true);
    await page.locator('#result-next-challenge').click();await page.getByRole('button',{name:'开灯，开始观察',exact:true}).click();await complete(i=>i%3===0);
    assert.equal((await state()).historyCount,3);await page.locator('#result-compare').click();
    assert.equal(await page.locator('#comparison-section').isVisible(),true);assert.equal(await page.locator('[data-session]:checked').count(),2);
    assert.ok(await page.locator('#comparison-chart svg').count()>=1);assert.equal(await page.locator('#history').evaluate(el=>/NaN|Infinity/.test(el.innerHTML)),false);
    await screenshot('05-history');pass('Two-round strategy challenge, matched conditions, comparison and CSV export');
    const serialized=await page.evaluate(()=>PaperStore.serialize(PaperStore.load().sessions));
    assert.equal(JSON.parse(serialized).sessions.length,3);
    await page.reload();await page.locator('.nav [data-view="history"]').click();assert.equal(await page.locator('[data-session]').count(),3);pass('Completed sessions survive reload in this browser');
    await page.locator('#import-file').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{broken')});await page.waitForFunction(()=>document.getElementById('toast').textContent.startsWith('未导入'));assert.equal(await page.locator('[data-session]').count(),3);pass('Malformed import rejected without losing existing records');
    await page.locator('#clear-history').click();await page.locator('#modal-actions').getByRole('button',{name:'清空记录',exact:true}).click();assert.equal((await state()).historyCount,0);
    await page.locator('#import-file').setInputFiles({name:'records.json',mimeType:'application/json',buffer:Buffer.from(serialized)});await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).historyCount===3);pass('JSON export/clear/import round trip');
    await page.locator('#toast').waitFor({state:'hidden'});
    await page.setViewportSize({width:390,height:844});await page.locator('.nav [data-view="home"]').click();await screenshot('06-mobile-home');
    for(const next of ['home','lab','history']){await page.locator(`.nav [data-view="${next}"]`).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`overflow in ${next}`);}
    await screenshot('07-mobile-history');pass('390px mobile pages have no horizontal overflow');
    await page.locator('.nav [data-view="home"]').click();await beginFormal();await toResponse();await screenshot('08-mobile-play');await page.locator('#exit-btn').click();await page.getByRole('button',{name:'结束并离开',exact:true}).click();assert.equal((await state()).historyCount,3);pass('Incomplete round exit does not save a result');
    await page.setViewportSize({width:1440,height:1050});await page.selectOption('#trial-count','40');await beginFormal();assert.equal((await state()).total,40);
    await toResponse();await page.keyboard.press('f');await page.waitForFunction(()=>Boolean(document.fullscreenElement));
    await complete(i=>i%2===0);assert.equal((await state()).historyCount,4);assert.equal((await state()).lastResult.n,40);await page.waitForFunction(()=>!document.fullscreenElement);
    await screenshot('09-default-results');pass('Default 40-trial round completes and automatically exits fullscreen');
    const isolated=await browser.newContext({viewport:{width:1280,height:900}});await isolated.setOffline(true);await isolated.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError');}}));
    const p2=await isolated.newPage();await p2.goto(url);await p2.waitForFunction(()=>typeof window.render_game_to_text==='function');await p2.locator('.nav [data-view="history"]').click();assert.match(await p2.locator('#history-storage-note').innerText(),/页面内/);await isolated.close();pass('Storage disabled: page still works with in-memory fallback');
    assert.deepEqual(errors,[]);pass('No browser console errors');
    fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({at:new Date().toISOString(),mode:'offline file://',browser:await browser.version(),checks,errors},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
