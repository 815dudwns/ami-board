/**
 * phase-c-smoke.mjs — Phase C 스모크 테스트
 *
 * 시나리오:
 *   1. "자동 입히기" 버튼 존재 + 클릭 가능
 *   2. 공사명/작업원 미선택 시 클릭 → 알림 + 중단 (버튼 다시 활성)
 *   3. 공통필드 매치 있을 때 office/workplace 프리필 + 배너 표시
 *   4. 공통필드 매치 없을 때 GPS 경로 (getCurrentPosition 스텁)
 *   5. 파일 입력 트리거 — #auto-file-multi에 capture 속성 없음 확인
 *   6. 합성 미리보기 그리드 렌더 + "저장 + 밴드 열기" 버튼 placeholder 존재
 *   7. 사업소 select — (자동) + 7개 옵션 + 주소 blur 시 자동 매핑 검증
 *   8. console.error 0건
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
    // Scenario 4: 매치 없음 → GPS 경로 확인 + 멀티셀렉트 input 존재 확인
    //   Phase F: 순차 프롬프트 제거 → 멀티셀렉트 1회 플로우
    // =========================================================
    console.log('\n=== Scenario 4: 매치 없음 → GPS 경로 + 멀티셀렉트 input 존재 ===');

    // getCurrentPosition 스텁 주입
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

    // 빈 sessionHistory로 재설정
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

    // 멀티셀렉트 input 존재 확인 (Phase F 신규)
    const multiInputCheck = await page.evaluate(() => {
      const input = document.getElementById('auto-file-multi');
      return {
        exists: !!input,
        isMultiple: input ? input.multiple : false,
        hasNoCapture: input ? !input.hasAttribute('capture') : false,
        accept: input ? input.accept : ''
      };
    });

    console.log('  4a. #auto-file-multi 존재:', multiInputCheck.exists ? 'PASS' : 'FAIL');
    console.log('  4b. multiple 속성:', multiInputCheck.isMultiple ? 'PASS' : 'FAIL');
    console.log('  4c. capture 속성 없음:', multiInputCheck.hasNoCapture ? 'PASS' : 'FAIL');

    // GPS 호출 확인: step1CommonFields는 자동 입히기 클릭 시 실행
    // 파일 다이얼로그를 차단하여 GPS 단계까지만 실행 확인
    await page.evaluate(() => {
      // auto-file-multi click 스텁 (파일 다이얼로그 방지)
      const input = document.getElementById('auto-file-multi');
      if (input) {
        input._origClick = input.click.bind(input);
        input.click = function () { /* noop */ };
      }
    });

    const workerChecked4 = await page.evaluate(() => {
      const cb = document.querySelector('#worker-chips input[type="checkbox"]');
      return cb && cb.checked;
    });
    if (!workerChecked4) {
      await page.click('#worker-chips label').catch(() => {});
      await sleep(200);
    }

    dialogs.length = 0;
    await page.click('#btn-autofill');
    await sleep(1200); // GPS 완료 대기

    const geoCalledCount = await page.evaluate(() => window._geoCalledCount || 0);
    console.log('  4d. getCurrentPosition 호출:', geoCalledCount >= 1 ? `PASS (${geoCalledCount}회)` : 'FAIL (0회)');

    results['Scenario 4'] = (
      multiInputCheck.exists &&
      multiInputCheck.isMultiple &&
      multiInputCheck.hasNoCapture &&
      geoCalledCount >= 1
    ) ? 'PASS' : 'FAIL';

    // =========================================================
    // Scenario 5: file inputs에 capture 속성 없음 확인
    //   Phase F: auto-file-multi (멀티셀렉트) — 보조 UI는 DOM에서 제거됨
    // =========================================================
    console.log('\n=== Scenario 5: file input capture 속성 없음 ===');

    const captureCheck = await page.evaluate(() => {
      const autoMultiEl = document.getElementById('auto-file-multi');

      const issues = [];
      if (autoMultiEl && autoMultiEl.hasAttribute('capture')) {
        issues.push('auto-file-multi has capture');
      }

      return {
        allExist: !!autoMultiEl,
        noCapture: issues.length === 0,
        issues: issues
      };
    });

    console.log('  5a. #auto-file-multi 존재:', captureCheck.allExist ? 'PASS' : 'FAIL');
    console.log('  5b. capture 속성 없음:', captureCheck.noCapture ? 'PASS' : `FAIL (${captureCheck.issues.join(', ')})`);
    results['Scenario 5'] = (captureCheck.allExist && captureCheck.noCapture) ? 'PASS' : 'FAIL';

    // =========================================================
    // Scenario 6: 합성 미리보기 그리드 + 슬롯 카드 UI + 저장 버튼
    //   Phase F: 슬롯 카드 그리드 (#slot-cards, #slot-add-btn) 존재 확인
    // =========================================================
    console.log('\n=== Scenario 6: 미리보기 그리드 + 슬롯 카드 UI + 저장+밴드 버튼 ===');

    const gridCheck = await page.evaluate(() => {
      const grid = document.getElementById('preview-grid');
      const items = document.getElementById('preview-grid-items');
      const saveBand = document.getElementById('btn-save-band');
      const slotUI = document.getElementById('slot-assign-ui');
      const slotCards = document.getElementById('slot-cards');
      const slotAddBtn = document.getElementById('slot-add-btn');
      const composeBtn = document.getElementById('btn-compose-preview');
      return {
        gridExists: !!grid,
        itemsExists: !!items,
        saveBandExists: !!saveBand,
        saveBandDisabled: saveBand ? saveBand.disabled : false,
        slotUIExists: !!slotUI,
        slotCardsExists: !!slotCards,
        slotAddBtnExists: !!slotAddBtn,
        composeBtnExists: !!composeBtn
      };
    });

    console.log('  6a. #preview-grid 존재:', gridCheck.gridExists ? 'PASS' : 'FAIL');
    console.log('  6b. #preview-grid-items 존재:', gridCheck.itemsExists ? 'PASS' : 'FAIL');
    console.log('  6c. #btn-save-band 존재:', gridCheck.saveBandExists ? 'PASS' : 'FAIL');
    console.log('  6d. #btn-save-band disabled(초기):', gridCheck.saveBandDisabled ? 'PASS' : 'FAIL');
    console.log('  6e. #slot-assign-ui 존재(Phase F):', gridCheck.slotUIExists ? 'PASS' : 'FAIL');
    console.log('  6f. #slot-cards 존재(Phase F):', gridCheck.slotCardsExists ? 'PASS' : 'FAIL');
    console.log('  6g. #slot-add-btn 존재(Phase F):', gridCheck.slotAddBtnExists ? 'PASS' : 'FAIL');
    console.log('  6h. #btn-compose-preview 존재(Phase F):', gridCheck.composeBtnExists ? 'PASS' : 'FAIL');

    results['Scenario 6'] = (
      gridCheck.gridExists &&
      gridCheck.itemsExists &&
      gridCheck.saveBandExists &&
      gridCheck.saveBandDisabled &&
      gridCheck.slotUIExists &&
      gridCheck.slotCardsExists &&
      gridCheck.slotAddBtnExists &&
      gridCheck.composeBtnExists
    ) ? 'PASS' : 'FAIL';

    // =========================================================
    // Scenario 7: 사업소 select — (자동) + 7개 옵션 + 자동 매핑
    // =========================================================
    console.log('\n=== Scenario 7: 사업소 select 검증 ===');

    const officeCheck = await page.evaluate(() => {
      const sel = document.getElementById('field-office');
      if (!sel || sel.tagName !== 'SELECT') return { exists: false };

      const opts = Array.from(sel.options).map(o => ({ value: o.value, text: o.text }));
      const hasAuto = opts[0] && opts[0].value === '';
      const officeOptions = opts.filter(o => o.value !== '');
      const expectedOffices = [
        '강북성북지사', '동대문중랑지사', '서대문은평지사', '서울본부직할',
        '광진성동지사', '마포용산지사', '노원도봉지사'
      ];
      const allOfficesPresent = expectedOffices.every(
        name => officeOptions.some(o => o.value === name)
      );

      return {
        exists: true,
        hasAuto: hasAuto,
        optionCount: officeOptions.length,
        allOfficesPresent: allOfficesPresent
      };
    });

    console.log('  7a. #field-office select 존재:', officeCheck.exists ? 'PASS' : 'FAIL');
    console.log('  7b. (자동) 옵션 첫번째:', officeCheck.hasAuto ? 'PASS' : 'FAIL');
    console.log('  7c. 7개 지사 옵션 모두 존재:', officeCheck.allOfficesPresent ? 'PASS' : `FAIL (${officeCheck.optionCount}개)`);

    // 자동 매핑 검증: 마포구 주소 입력 → blur → 마포용산지사 자동 선택
    const autoMappingCheck = await page.evaluate(() => {
      const workplace = document.getElementById('workplace');
      const sel = document.getElementById('field-office');
      if (!workplace || !sel) return { mapped: false, error: 'element not found' };

      // 마포구 주소 입력
      workplace.value = '서울특별시 마포구 합정동 123';
      workplace.dispatchEvent(new Event('blur', { bubbles: true }));

      return { mapped: sel.value === '마포용산지사', value: sel.value };
    });
    console.log('  7d. 마포구 → 마포용산지사 자동 매핑:', autoMappingCheck.mapped ? 'PASS' : `FAIL (got: "${autoMappingCheck.value}")`);

    // 매핑 없는 구 → (자동) 유지 확인
    const noMappingCheck = await page.evaluate(() => {
      const workplace = document.getElementById('workplace');
      const sel = document.getElementById('field-office');
      if (!workplace || !sel) return { kept: false };

      workplace.value = '서울특별시 영등포구 여의도동 999';
      workplace.dispatchEvent(new Event('blur', { bubbles: true }));

      return { kept: sel.value === '', value: sel.value };
    });
    console.log('  7e. 영등포구(미매핑) → (자동) 유지:', noMappingCheck.kept ? 'PASS' : `FAIL (got: "${noMappingCheck.value}")`);

    // 수동 선택 후 주소 변경해도 유지 확인
    const manualKeepCheck = await page.evaluate(() => {
      const workplace = document.getElementById('workplace');
      const sel = document.getElementById('field-office');
      if (!workplace || !sel) return { kept: false };

      // 수동 선택
      sel.value = '노원도봉지사';
      sel.dispatchEvent(new Event('change', { bubbles: true }));

      // 마포구 주소로 변경해도 수동 선택 유지
      workplace.value = '서울특별시 마포구 합정동 456';
      workplace.dispatchEvent(new Event('blur', { bubbles: true }));

      return { kept: sel.value === '노원도봉지사', value: sel.value };
    });
    console.log('  7f. 수동 선택 후 주소 변경 → 수동값 유지:', manualKeepCheck.kept ? 'PASS' : `FAIL (got: "${manualKeepCheck.value}")`);

    results['Scenario 7'] = (
      officeCheck.exists &&
      officeCheck.hasAuto &&
      officeCheck.allOfficesPresent &&
      autoMappingCheck.mapped &&
      noMappingCheck.kept &&
      manualKeepCheck.kept
    ) ? 'PASS' : 'FAIL';

    // =========================================================
    // Scenario 8: console.error 0건
    // =========================================================
    console.log('\n=== Scenario 8: console.error 0건 ===');
    const hasErrors = consoleErrors.length > 0;
    console.log('  에러 수:', hasErrors ? `FAIL (${consoleErrors.length}건)` : 'PASS (0건)');
    if (hasErrors) consoleErrors.forEach(e => console.log(`    - ${e}`));
    results['Scenario 8'] = !hasErrors ? 'PASS' : 'FAIL';

  } catch (err) {
    console.error('테스트 중 예외:', err.message);
    console.error(err.stack);
  } finally {
    await browser.close();
  }

  console.log('\n=== 최종 결과 ===');
  Object.entries(results).forEach(([k, v]) => console.log(`${k}: ${v}`));

  const allPass = Object.values(results).every((v) => v === 'PASS' || v === 'SKIP');
  process.exit(allPass ? 0 : 1);
}

runTests().catch(console.error);
