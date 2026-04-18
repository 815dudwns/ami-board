/**
 * phase-c-smoke.mjs — Phase C 스모크 테스트
 *
 * 시나리오:
 *   1. "자동 입히기" 버튼 존재 + 클릭 가능
 *   2. 공사명/작업원 미선택 시 클릭 → 알림 + 중단 (버튼 다시 활성)
 *   3. 공통필드 매치 있을 때 office/workplace 프리필 + 배너 표시
 *   4. 공통필드 매치 없을 때 GPS 경로 (getCurrentPosition 스텁)
 *   5. 파일 입력 트리거 — auto-file-* 에 capture 속성 없음 확인
 *   6. 합성 미리보기 그리드 렌더 + "저장 + 밴드 열기" 버튼 placeholder 존재
 *   7. console.error 0건
 */

import puppeteer from 'puppeteer';

const BASE_URL = 'http://localhost:8080';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function runTests() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox']
  });

  const context = browser.defaultBrowserContext();
  await context.overridePermissions(BASE_URL, ['geolocation']);

  const page = await browser.newPage();
  await page.setGeolocation({ latitude: 37.5665, longitude: 126.9780 });

  const results = {};
  const consoleErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const txt = msg.text();
      if (
        !txt.includes('404') &&
        !txt.includes('net::ERR') &&
        !txt.includes('Failed to load resource')
      ) {
        consoleErrors.push(txt);
      }
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push('pageerror: ' + err.message);
  });

  // alert/confirm 핸들러
  const dialogs = [];
  page.on('dialog', async dialog => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    await dialog.accept();
  });

  try {
    // =========================================================
    // 공통 셋업: 신규 사용자 → 온보딩 → 메인
    // =========================================================
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
    await sleep(300);

    // 공사명 + 작업원 등록 → 완료
    await page.focus('#project-input');
    await page.keyboard.type('2025년AMI보강공사');
    await page.click('#btn-add-project');
    await sleep(200);

    await page.focus('#worker-input');
    await page.keyboard.type('우영준');
    await page.click('#btn-add-worker');
    await sleep(200);

    await page.click('#btn-onboarding-done');
    await sleep(800);

    // =========================================================
    // Scenario 1: "자동 입히기" 버튼 존재 + 클릭 가능
    // =========================================================
    console.log('\n=== Scenario 1: 자동 입히기 버튼 존재 ===');

    const btnExists = await page.evaluate(() => {
      const btn = document.getElementById('btn-autofill');
      return !!btn && btn.tagName === 'BUTTON' && !btn.disabled;
    });
    console.log('  1. 버튼 존재 + 활성:', btnExists ? 'PASS' : 'FAIL');
    results['Scenario 1'] = btnExists ? 'PASS' : 'FAIL';

    // =========================================================
    // Scenario 2: 공사명/작업원 미선택 → 알림 + 중단
    // =========================================================
    console.log('\n=== Scenario 2: 선행 조건 미충족 → 알림 + 중단 ===');

    // 작업원 체크 해제
    const hasChip = await page.evaluate(() => {
      const cb = document.querySelector('#worker-chips input[type="checkbox"]');
      if (cb && cb.checked) { cb.click(); return true; }
      return !!cb;
    });
    await sleep(200);

    dialogs.length = 0;
    await page.click('#btn-autofill');
    await sleep(300);

    const alertShown = dialogs.some(d => d.type === 'alert');
    const btnStillActive = await page.evaluate(() => {
      const btn = document.getElementById('btn-autofill');
      return btn && !btn.disabled;
    });
    console.log('  2a. 알림 표시:', alertShown ? 'PASS' : 'FAIL');
    console.log('  2b. 버튼 복귀(활성):', btnStillActive ? 'PASS' : 'FAIL');
    results['Scenario 2'] = (alertShown && btnStillActive) ? 'PASS' : 'FAIL';

    // =========================================================
    // Scenario 3: sessionHistory 매치 → office/workplace 프리필 + 배너
    // =========================================================
    console.log('\n=== Scenario 3: 매치 있음 → 프리필 + 배너 ===');

    // 세션 히스토리 주입 + 작업원 체크 복원
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('ami-board-state') || '{}');
      state.sessionHistory = [{
        projectName: '2025년AMI보강공사',
        workers: ['우영준'],
        office: '마포용산지사',
        workplace: '서울시 마포구 합정동 매치테스트',
        workplaceCoord: { lat: 37.549, lng: 126.913 },
        timestamp: new Date().toISOString()
      }];
      state.lastSelected = state.lastSelected || {};
      state.lastSelected.workers = ['우영준'];
      state.lastSelected.projectName = '2025년AMI보강공사';
      localStorage.setItem('ami-board-state', JSON.stringify(state));
    });

    // 메인 재진입
    await page.evaluate(() => { location.hash = '#/settings'; });
    await sleep(200);
    await page.evaluate(() => { location.hash = '#/'; });
    await sleep(500);

    // 작업원 체크 확인
    const workerChecked3 = await page.evaluate(() => {
      const cb = document.querySelector('#worker-chips input[type="checkbox"]');
      return cb && cb.checked;
    });

    if (!workerChecked3) {
      // 수동 체크
      await page.click('#worker-chips label');
      await sleep(200);
    }

    // triggerMatchCheck는 칩 변경 시 자동 실행됨
    // 자동 입히기 1단계 수동 검증: Storage.findMatchingSession 직접 확인
    const matchResult3 = await page.evaluate(() => {
      const matched = Storage.findMatchingSession(
        '2025년AMI보강공사',
        ['우영준']
      );
      return {
        hasMatch: !!matched,
        workplace: matched ? matched.workplace : ''
      };
    });

    console.log('  3a. sessionHistory 매치:', matchResult3.hasMatch ? 'PASS' : 'FAIL');
    console.log('  3b. workplace 값:', matchResult3.workplace.includes('합정동') ? 'PASS' : `FAIL (got: "${matchResult3.workplace}")`);

    // 배너 + workplace 프리필은 triggerMatchCheck가 이미 실행했을 것
    const bannerVisible = await page.evaluate(() => {
      const banner = document.getElementById('match-banner');
      return banner && banner.style.display !== 'none';
    });
    const workplaceVal = await page.evaluate(() => {
      return document.getElementById('workplace').value;
    });
    console.log('  3c. 배너 표시:', bannerVisible ? 'PASS' : 'FAIL');
    console.log('  3d. workplace 프리필:', workplaceVal.includes('합정동') ? 'PASS' : `FAIL (got: "${workplaceVal}")`);

    results['Scenario 3'] = (matchResult3.hasMatch && bannerVisible && workplaceVal.includes('합정동')) ? 'PASS' : 'FAIL';

    // =========================================================
    // Scenario 4: 매치 없음 → GPS 경로 실제 호출 확인
    // =========================================================
    console.log('\n=== Scenario 4: 매치 없음 → GPS 경로 (실제 호출) ===');

    // getCurrentPosition 스텁 주입 (navigateOnNewDocument로 새 페이지 로딩 시 적용)
    await page.evaluateOnNewDocument(() => {
      window._geoCalledCount = 0;
      Object.defineProperty(navigator, 'geolocation', {
        get: function () {
          return {
            getCurrentPosition: function (success) {
              window._geoCalledCount = (window._geoCalledCount || 0) + 1;
              success({ coords: { latitude: 37.5665, longitude: 126.9780 } });
            }
          };
        },
        configurable: true
      });
    });

    // 빈 sessionHistory + 작업원 기록으로 재설정
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('ami-board-state') || '{}');
      state.sessionHistory = [];
      state.lastSelected = state.lastSelected || {};
      state.lastSelected.workplace = '';
      state.lastSelected.workers = ['우영준'];
      state.lastSelected.projectName = '2025년AMI보강공사';
      localStorage.setItem('ami-board-state', JSON.stringify(state));
    });

    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
    await sleep(300);

    // 작업원 체크 확인
    const workerChecked4 = await page.evaluate(() => {
      const cb = document.querySelector('#worker-chips input[type="checkbox"]');
      return cb && cb.checked;
    });
    if (!workerChecked4) {
      await page.click('#worker-chips label').catch(() => {});
      await sleep(200);
    }

    // 자동 입히기 클릭 → 1단계(GPS) 실행 후 2단계 프롬프트 대기
    dialogs.length = 0;
    await page.click('#btn-autofill');
    await sleep(800); // GPS + step2 프롬프트 대기

    const geoCalledCount = await page.evaluate(() => window._geoCalledCount || 0);
    const promptVisible = await page.evaluate(() => {
      const prompt = document.getElementById('autofill-prompt');
      return prompt && prompt.style.display !== 'none';
    });

    console.log('  4a. getCurrentPosition 호출:', geoCalledCount >= 1 ? `PASS (${geoCalledCount}회)` : 'FAIL (0회)');
    console.log('  4b. 2단계 프롬프트 표시:', promptVisible ? 'PASS' : 'FAIL');

    // 건너뛰기로 플로우 중단
    await page.click('#btn-autofill-skip').catch(() => {});
    await sleep(200);
    await page.click('#btn-autofill-skip').catch(() => {});
    await sleep(200);
    // vehicle 루프 건너뛰기
    await page.click('#btn-autofill-skip').catch(() => {});
    await sleep(800);

    results['Scenario 4'] = (geoCalledCount >= 1 && promptVisible) ? 'PASS' : 'FAIL';

    // =========================================================
    // Scenario 5: auto-file-* inputs에 capture 속성 없음 확인
    // =========================================================
    console.log('\n=== Scenario 5: file input capture 속성 없음 ===');

    const captureCheck = await page.evaluate(() => {
      const inputs = [
        document.getElementById('auto-file-workers'),
        document.getElementById('auto-file-documents'),
        document.getElementById('auto-file-vehicle'),
        // 보조 UI도 확인
        document.getElementById('file-workers'),
        document.getElementById('file-documents'),
        document.getElementById('file-vehicles')
      ];

      const issues = [];
      inputs.forEach(function (inp) {
        if (!inp) return;
        if (inp.hasAttribute('capture')) {
          issues.push(inp.id + ' has capture');
        }
      });

      const autoWorkers = !!document.getElementById('auto-file-workers');
      const autoDocs = !!document.getElementById('auto-file-documents');
      const autoVehicle = !!document.getElementById('auto-file-vehicle');

      return {
        allExist: autoWorkers && autoDocs && autoVehicle,
        noCapture: issues.length === 0,
        issues: issues
      };
    });

    console.log('  5a. auto-file-* inputs 존재:', captureCheck.allExist ? 'PASS' : 'FAIL');
    console.log('  5b. capture 속성 없음:', captureCheck.noCapture ? 'PASS' : `FAIL (${captureCheck.issues.join(', ')})`);
    results['Scenario 5'] = (captureCheck.allExist && captureCheck.noCapture) ? 'PASS' : 'FAIL';

    // =========================================================
    // Scenario 6: 합성 미리보기 그리드 + "저장 + 밴드 열기" 버튼
    // =========================================================
    console.log('\n=== Scenario 6: 미리보기 그리드 + 저장+밴드 버튼 ===');

    const gridCheck = await page.evaluate(() => {
      const grid = document.getElementById('preview-grid');
      const items = document.getElementById('preview-grid-items');
      const saveBand = document.getElementById('btn-save-band');
      return {
        gridExists: !!grid,
        itemsExists: !!items,
        saveBandExists: !!saveBand,
        saveBandDisabled: saveBand ? saveBand.disabled : false
      };
    });

    console.log('  6a. #preview-grid 존재:', gridCheck.gridExists ? 'PASS' : 'FAIL');
    console.log('  6b. #preview-grid-items 존재:', gridCheck.itemsExists ? 'PASS' : 'FAIL');
    console.log('  6c. #btn-save-band 존재:', gridCheck.saveBandExists ? 'PASS' : 'FAIL');
    console.log('  6d. #btn-save-band disabled(placeholder):', gridCheck.saveBandDisabled ? 'PASS' : 'FAIL');

    // "저장 + 밴드 열기" 클릭 시 Phase D 예정 알림 확인
    if (gridCheck.saveBandExists) {
      // grid 표시 + disabled 해제 후 테스트 (hidden 요소 클릭 불가 우회)
      await page.evaluate(() => {
        const grid = document.getElementById('preview-grid');
        grid.style.display = 'block';
        document.getElementById('btn-save-band').disabled = false;
      });
      await sleep(100);
      dialogs.length = 0;
      await page.click('#btn-save-band');
      await sleep(200);
      const phaseDAlertsShown = dialogs.some(d => d.message && d.message.includes('Phase D'));
      console.log('  6e. Phase D 알림:', phaseDAlertsShown ? 'PASS' : 'FAIL');
      // 복원
      await page.evaluate(() => {
        document.getElementById('preview-grid').style.display = 'none';
        document.getElementById('btn-save-band').disabled = true;
      });
    }

    results['Scenario 6'] = (
      gridCheck.gridExists &&
      gridCheck.itemsExists &&
      gridCheck.saveBandExists &&
      gridCheck.saveBandDisabled
    ) ? 'PASS' : 'FAIL';

    // =========================================================
    // Scenario 7: console.error 0건
    // =========================================================
    console.log('\n=== Scenario 7: console.error 0건 ===');
    const hasErrors = consoleErrors.length > 0;
    console.log('  에러 수:', hasErrors ? `FAIL (${consoleErrors.length}건)` : 'PASS (0건)');
    if (hasErrors) consoleErrors.forEach(e => console.log(`    - ${e}`));
    results['Scenario 7'] = !hasErrors ? 'PASS' : 'FAIL';

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
