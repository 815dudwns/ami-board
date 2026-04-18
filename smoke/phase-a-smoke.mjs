import puppeteer from 'puppeteer';

const BASE_URL = 'http://localhost:8080';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function runTests() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const results = {};
  const errors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      // 404 리소스 로딩 에러는 무시 (외부 라이브러리 등)
      if (!msg.text().includes('404')) {
        errors.push(msg.text());
      }
    }
  });

  try {
    // Scenario A: Onboarding
    console.log('=== Scenario A: 신규 사용자 온보딩 ===');
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });

    const settingsVisible = await page.evaluate(() => {
      const main = document.querySelector('#page-main');
      const settings = document.querySelector('#page-settings');
      return settings?.offsetParent !== null && main?.offsetParent === null;
    });
    console.log('  1. Settings 페이지 진입:', settingsVisible ? 'PASS' : 'FAIL');

    // 공사명 입력 및 추가
    await page.focus('#project-input');
    await page.keyboard.type('테스트공사');
    await page.click('#btn-add-project');
    await sleep(300);

    const projectAdded = await page.evaluate(() => {
      const list = document.querySelector('#project-list');
      if (!list) return false;
      return list.textContent.includes('테스트공사');
    });
    console.log('  2. 공사명 입력 후 목록 추가:', projectAdded ? 'PASS' : 'FAIL');

    // 작업원 입력 (IME 테스트)
    await page.focus('#worker-input');
    await page.keyboard.type('우영준', { delay: 50 });
    await page.click('#btn-add-worker');
    await sleep(300);

    const workerAdded = await page.evaluate(() => {
      const list = document.querySelector('#worker-list');
      if (!list) return false;
      return list.textContent.includes('우영준');
    });
    console.log('  3. 작업원 입력 (IME):', workerAdded ? 'PASS' : 'FAIL');

    // 완료 버튼 클릭
    await page.click('#btn-onboarding-done').catch(() => {});
    await sleep(1000);

    const mainVisible = await page.evaluate(() => {
      const main = document.querySelector('#page-main');
      return main?.offsetParent !== null;
    });
    console.log('  4. 메인 페이지 진입:', mainVisible ? 'PASS' : 'FAIL');

    // Datalist 확인
    const workerInList = await page.evaluate(() => {
      const datalist = document.querySelector('#worker-datalist');
      if (!datalist) return false;
      return Array.from(datalist.querySelectorAll('option')).some(opt =>
        opt.value.includes('우영준')
      );
    });
    console.log('  5. 작업원 datalist 반영:', workerInList ? 'PASS' : 'FAIL');
    results['Scenario A'] = settingsVisible && projectAdded && workerAdded && mainVisible && workerInList ? 'PASS' : 'FAIL';

    // Scenario B: Settings roundtrip
    console.log('\n=== Scenario B: 설정 ↔ 메인 datalist 갱신 ===');
    await page.click('#btn-go-settings');
    await sleep(500);

    await page.focus('#worker-input');
    await page.keyboard.type('김테스트', { delay: 50 });
    await page.click('#btn-add-worker');
    await sleep(300);

    const newWorkerAdded = await page.evaluate(() => {
      const list = document.querySelector('#worker-list');
      if (!list) return false;
      return list.textContent.includes('김테스트');
    });
    console.log('  1. 작업원 추가:', newWorkerAdded ? 'PASS' : 'FAIL');

    await page.click('#btn-go-main');
    await sleep(500);

    const newWorkerReflected = await page.evaluate(() => {
      const datalist = document.querySelector('#worker-datalist');
      if (!datalist) return false;
      return Array.from(datalist.querySelectorAll('option')).some(opt =>
        opt.value.includes('김테스트')
      );
    });
    console.log('  2. 메인 반영 (새로고침 없이):', newWorkerReflected ? 'PASS' : 'FAIL');
    results['Scenario B'] = newWorkerAdded && newWorkerReflected ? 'PASS' : 'FAIL';

    // Scenario C: Legacy UI hidden
    console.log('\n=== Scenario C: v1 UI 숨김 확인 ===');
    const crewsHidden = await page.evaluate(() => {
      const elem = document.querySelector('#section-crews');
      return !elem || window.getComputedStyle(elem).display === 'none';
    });
    console.log('  1. #section-crews hidden:', crewsHidden ? 'PASS' : 'FAIL');

    const copyRowHidden = await page.evaluate(() => {
      const elem = document.querySelector('.session-copy-row');
      return !elem || window.getComputedStyle(elem).display === 'none';
    });
    console.log('  2. .session-copy-row hidden:', copyRowHidden ? 'PASS' : 'FAIL');
    results['Scenario C'] = crewsHidden && copyRowHidden ? 'PASS' : 'FAIL';

    // Scenario D: Console errors
    console.log('\n=== Scenario D: 콘솔 에러 ===');
    const hasErrors = errors.length > 0;
    console.log('  에러 수:', hasErrors ? `FAIL (${errors.length})` : 'PASS (0)');
    if (hasErrors) errors.forEach(e => console.log(`    - ${e}`));
    results['Scenario D'] = !hasErrors ? 'PASS' : 'FAIL';

  } catch (error) {
    console.error('테스트 중 예외:', error.message);
    console.error('스택:', error.stack);
  } finally {
    await browser.close();
  }

  console.log('\n=== 최종 결과 ===');
  Object.entries(results).forEach(([k, v]) => console.log(`${k}: ${v}`));
  process.exit(Object.values(results).every(v => v === 'PASS') ? 0 : 1);
}

runTests().catch(console.error);
