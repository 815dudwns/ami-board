/*
 * autofill.js — Phase F: 멀티셀렉트 + 슬롯 할당 + Web Share
 *
 * 의존: storage.js, compose.js, app.js(window.AppMain)
 *
 * 플로우:
 *   1. 공통필드 자동채우기 (GPS/매치) — Phase C 로직 유지
 *   2. 멀티셀렉트 1회: <input type="file" accept="image/*" multiple>
 *   3. 슬롯 할당 UI: 썸네일 그리드 + 슬롯 목록
 *   4. 합성: 할당된 슬롯만 compose() 일괄 처리
 *   5. 저장: Web Share 우선 → 폴백 download
 *   6. 밴드 열기: bandapp:// 딥링크
 */

(function () {

  // -------------------------------------------------------
  // 임시 상태 (메모리 only)
  // -------------------------------------------------------
  var _state = {
    active: false,
    workers: [],
    // 선택된 File 객체 배열
    files: [],
    // 썸네일 Blob URL 배열 (files 인덱스 대응)
    thumbUrls: [],
    // 슬롯 할당: { slotKey: fileIndex | 'skip' | null }
    slotAssign: {},
    // 합성 결과: { slotKey: { blob, blobUrl, filename } }
    composed: {}
  };

  // 다중 클릭 가드
  var _saveInProgress = false;

  // 현재 열려 있는 슬롯 모달 대상 slotKey
  var _modalSlotKey = null;

  // -------------------------------------------------------
  // 상태 초기화 (Blob URL 회수 포함)
  // -------------------------------------------------------
  function resetState() {
    // 썸네일 URL 회수
    _state.thumbUrls.forEach(function (u) { if (u) URL.revokeObjectURL(u); });
    // 합성 결과 URL 회수
    Object.keys(_state.composed).forEach(function (k) {
      var c = _state.composed[k];
      if (c && c.blobUrl) URL.revokeObjectURL(c.blobUrl);
    });

    _state.active = false;
    _state.workers = [];
    _state.files = [];
    _state.thumbUrls = [];
    _state.slotAssign = {};
    _state.composed = {};
    _modalSlotKey = null;

    hideSlotUI();
    hidePreviewGrid();

    var saveBandBtn = getEl('btn-save-band');
    if (saveBandBtn) saveBandBtn.disabled = true;

    var openBandBtn = getEl('btn-open-band');
    if (openBandBtn) openBandBtn.style.display = 'none';

    // Tier 3: 수동 취소 버튼 숨김
    var cancelBtn = getEl('btn-autofill-cancel');
    if (cancelBtn) cancelBtn.style.display = 'none';
  }

  // -------------------------------------------------------
  // DOM 헬퍼
  // -------------------------------------------------------
  function getEl(id) { return document.getElementById(id); }

  function hideSlotUI() {
    var ui = getEl('slot-assign-ui');
    if (ui) ui.style.display = 'none';
  }

  function showSlotUI() {
    var ui = getEl('slot-assign-ui');
    if (ui) ui.style.display = 'block';
  }

  function hidePreviewGrid() {
    var grid = getEl('preview-grid');
    if (grid) grid.style.display = 'none';
  }

  // -------------------------------------------------------
  // 슬롯 키 목록 생성
  //   '__workers__', '__documents__', '{이름}__vehicle__'
  // -------------------------------------------------------
  function buildSlotKeys(workers) {
    var keys = ['__workers__', '__documents__'];
    workers.forEach(function (name) {
      keys.push(name + '__vehicle__');
    });
    return keys;
  }

  function slotLabel(slotKey, workers) {
    if (slotKey === '__workers__') return '작업원 사진';
    if (slotKey === '__documents__') return '서류 사진';
    var m = slotKey.match(/^(.+)__vehicle__$/);
    if (m) return m[1] + ' 차대비';
    return slotKey;
  }

  // -------------------------------------------------------
  // 썸네일 그리드 렌더 (선택 가능 그리드 — 슬롯 할당 모달용)
  // -------------------------------------------------------
  function renderThumbGrid(containerId, onSelect, selectedIndex) {
    var container = getEl(containerId);
    if (!container) return;
    container.innerHTML = '';

    _state.files.forEach(function (file, idx) {
      var wrap = document.createElement('div');
      wrap.className = 'slot-thumb-item' + (idx === selectedIndex ? ' slot-thumb-item--selected' : '');

      var img = document.createElement('img');
      img.className = 'slot-thumb-img';
      img.alt = '사진 ' + (idx + 1);
      if (_state.thumbUrls[idx]) {
        img.src = _state.thumbUrls[idx];
      }

      var num = document.createElement('span');
      num.className = 'slot-thumb-num';
      num.textContent = idx + 1;

      wrap.appendChild(img);
      wrap.appendChild(num);

      wrap.addEventListener('click', function () {
        onSelect(idx);
      });

      container.appendChild(wrap);
    });
  }

  // -------------------------------------------------------
  // 슬롯 할당 UI 렌더
  // -------------------------------------------------------
  function renderSlotList() {
    var workers = _state.workers;
    var slotKeys = buildSlotKeys(workers);
    var container = getEl('slot-list');
    if (!container) return;
    container.innerHTML = '';

    slotKeys.forEach(function (slotKey) {
      var label = slotLabel(slotKey, workers);
      var assigned = _state.slotAssign[slotKey];

      var row = document.createElement('div');
      row.className = 'slot-row';
      row.setAttribute('data-slot', slotKey);

      var labelEl = document.createElement('span');
      labelEl.className = 'slot-row__label';
      labelEl.textContent = label;

      var preview = document.createElement('div');
      preview.className = 'slot-row__preview';

      if (assigned === 'skip') {
        preview.innerHTML = '<span class="slot-skip-badge">건너뜀</span>';
      } else if (typeof assigned === 'number' && _state.thumbUrls[assigned]) {
        var previewImg = document.createElement('img');
        previewImg.className = 'slot-row__thumb';
        previewImg.src = _state.thumbUrls[assigned];
        previewImg.alt = label + ' 선택됨';
        preview.appendChild(previewImg);
      } else {
        preview.innerHTML = '<span class="slot-empty-hint">미배정</span>';
      }

      var pickBtn = document.createElement('button');
      pickBtn.className = 'btn-secondary btn-sm';
      pickBtn.type = 'button';
      pickBtn.textContent = '사진 선택';
      pickBtn.addEventListener('click', (function (key) {
        return function () { openSlotModal(key); };
      })(slotKey));

      var skipBtn = document.createElement('button');
      skipBtn.className = 'btn-secondary btn-sm';
      skipBtn.type = 'button';
      skipBtn.textContent = '건너뛰기';
      skipBtn.addEventListener('click', (function (key) {
        return function () {
          _state.slotAssign[key] = 'skip';
          renderSlotList();
          updateComposePreviewBtn();
        };
      })(slotKey));

      var actions = document.createElement('div');
      actions.className = 'slot-row__actions';
      actions.appendChild(pickBtn);
      actions.appendChild(skipBtn);

      row.appendChild(labelEl);
      row.appendChild(preview);
      row.appendChild(actions);
      container.appendChild(row);
    });
  }

  // -------------------------------------------------------
  // 슬롯 모달 열기/닫기
  // -------------------------------------------------------
  function openSlotModal(slotKey) {
    _modalSlotKey = slotKey;
    var workers = _state.workers;
    var label = slotLabel(slotKey, workers);
    var titleEl = getEl('slot-modal-title');
    if (titleEl) titleEl.textContent = label + ' — 사진 선택';

    var currentAssign = _state.slotAssign[slotKey];
    var currentIdx = (typeof currentAssign === 'number') ? currentAssign : -1;

    renderThumbGrid('slot-modal-thumb-grid', function (idx) {
      _state.slotAssign[_modalSlotKey] = idx;
      closeSlotModal();
      renderSlotList();
      updateComposePreviewBtn();
    }, currentIdx);

    var backdrop = getEl('slot-modal-backdrop');
    if (backdrop) backdrop.style.display = 'flex';
  }

  function closeSlotModal() {
    _modalSlotKey = null;
    var backdrop = getEl('slot-modal-backdrop');
    if (backdrop) backdrop.style.display = 'none';
  }

  // -------------------------------------------------------
  // "합성 미리보기" 버튼 활성 조건 체크
  //   모든 슬롯이 할당(number) 또는 skip 이면 활성화
  // -------------------------------------------------------
  function updateComposePreviewBtn() {
    var btn = getEl('btn-compose-preview');
    if (!btn) return;
    var workers = _state.workers;
    var slotKeys = buildSlotKeys(workers);
    var allDecided = slotKeys.every(function (k) {
      var v = _state.slotAssign[k];
      return typeof v === 'number' || v === 'skip';
    });
    btn.disabled = !allDecided;
  }

  // -------------------------------------------------------
  // 단계 1: 공통필드 자동 채우기 (Phase C 유지)
  // -------------------------------------------------------
  function step1CommonFields(projectName, workers) {
    return new Promise(function (resolve) {
      var matched = Storage.findMatchingSession(
        projectName,
        workers.slice().sort()
      );

      if (matched) {
        getEl('office').value = matched.office || '마포용산지사';
        getEl('workplace').value = matched.workplace || '';
        Storage.setLastSelected({
          office: matched.office || '마포용산지사',
          workplace: matched.workplace || '',
          workplaceCoord: matched.workplaceCoord || null
        });
        var banner = getEl('match-banner');
        if (banner) banner.style.display = 'flex';
        resolve();
        return;
      }

      if (!navigator.geolocation) {
        alert('작업장소를 수동 입력하세요.');
        resolve();
        return;
      }

      navigator.geolocation.getCurrentPosition(
        function (pos) {
          var lat = pos.coords.latitude;
          var lng = pos.coords.longitude;
          reverseGeocodeForAutofill(lat, lng, function (address) {
            if (address) {
              getEl('workplace').value = address;
              Storage.setLastSelected({ workplace: address });
            } else {
              alert('GPS 주소 변환에 실패했습니다. 작업장소를 수동 입력하세요.');
            }
            resolve();
          });
        },
        function () {
          alert('GPS 실패. 작업장소를 수동 입력하세요.');
          resolve();
        },
        { timeout: 10000, enableHighAccuracy: true }
      );
    });
  }

  function reverseGeocodeForAutofill(lat, lng, callback) {
    if (typeof kakao === 'undefined' || !kakao.maps || !kakao.maps.services) {
      callback(null);
      return;
    }
    var geocoder = new kakao.maps.services.Geocoder();
    geocoder.coord2Address(lng, lat, function (result, status) {
      if (status === kakao.maps.services.Status.OK && result.length > 0) {
        var road = result[0].road_address;
        var jibun = result[0].address;
        var addr = (road ? road.address_name : null) || (jibun ? jibun.address_name : null);
        callback(addr || null);
      } else {
        callback(null);
      }
    });
  }

  // -------------------------------------------------------
  // 단계 2: 멀티셀렉트 (1회) — 3중 안전망으로 취소 감지
  //
  //   Tier 1 — cancel 이벤트 (Chrome 113+ / Safari 16.4+ / 최신 iOS Safari)
  //   Tier 2 — window focus 복귀 + setTimeout 500ms 후 changeFired 미충족 시 취소
  //   Tier 3 — #btn-autofill-cancel 버튼 (수동 취소, 최후의 보루)
  //
  //   iOS/Safari user gesture chain 보존을 위해
  //   이 함수는 핸들러 바인딩만 수행하고 Promise를 반환.
  //   실제 input.click()은 호출자(runAutofill)가 동기 경로에서 직접 호출.
  // -------------------------------------------------------
  function step2BindChangeHandler(input) {
    return new Promise(function (resolve) {
      // 이미 등록된 리스너 정리 (중복 등록 방지)
      if (input._autoHandler) {
        input.removeEventListener('change', input._autoHandler);
        input._autoHandler = null;
      }
      if (input._autoCancelHandler) {
        input.removeEventListener('cancel', input._autoCancelHandler);
        input._autoCancelHandler = null;
      }
      if (input._autoFocusHandler) {
        window.removeEventListener('focus', input._autoFocusHandler);
        input._autoFocusHandler = null;
      }
      if (input._autoCancelBtnHandler) {
        var cancelBtn = getEl('btn-autofill-cancel');
        if (cancelBtn) cancelBtn.removeEventListener('click', input._autoCancelBtnHandler);
        input._autoCancelBtnHandler = null;
      }

      var resolved = false;
      var changeFired = false;

      // 모든 리스너 일괄 정리
      function cleanup() {
        input.removeEventListener('change', input._autoHandler);
        input._autoHandler = null;
        input.removeEventListener('cancel', input._autoCancelHandler);
        input._autoCancelHandler = null;
        window.removeEventListener('focus', input._autoFocusHandler);
        input._autoFocusHandler = null;
        var cancelBtn = getEl('btn-autofill-cancel');
        if (cancelBtn && input._autoCancelBtnHandler) {
          cancelBtn.removeEventListener('click', input._autoCancelBtnHandler);
        }
        input._autoCancelBtnHandler = null;
      }

      // 취소 공통 처리 (어느 경로든 여기서 resolve([]))
      function handleCancel(source) {
        if (resolved) return;
        resolved = true;
        console.debug('[autofill] cancelled via', source);
        cleanup();
        resolve([]);
      }

      // Tier 1: change 핸들러
      function onChange(e) {
        if (resolved) return;
        changeFired = true;
        resolved = true;
        cleanup();
        var files = e.target.files ? Array.prototype.slice.call(e.target.files) : [];
        input.value = '';
        resolve(files);
      }

      // Tier 1: cancel 이벤트 (Chrome 113+ / Safari 16.4+)
      function onCancel() {
        handleCancel('cancel-event');
      }

      // Tier 2: window focus 복귀 감지
      function onFocusReturn() {
        // 포커스 복귀 후 500ms 안에 change가 오지 않으면 취소로 판단
        setTimeout(function () {
          if (!changeFired) {
            handleCancel('focus-fallback');
          }
        }, 500);
      }

      // Tier 3: 수동 취소 버튼
      function onCancelBtn() {
        handleCancel('manual-reset');
      }

      // 핸들러 등록
      input.addEventListener('change', onChange);
      input._autoHandler = onChange;

      input.addEventListener('cancel', onCancel);
      input._autoCancelHandler = onCancel;

      window.addEventListener('focus', onFocusReturn, { once: true });
      input._autoFocusHandler = onFocusReturn;

      var cancelBtn = getEl('btn-autofill-cancel');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', onCancelBtn);
        input._autoCancelBtnHandler = onCancelBtn;
      }
    });
  }

  // 하위 호환 래퍼 (스모크 테스트·외부 코드가 step2MultiSelect 참조 시 대비)
  function step2MultiSelect() {
    var input = getEl('auto-file-multi');
    if (!input) return Promise.resolve([]);
    var p = step2BindChangeHandler(input);
    input.click();
    return p;
  }

  // -------------------------------------------------------
  // 썸네일 Blob URL 생성 (createObjectURL)
  // -------------------------------------------------------
  function buildThumbUrls(files) {
    return files.map(function (file) {
      return URL.createObjectURL(file);
    });
  }

  // -------------------------------------------------------
  // 단계 3: 슬롯 할당 UI 표시
  // -------------------------------------------------------
  function step3SlotAssignUI() {
    var workers = _state.workers;
    var slotKeys = buildSlotKeys(workers);

    // 초기 슬롯 상태 설정
    _state.slotAssign = {};
    slotKeys.forEach(function (k) { _state.slotAssign[k] = null; });

    // 썸네일 그리드 렌더 (표시 전용, 클릭 없음)
    renderThumbGridDisplay();
    // 슬롯 목록 렌더
    renderSlotList();
    updateComposePreviewBtn();
    showSlotUI();
  }

  // 상단 썸네일 그리드 (표시 전용)
  function renderThumbGridDisplay() {
    var container = getEl('slot-thumb-grid');
    if (!container) return;
    container.innerHTML = '';

    _state.files.forEach(function (file, idx) {
      var wrap = document.createElement('div');
      wrap.className = 'slot-thumb-item';

      var img = document.createElement('img');
      img.className = 'slot-thumb-img';
      img.alt = '사진 ' + (idx + 1);
      if (_state.thumbUrls[idx]) img.src = _state.thumbUrls[idx];

      var num = document.createElement('span');
      num.className = 'slot-thumb-num';
      num.textContent = idx + 1;

      wrap.appendChild(img);
      wrap.appendChild(num);
      container.appendChild(wrap);
    });
  }

  // -------------------------------------------------------
  // 단계 4: 합성
  // -------------------------------------------------------
  function step4Compose(projectName) {
    var workers = _state.workers;
    var allWorkerStr = workers.join(' ');

    var tasks = [];
    var dateStr = (getEl('field-date') || {}).value || '';

    Object.keys(_state.slotAssign).forEach(function (slotKey) {
      var assigned = _state.slotAssign[slotKey];
      if (assigned === 'skip' || assigned === null) return;
      if (typeof assigned !== 'number') return;

      var file = _state.files[assigned];
      if (!file) return;

      var boardData;
      var label;
      var filename;

      if (slotKey === '__workers__') {
        boardData = window.AppMain.collectBoardData(allWorkerStr);
        label = '작업원 사진';
        filename = buildFilename(dateStr, '작업자', 1);
      } else if (slotKey === '__documents__') {
        boardData = window.AppMain.collectBoardData(allWorkerStr);
        label = '서류 사진';
        filename = buildFilename(dateStr, '서류', 1);
      } else {
        var m = slotKey.match(/^(.+)__vehicle__$/);
        var workerName = m ? m[1] : slotKey;
        boardData = window.AppMain.collectBoardData(workerName);
        label = workerName + ' 차대비';
        filename = buildFilename(dateStr, '차대비', workerName);
      }

      tasks.push({ slotKey: slotKey, file: file, boardData: boardData, label: label, filename: filename });
    });

    if (tasks.length === 0) {
      renderEmptyPreviewGrid();
      return Promise.resolve();
    }

    var promises = tasks.map(function (t) {
      return Compose.compose(t.file, t.boardData).then(function (blob) {
        return { slotKey: t.slotKey, label: t.label, blob: blob, filename: t.filename };
      });
    });

    return Promise.all(promises).then(function (results) {
      // 이전 합성 결과 URL 회수
      Object.keys(_state.composed).forEach(function (k) {
        var c = _state.composed[k];
        if (c && c.blobUrl) URL.revokeObjectURL(c.blobUrl);
      });
      _state.composed = {};

      results.forEach(function (r) {
        var url = URL.createObjectURL(r.blob);
        _state.composed[r.slotKey] = { blob: r.blob, blobUrl: url, filename: r.filename };
      });

      renderPreviewGrid(results);
      updateSaveBandBtn();
    }).catch(function (err) {
      alert('합성 오류: ' + err.message);
    });
  }

  // -------------------------------------------------------
  // 미리보기 그리드 렌더
  // -------------------------------------------------------
  function renderPreviewGrid(results) {
    var grid = getEl('preview-grid');
    var itemsEl = getEl('preview-grid-items');
    itemsEl.innerHTML = '';

    results.forEach(function (r) {
      var div = document.createElement('div');
      div.className = 'preview-grid-item';

      var header = document.createElement('div');
      header.className = 'preview-grid-item__header';

      var label = document.createElement('span');
      label.className = 'preview-grid-item__label';
      label.textContent = r.label;

      header.appendChild(label);

      var img = document.createElement('img');
      img.className = 'preview-grid-item__img';
      img.alt = r.label + ' 합성 결과';

      var composed = _state.composed[r.slotKey];
      if (composed && composed.blobUrl) img.src = composed.blobUrl;

      div.appendChild(header);
      div.appendChild(img);
      itemsEl.appendChild(div);
    });

    grid.style.display = 'block';
  }

  function renderEmptyPreviewGrid() {
    var itemsEl = getEl('preview-grid-items');
    itemsEl.innerHTML = '<p class="empty-hint">선택된 사진이 없습니다.</p>';
    getEl('preview-grid').style.display = 'block';
  }

  // -------------------------------------------------------
  // 메인 플로우
  //
  // iOS/Safari user gesture chain 보존 전략:
  //   btn-autofill click → 동기 검증 → GPS fire-and-forget 시작
  //   → change 핸들러 바인딩 → input.click() ← 이 줄이 동기 경로 최하단
  //   → 사용자가 사진 고르는 동안 GPS가 백그라운드로 진행
  //   → onChange 핸들러 안에서 GPS Promise 결과를 기다린 뒤 슬롯 UI 진입
  // -------------------------------------------------------
  function runAutofill() {
    if (_state.active) {
      if (!confirm('진행 중인 자동 입히기를 초기화하시겠습니까?')) return;
      resetState();
    }

    var projectName = (getEl('project-name') || {}).value || '';
    var workers = window.AppMain.getSelectedWorkers();

    if (!projectName) {
      alert('공사명을 선택해주세요.');
      return;
    }
    if (workers.length === 0) {
      alert('작업원을 1명 이상 선택해주세요.');
      return;
    }

    _state.active = true;
    _state.workers = workers.slice();

    var btn = getEl('btn-autofill');
    btn.disabled = true;
    btn.textContent = '진행 중...';

    // Tier 3: 수동 취소 버튼 표시
    var cancelBtn = getEl('btn-autofill-cancel');
    if (cancelBtn) cancelBtn.style.display = 'inline-block';

    // GPS/매치를 fire-and-forget으로 먼저 시작 (await 없이 Promise만 보관)
    var gpsPromise = step1CommonFields(projectName, workers);

    // input 확인
    var input = getEl('auto-file-multi');
    if (!input) {
      // input 없으면 GPS만 완료 후 마무리
      gpsPromise.then(function () {
        btn.disabled = false;
        btn.textContent = '자동 입히기';
        _state.active = false;
      }).catch(function (err) {
        console.error('autofill error:', err);
        btn.disabled = false;
        btn.textContent = '자동 입히기';
        _state.active = false;
      });
      return;
    }

    // change 핸들러를 먼저 바인딩 (동기)
    var filesPromise = step2BindChangeHandler(input);

    // 사진 선택이 완료되면 GPS 결과를 기다린 뒤 슬롯 UI 진입
    filesPromise.then(function (files) {
      // 취소 버튼 숨김 (Tier 1/2/3 어느 경로든 resolve 후 항상 숨김)
      var cancelBtnInner = getEl('btn-autofill-cancel');
      if (cancelBtnInner) cancelBtnInner.style.display = 'none';

      if (!files || files.length === 0) {
        // 사진 미선택(취소) → GPS도 취소 상태로 두고 중단
        _state.active = false;
        btn.disabled = false;
        btn.textContent = '자동 입히기';
        return;
      }

      // GPS 결과 대기 (사진 고르는 동안 이미 완료됐을 가능성 높음)
      return gpsPromise.then(function () {
        _state.files = files;
        _state.thumbUrls = buildThumbUrls(files);
        step3SlotAssignUI();

        btn.disabled = false;
        btn.textContent = '자동 입히기';
        _state.active = false;
      });
    }).catch(function (err) {
      console.error('autofill error:', err);
      btn.disabled = false;
      btn.textContent = '자동 입히기';
      _state.active = false;
      var cancelBtnErr = getEl('btn-autofill-cancel');
      if (cancelBtnErr) cancelBtnErr.style.display = 'none';
      alert('자동 입히기 중 오류가 발생했습니다: ' + err.message);
    });

    // ★ user gesture chain 핵심: 동기 경로 최하단에서 input.click() 호출
    //   위의 .then() 등록이 완료된 직후, 이 줄이 실행될 때까지
    //   어떠한 await/microtask 경계도 없음.
    input.click();
  }

  // -------------------------------------------------------
  // 합성 미리보기 실행 (btn-compose-preview 클릭)
  // -------------------------------------------------------
  function runComposePreview() {
    var projectName = (getEl('project-name') || {}).value || '';
    var workers = _state.workers;

    hideSlotUI();

    step4Compose(projectName).catch(function (err) {
      console.error('compose error:', err);
      alert('합성 중 오류가 발생했습니다: ' + err.message);
    });
  }

  // -------------------------------------------------------
  // Phase D 유지: btn-save-band 활성/비활성
  // -------------------------------------------------------
  function updateSaveBandBtn() {
    var btn = getEl('btn-save-band');
    if (!btn) return;
    btn.disabled = !hasSomethingComposed();
  }

  function hasSomethingComposed() {
    return Object.keys(_state.composed).some(function (k) {
      return _state.composed[k] && _state.composed[k].blob;
    });
  }

  // -------------------------------------------------------
  // Phase D 유지: 파일명 생성
  // -------------------------------------------------------
  function buildFilename(dateStr, type, suffix) {
    // YYYY.MM.DD 또는 YYYY-MM-DD 모두 처리 (점·하이픈 제거)
    var datePart = (dateStr || '').replace(/[\.\-]/g, '').replace(/\s+/g, '');
    if (!/^\d{8}$/.test(datePart)) {
      datePart = new Date().toISOString().split('T')[0].replace(/-/g, '');
    }
    return 'board_' + datePart + '_' + type + '_' + suffix + '.jpg';
  }

  // -------------------------------------------------------
  // Phase D 유지: 딥링크 트리거
  // -------------------------------------------------------
  function triggerDeepLink(url) {
    window.location.href = url;
  }

  function triggerFallback(url) {
    window.open(url, '_blank');
  }

  // -------------------------------------------------------
  // Phase D 유지: 로컬 다운로드 (순차 지연) — 폴백용
  // -------------------------------------------------------
  function downloadBlobs(items) {
    return new Promise(function (resolve) {
      var delay = 0;
      items.forEach(function (item) {
        delay += 250;
        (function (blob, filename, d) {
          setTimeout(function () {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
          }, d);
        })(item.blob, item.filename, delay);
      });
      setTimeout(resolve, delay + 100);
    });
  }

  // -------------------------------------------------------
  // Phase D 유지: 밴드 앱 딥링크 + 폴백
  // -------------------------------------------------------
  function openBandApp() {
    var ua = navigator.userAgent || '';
    var isIOS = /iPhone|iPad|iPod/i.test(ua);
    var isAndroid = /Android/i.test(ua);

    var deeplink;
    if (isIOS) {
      deeplink = 'bandapp://';
    } else if (isAndroid) {
      deeplink = 'intent://share#Intent;package=com.nhn.android.band;scheme=band;end';
    } else {
      triggerFallback('https://band.us/');
      return;
    }

    var fallbackTimer = null;
    var visHandler = null;

    function cancelFallback() {
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
      if (visHandler) { document.removeEventListener('visibilitychange', visHandler); visHandler = null; }
    }

    visHandler = function () {
      if (document.hidden) cancelFallback();
    };
    document.addEventListener('visibilitychange', visHandler);

    fallbackTimer = setTimeout(function () {
      cancelFallback();
      triggerFallback('https://band.us/');
    }, 800);

    triggerDeepLink(deeplink);
  }

  // -------------------------------------------------------
  // Phase D 유지: 세션 기록
  // -------------------------------------------------------
  function recordSession() {
    var projectName = (getEl('project-name') || {}).value || '';
    var workers = _state.workers.slice().sort();
    var office = (getEl('office') || {}).value || '마포용산지사';
    var workplace = ((getEl('workplace') || {}).value || '').trim();
    var state = Storage.getState();
    var coord = (state.lastSelected && state.lastSelected.workplaceCoord) || undefined;

    Storage.appendSession({
      projectName: projectName,
      workers: workers,
      office: office,
      workplace: workplace,
      workplaceCoord: coord,
      timestamp: new Date().toISOString()
    });
  }

  // -------------------------------------------------------
  // Phase F: 저장 + 밴드 열기 (Web Share 우선)
  // -------------------------------------------------------
  function runSaveAndBand() {
    if (_saveInProgress) return;
    if (!hasSomethingComposed()) return;
    _saveInProgress = true;

    var dateStr = (getEl('field-date') || {}).value || '';
    var items = [];

    Object.keys(_state.composed).forEach(function (slotKey) {
      var c = _state.composed[slotKey];
      if (c && c.blob) {
        items.push({ blob: c.blob, filename: c.filename });
      }
    });

    if (items.length === 0) { _saveInProgress = false; return; }

    var btn = getEl('btn-save-band');
    if (btn) btn.disabled = true;

    // Web Share API 시도
    var shareFiles = items.map(function (item) {
      return new File([item.blob], item.filename, { type: 'image/jpeg' });
    });

    var useWebShare = (
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: shareFiles })
    );

    if (useWebShare) {
      navigator.share({
        files: shareFiles,
        title: '동산보드판'
      }).then(function () {
        recordSession();
        // "밴드 열기" 버튼 노출
        var openBandBtn = getEl('btn-open-band');
        if (openBandBtn) openBandBtn.style.display = 'block';
      }).catch(function (err) {
        // AbortError: 사용자 취소 — 정상
        if (err && err.name !== 'AbortError') {
          console.error('share error:', err);
        }
      }).then(function () {
        if (btn) btn.disabled = false;
        _saveInProgress = false;
      });
    } else {
      // 폴백: 다운로드
      downloadBlobs(items)
        .then(function () {
          recordSession();
          openBandApp();
        })
        .catch(function (err) {
          console.error('save+band error:', err);
          alert('저장 중 오류가 발생했습니다: ' + err.message);
        })
        .then(function () {
          if (btn) btn.disabled = false;
          _saveInProgress = false;
        });
    }
  }

  // -------------------------------------------------------
  // 이벤트 바인딩
  // -------------------------------------------------------
  function bindEvents() {
    var autofillBtn = getEl('btn-autofill');
    if (autofillBtn) autofillBtn.addEventListener('click', runAutofill);

    var composePreviewBtn = getEl('btn-compose-preview');
    if (composePreviewBtn) composePreviewBtn.addEventListener('click', runComposePreview);

    var saveBandBtn = getEl('btn-save-band');
    if (saveBandBtn) saveBandBtn.addEventListener('click', runSaveAndBand);

    var openBandBtn = getEl('btn-open-band');
    if (openBandBtn) openBandBtn.addEventListener('click', function () { openBandApp(); });

    var modalCancelBtn = getEl('btn-slot-modal-cancel');
    if (modalCancelBtn) modalCancelBtn.addEventListener('click', closeSlotModal);

    // 모달 백드롭 탭으로 닫기
    var backdrop = getEl('slot-modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) closeSlotModal();
      });
    }
  }

  // -------------------------------------------------------
  // 초기화
  // -------------------------------------------------------
  function init() {
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 외부 노출 (스모크 테스트용 — Phase D 호환 유지)
  window.AutoFill = {
    _state: _state,
    runAutofill: runAutofill,
    resetState: resetState,
    // Phase D 테스트 훅
    _triggerDeepLink: function (url) { triggerDeepLink(url); },
    _triggerFallback: function (url) { triggerFallback(url); },
    _hasSomethingComposed: hasSomethingComposed,
    _buildFilename: buildFilename,
    _downloadBlobs: downloadBlobs
  };

})();
