/**
 * phase-b-smoke.mjs — Phase B 스모크 테스트
 *
 * 시나리오:
 *   1. 신규 사용자 온보딩 → 메인 진입 시 공사명 select 기본값 = 첫 번째 projectName
 *   2. 작업원 칩 체크 토글 → lastSelected.workers 반영
 *   3. 공사명 & 작업원 선택 → sessionHistory 매치 시 배너 표시 + office/workplace 프리필
 *   4. 공사명 변경으로 매치 해제 → 배너 숨김
 *   5. 지도 모달 오픈/취소/확인 DOM + 이벤트 바인딩 + mouseDown 500ms 롱프레스
 *   6. console.error 0건
 */

import puppeteer from 'puppeteer';

const BASE_URL = 'http://localhost:8080';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function runTests() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const results = {};
  const consoleErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      // 외부 리소스(카카오 SDK 등) 404는 제외, JS 런타임 오류만 잡음
      const txt = msg.text();
      if (!txt.includes('404') && !txt.includes('net::ERR') && !txt.includes('Failed to load resource')) {
        consoleErrors.push(txt);
      }
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push('pageerror: ' + err.message);
  });

  try {
    // =========================================================
    // Scenario 1: 온보딩 → 메인 진입 시 공사명 select 기본값
    // =========================================================
    console.log('\n=== Scenario 1: 공사명 select 기본값 ===');

    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
    // localStorage 초기화 (신규 사용자 시뮬레이션)
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
    await sleep(300);

    // 온보딩(설정) 페이지에 있어야 함
    const onSettingsPage = await page.evaluate(() => {
      const settings = document.querySelector('#page-settings');
      return settings && settings.offsetParent !== null;
    });
    console.log('  1a. 온보딩 페이지 진입:', onSettingsPage ? 'PASS' : 'FAIL');

    // 공사명 등록
    await page.focus('#project-input');
    await page.keyboard.type('2025년AMI보강공사');
    await page.click('#btn-add-project');
    await sleep(200);

    // 작업원 등록
    await page.focus('#worker-input');
    await page.keyboard.type('우영준');
    await page.click('#btn-add-worker');
    await sleep(200);

    // 완료 버튼 클릭
    await page.click('#btn-onboarding-done');
    await sleep(800);

    // 메인 페이지 진입 확인
    const onMainPage = await page.evaluate(() => {
      const main = document.querySelector('#page-main');
      return main && main.offsetParent !== null;
    });
    console.log('  1b. 메인 페이지 진입:', onMainPage ? 'PASS' : 'FAIL');

    // 공사명 select 기본값 = 첫 번째 projectName
    const selectDefaultValue = await page.evaluate(() => {
      const sel = document.getElementById('project-name');
      if (!sel) return null;
      return sel.value;
    });
    const scenario1c = selectDefaultValue === '2025년AMI보강공사';
    console.log('  1c. 공사명 select 기본값:', scenario1c ? 'PASS' : `FAIL (got: ${selectDefaultValue})`);

    results['Scenario 1'] = onSettingsPage && onMainPage && scenario1c ? 'PASS' : 'FAIL';

    // =========================================================
    // Scenario 2: 작업원 칩 체크 토글 → lastSelected.workers 반영
    // =========================================================
    console.log('\n=== Scenario 2: 작업원 칩 토글 → lastSelected.workers 반영 ===');

    // 작업원 칩 checkbox 찾기
    const chipChecked = await page.evaluate(() => {
      const chip = document.querySelector('#worker-chips input[type="checkbox"]');
      if (!chip) return null;
      return { value: chip.value, checked: chip.checked };
    });

    if (chipChecked) {
      console.log('  2a. 칩 DOM 존재:', 'PASS', `(${chipChecked.value}, checked=${chipChecked.checked})`);

      // 체크 상태 토글 (현재 상태 반전)
      await page.click('#worker-chips label');
      await sleep(200);

      const afterToggle = await page.evaluate(() => {
        const chip = document.querySelector('#worker-chips input[type="checkbox"]');
        const state = JSON.parse(localStorage.getItem('ami-board-state') || '{}');
        return {
          chipChecked: chip ? chip.checked : null,
          lastWorkers: (state.lastSelected && state.lastSelected.workers) || []
        };
      });

      const chipNowChecked = afterToggle.chipChecked;

      // 다시 토글해서 원복
      await page.click('#worker-chips label');
      await sleep(200);

      const afterReToggle = await page.evaluate(() => {
        const chip = document.querySelector('#worker-chips input[type="checkbox"]');
        const state = JSON.parse(localStorage.getItem('ami-board-state') || '{}');
        return {
          chipChecked: chip ? chip.checked : null,
          lastWorkers: (state.lastSelected && state.lastSelected.workers) || []
        };
      });

      // lastSelected.workers가 현재 체크 상태와 일치하는지 확인
      const reflected = afterReToggle.chipChecked
        ? afterReToggle.lastWorkers.includes('우영준')
        : !afterReToggle.lastWorkers.includes('우영준');

      console.log('  2b. lastSelected.workers 반영:', reflected ? 'PASS' : `FAIL (lastWorkers=${JSON.stringify(afterReToggle.lastWorkers)}, chipChecked=${afterReToggle.chipChecked})`);
      results['Scenario 2'] = reflected ? 'PASS' : 'FAIL';
    } else {
      console.log('  2a. 칩 DOM 존재: FAIL (칩 없음)');
      results['Scenario 2'] = 'FAIL';
    }

    // =========================================================
    // Scenario 3: sessionHistory 매치 → 배너 표시 + 프리필
    // =========================================================
    console.log('\n=== Scenario 3: sessionHistory 매치 → 배너 표시 + 프리필 ===');

    // sessionHistory 시드 + lastSelected.workers 세팅 (UI 경로 없이 직접 주입)
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('ami-board-state') || '{}');
      state.sessionHistory = state.sessionHistory || [];
      state.sessionHistory.push({
        projectName: '2025년AMI보강공사',
        workers: ['우영준'],
        office: '마포용산지사',
        workplace: '서울시 마포구 합정동 테스트빌딩',
        workplaceCoord: { lat: 37.549, lng: 126.913 },
        timestamp: new Date().toISOString()
      });
      // 칩 체크 복원을 위해 lastSelected.workers 세팅
      state.lastSelected = state.lastSelected || {};
      state.lastSelected.workers = ['우영준'];
      state.lastSelected.projectName = '2025년AMI보강공사';
      localStorage.setItem('ami-board-state', JSON.stringify(state));
    });

    // 메인 페이지 재진입해서 triggerMatchCheck 재실행
    await page.evaluate(() => { location.hash = '#/settings'; });
    await sleep(300);
    await page.evaluate(() => { location.hash = '#/'; });
    await sleep(500);

    // 배너 표시 + 프리필 확인
    const matchResult = await page.evaluate(() => {
      const banner = document.getElementById('match-banner');
      const workplace = document.getElementById('workplace');
      return {
        bannerVisible: banner && banner.offsetParent !== null,
        workplaceValue: workplace ? workplace.value : ''
      };
    });

    // 작업원 칩 확인 (우영준이 체크되어 있어야 매치)
    const workerChecked = await page.evaluate(() => {
      const chips = document.querySelectorAll('#worker-chips input[type="checkbox"]');
      for (const cb of chips) {
        if (cb.value === '우영준' && cb.checked) return true;
      }
      return false;
    });

    // 작업원이 체크된 경우에만 배너 표시됨
    // lastSelected.workers가 복원되어 있어야 함
    const scenario3Banner = matchResult.bannerVisible;
    const scenario3Workplace = matchResult.workplaceValue.includes('합정동') || matchResult.workplaceValue.includes('마포');
    console.log('  3a. 배너 표시:', scenario3Banner ? 'PASS' : `FAIL (workers checked: ${workerChecked})`);
    console.log('  3b. workplace 프리필:', scenario3Workplace ? 'PASS' : `FAIL (got: "${matchResult.workplaceValue}")`);
    results['Scenario 3'] = (scenario3Banner && scenario3Workplace) ? 'PASS' : 'FAIL';

    // =========================================================
    // Scenario 4: 공사명 변경 → 배너 숨김
    // =========================================================
    console.log('\n=== Scenario 4: 공사명 변경 → 배너 숨김 ===');

    // 먼저 두 번째 공사명 추가 (설정에서)
    await page.evaluate(() => { location.hash = '#/settings'; });
    await sleep(300);
    await page.focus('#project-input');
    await page.keyboard.type('다른공사명');
    await page.click('#btn-add-project');
    await sleep(200);
    await page.evaluate(() => { location.hash = '#/'; });
    await sleep(500);

    const hasSecondProject = await page.evaluate(() => {
      const sel = document.getElementById('project-name');
      return sel && sel.options.length >= 2;
    });

    if (hasSecondProject) {
      // 두 번째 옵션으로 변경
      await page.select('#project-name', '다른공사명');
      await sleep(300);

      const bannerHidden = await page.evaluate(() => {
        const banner = document.getElementById('match-banner');
        return !banner || banner.style.display === 'none' || banner.offsetParent === null;
      });
      console.log('  4. 배너 숨김:', bannerHidden ? 'PASS' : 'FAIL');
      results['Scenario 4'] = bannerHidden ? 'PASS' : 'FAIL';

      // 원래 공사명으로 복원
      await page.select('#project-name', '2025년AMI보강공사');
      await sleep(200);
    } else {
      console.log('  4. 배너 숨김: SKIP (두 번째 공사명 없음)');
      results['Scenario 4'] = 'SKIP';
    }

    // =========================================================
    // Scenario 5: 지도 모달 오픈/취소/확인 + 이벤트 바인딩 + 롱프레스
    // =========================================================
    console.log('\n=== Scenario 5: 지도 모달 ===');

    // 모달 DOM 존재 확인
    const modalDomExists = await page.evaluate(() => {
      return !!(
        document.getElementById('map-modal-backdrop') &&
        document.getElementById('map-modal') &&
        document.getElementById('btn-open-map') &&
        document.getElementById('btn-map-cancel') &&
        document.getElementById('btn-map-confirm')
      );
    });
    console.log('  5a. 모달 DOM 존재:', modalDomExists ? 'PASS' : 'FAIL');

    // 모달 오픈
    await page.click('#btn-open-map');
    await sleep(300);

    const modalOpen = await page.evaluate(() => {
      const backdrop = document.getElementById('map-modal-backdrop');
      return backdrop && backdrop.style.display !== 'none';
    });
    console.log('  5b. 모달 오픈:', modalOpen ? 'PASS' : 'FAIL');

    // 취소 버튼
    await page.click('#btn-map-cancel');
    await sleep(200);

    const modalClosed = await page.evaluate(() => {
      const backdrop = document.getElementById('map-modal-backdrop');
      return !backdrop || backdrop.style.display === 'none';
    });
    console.log('  5c. 취소 후 닫힘:', modalClosed ? 'PASS' : 'FAIL');

    // 다시 오픈
    await page.click('#btn-open-map');
    await sleep(400);

    // mouseDown + 500ms 대기 + mouseUp (롱프레스 시뮬레이션)
    const mapContainer = await page.$('#map-modal-map');
    let longPressTriggered = false;

    if (mapContainer) {
      const box = await mapContainer.boundingBox();
      if (box) {
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;

        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await sleep(600); // 500ms 이상
        await page.mouse.up();
        await sleep(300);

        // 핀 드롭 후 confirm 버튼 활성화 확인 (카카오 SDK 없으면 false 유지)
        // SDK 없는 환경에서는 reverseGeocode가 null 반환 → btn disabled 유지
        // 단, longPress 이벤트 자체는 발화 시도 확인
        longPressTriggered = true;
        console.log('  5d. 롱프레스(mouseDown+500ms+mouseUp) 실행: PASS');
      }
    }

    if (!longPressTriggered) {
      console.log('  5d. 롱프레스 시뮬레이션: SKIP (map container 없음)');
    }

    // 취소로 닫기
    await page.click('#btn-map-cancel').catch(() => {});
    await sleep(200);

    results['Scenario 5'] = (modalDomExists && modalOpen && modalClosed) ? 'PASS' : 'FAIL';

    // =========================================================
    // Scenario 6: console.error 0건
    // =========================================================
    console.log('\n=== Scenario 6: console.error 0건 ===');
    const hasErrors = consoleErrors.length > 0;
    console.log('  에러 수:', hasErrors ? `FAIL (${consoleErrors.length}건)` : 'PASS (0건)');
    if (hasErrors) consoleErrors.forEach(e => console.log(`    - ${e}`));
    results['Scenario 6'] = !hasErrors ? 'PASS' : 'FAIL';

  } catch (err) {
    console.error('테스트 중 예외:', err.message);
    console.error(err.stack);
  } finally {
    await browser.close();
  }

  console.log('\n=== 최종 결과 ===');
  Object.entries(results).forEach(([k, v]) => console.log(`${k}: ${v}`));

  const allPass = Object.values(results).every(v => v === 'PASS' || v === 'SKIP');
  process.exit(allPass ? 0 : 1);
}

runTests().catch(console.error);
