/*
 * autofill.js — Phase F: 멀티셀렉트 + 슬롯 카드 드래그 정렬 + X/+ 가변 + Web Share
 *
 * 의존: storage.js, compose.js, app.js(window.AppMain), Sortable.js
 *
 * 플로우:
 *   1. 공통필드 자동채우기 (GPS/매치) — Phase C 로직 유지
 *   2. 멀티셀렉트 1회: <input type="file" accept="image/*" multiple>
 *   3. 슬롯 카드 UI: 드래그 정렬 + X/+ 가변 (최대 6장)
 *   4. 합성: 사진이 있는 카드만 compose() 일괄 처리
 *   5. 저장: Web Share 우선 → 폴백 download
 *   6. 밴드 열기: bandapp:// 딥링크
 *
 * 상태 모델:
 *   _state.slots  = [{ role, label, workerName }]  — 역할 순서 고정
 *   _state.photos = [File|null, ...]               — 드래그로 순서 바뀜, slots와 동일 길이
 *
 * DOM id/클래스 (Claude Design 교체 대비 유지):
 *   #slot-assign-ui, #slot-cards, .slot-card[data-role][data-index]
 *   .slot-label, .slot-thumb, .slot-remove-btn, .slot-add-btn
 */

(function () {

  var MAX_SLOTS = 6;

  // -------------------------------------------------------
  // 임시 상태 (메모리 only)
  // -------------------------------------------------------
  var _state = {
    active: false,
    // 슬롯 배열: [{ role: 'worker'|'document'|'chadaebi', label, workerName }]
    slots: [],
    // 사진 배열: [File|null] — slots와 동일 길이
    photos: [],
    // 합성 결과: { idx: { blob, blobUrl, filename, label } }
    composed: {},
    // 썸네일 Blob URL 캐시: photos 인덱스 → blobUrl
    thumbUrls: []
  };

  // Sortable 인스턴스 (재초기화용)
  var _sortable = null;

  // 다중 클릭 가드
  var _saveInProgress = false;

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

    if (_sortable) {
      _sortable.destroy();
      _sortable = null;
    }

    _state.active = false;
    _state.slots = [];
    _state.photos = [];
    _state.thumbUrls = [];
    _state.composed = {};

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
  // 썸네일 URL 확보 (이미 캐시 있으면 재사용)
  // -------------------------------------------------------
  function ensureThumbUrl(idx) {
    if (_state.thumbUrls[idx]) return _state.thumbUrls[idx];
    var file = _state.photos[idx];
    if (!file) return null;
    var url = URL.createObjectURL(file);
    _state.thumbUrls[idx] = url;
    return url;
  }

  // photos 배열 변경 시 영향받는 thumbUrl 회수 후 재생성
  function invalidateThumbUrl(idx) {
    if (_state.thumbUrls[idx]) {
      URL.revokeObjectURL(_state.thumbUrls[idx]);
      _state.thumbUrls[idx] = null;
    }
  }

  // -------------------------------------------------------
  // 초기 slots 빌드 (멀티셀렉트 직후)
  // -------------------------------------------------------
  function buildInitialSlots(workers) {
    var slots = [
      { role: 'worker', label: '작업원', workerName: null },
      { role: 'document', label: '서류', workerName: null }
    ];

    // 차대비 슬롯: 작업원 명단에서 생성. 총 6개 한도 내.
    var maxChadaebi = MAX_SLOTS - 2;
    var chadaebiWorkers = workers.slice(0, maxChadaebi);

    if (workers.length > maxChadaebi) {
      alert('작업원이 많아 앞 ' + maxChadaebi + '명만 차대비 카드로 생성됩니다.');
    }

    chadaebiWorkers.forEach(function (name) {
      slots.push({ role: 'chadaebi', label: name + ' 차대비', workerName: name });
    });

    return slots;
  }

  // -------------------------------------------------------
  // + 버튼: 익명 차대비 슬롯 추가
  // -------------------------------------------------------
  function addChadaebiSlot() {
    if (_state.slots.length >= MAX_SLOTS) {
      alert('최대 ' + MAX_SLOTS + '개 카드까지 가능합니다.');
      return;
    }
    var existingChadaebi = _state.slots.filter(function (s) { return s.role === 'chadaebi'; });
    var n = existingChadaebi.length + 1;
    _state.slots.push({ role: 'chadaebi', label: '차대비 ' + n, workerName: null });
    _state.photos.push(null);
    renderCards();
  }

  // -------------------------------------------------------
  // 사진 전체 초기화: photos[] 전부 null, slots[] 구조 유지
  // -------------------------------------------------------
  function clearAllPhotos() {
    for (var i = 0; i < _state.photos.length; i++) {
      invalidateThumbUrl(i);
      _state.photos[i] = null;
    }
    // 합성 결과도 초기화
    Object.keys(_state.composed).forEach(function (k) {
      var c = _state.composed[k];
      if (c && c.blobUrl) URL.revokeObjectURL(c.blobUrl);
    });
    _state.composed = {};
    renderCards();
    hidePreviewGrid();
    updateComposePreviewBtn();
    updateSaveBandBtn();
  }

  // -------------------------------------------------------
  // X 버튼: 차대비 슬롯 제거
  // -------------------------------------------------------
  function removeChadaebiSlot(idx) {
    if (_state.slots[idx].role !== 'chadaebi') return;
    invalidateThumbUrl(idx);
    _state.slots.splice(idx, 1);
    _state.photos.splice(idx, 1);
    _state.thumbUrls.splice(idx, 1);
    renderCards();
  }

  // -------------------------------------------------------
  // 카드 그리드 렌더 (Sortable 재초기화 포함)
  // -------------------------------------------------------
  function renderCards() {
    var container = getEl('slot-cards');
    if (!container) return;
    container.innerHTML = '';

    if (_sortable) {
      _sortable.destroy();
      _sortable = null;
    }

    _state.slots.forEach(function (slot, idx) {
      var card = document.createElement('div');
      card.className = 'slot-card';
      card.setAttribute('data-role', slot.role);
      card.setAttribute('data-index', String(idx));

      // 라벨
      var labelEl = document.createElement('div');
      labelEl.className = 'slot-label';
      labelEl.textContent = slot.label;
      card.appendChild(labelEl);

      // 썸네일 영역
      var thumbEl = document.createElement('div');
      thumbEl.className = 'slot-thumb';
      var photo = _state.photos[idx];
      if (photo) {
        var url = ensureThumbUrl(idx);
        var img = document.createElement('img');
        img.src = url;
        img.alt = slot.label + ' 썸네일';
        thumbEl.appendChild(img);
      } else {
        var emptyHint = document.createElement('span');
        emptyHint.className = 'slot-thumb-empty';
        emptyHint.textContent = '사진 없음';
        thumbEl.appendChild(emptyHint);
      }
      card.appendChild(thumbEl);

      // 차대비 카드만 X 버튼
      if (slot.role === 'chadaebi') {
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'slot-remove-btn btn-sm';
        removeBtn.setAttribute('aria-label', slot.label + ' 삭제');
        removeBtn.textContent = 'X';
        (function (i) {
          removeBtn.addEventListener('click', function () { removeChadaebiSlot(i); });
        })(idx);
        card.appendChild(removeBtn);
      }

      container.appendChild(card);
    });

    // + 버튼 disabled 상태 갱신
    var addBtn = getEl('slot-add-btn');
    if (addBtn) addBtn.disabled = _state.slots.length >= MAX_SLOTS;

    // Sortable.js 초기화
    if (typeof Sortable !== 'undefined') {
      _sortable = new Sortable(container, {
        animation: 150,
        filter: '.slot-remove-btn',
        preventOnFilter: false,
        onEnd: function (evt) {
          if (evt.oldIndex === evt.newIndex) return;
          // photos만 재정렬 (slots 고정)
          var moved = _state.photos.splice(evt.oldIndex, 1)[0];
          var movedThumb = _state.thumbUrls.splice(evt.oldIndex, 1)[0];
          _state.photos.splice(evt.newIndex, 0, moved);
          _state.thumbUrls.splice(evt.newIndex, 0, movedThumb);
          renderCards();
        }
      });
    }

    updateComposePreviewBtn();
  }

  // -------------------------------------------------------
  // "합성 미리보기" 버튼 활성 조건 체크
  //   사진이 하나라도 있으면 활성화 (빈 카드는 자동 스킵)
  // -------------------------------------------------------
  function updateComposePreviewBtn() {
    var btn = getEl('btn-compose-preview');
    if (!btn) return;
    var hasAny = _state.photos.some(function (p) { return !!p; });
    btn.disabled = !hasAny;
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
        var officeEl = getEl('field-office');
        if (officeEl) officeEl.value = matched.office || '';
        getEl('workplace').value = matched.workplace || '';
        Storage.setLastSelected({
          office: matched.office || '',
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
  // 단계 3: 슬롯 카드 UI 초기 표시 / 재클릭 시 append
  //
  // 처음 호출 시: slots 초기화 + photos 빌드
  // 슬롯이 이미 있을 때(재선택): 기존 photos에 append
  //   - 빈 슬롯(null)부터 채우고, 남으면 나중에 추가
  //   - 총 6장 초과 시 앞에서부터 6장만, 경고 표시
  // -------------------------------------------------------
  function step3SlotCardUI(files, workers) {
    var isFirstRun = (_state.slots.length === 0);

    if (isFirstRun) {
      // 최초 실행: slots + photos 전체 초기화
      _state.slots = buildInitialSlots(workers);

      var limitedFiles = files;
      if (files.length > MAX_SLOTS) {
        alert('최대 ' + MAX_SLOTS + '장까지 선택 가능합니다. 앞 ' + MAX_SLOTS + '장만 사용합니다.');
        limitedFiles = files.slice(0, MAX_SLOTS);
      }

      _state.photos = [];
      _state.thumbUrls = [];
      for (var i = 0; i < _state.slots.length; i++) {
        _state.photos.push(limitedFiles[i] || null);
        _state.thumbUrls.push(null);
      }
    } else {
      // 재선택: 기존 photos에 append
      var incoming = files.slice();

      // 1) 빈 슬롯(null)부터 채움
      for (var j = 0; j < _state.photos.length && incoming.length > 0; j++) {
        if (!_state.photos[j]) {
          invalidateThumbUrl(j);
          _state.photos[j] = incoming.shift();
          _state.thumbUrls[j] = null;
        }
      }

      // 2) 아직 남은 파일 있으면 뒤에 붙이되 MAX_SLOTS 초과 차단
      if (incoming.length > 0) {
        var available = MAX_SLOTS - _state.photos.length;
        if (available <= 0) {
          alert('최대 ' + MAX_SLOTS + '장 한도에 이미 도달했습니다. 일부 사진은 추가되지 않았습니다.');
        } else {
          if (incoming.length > available) {
            alert('최대 ' + MAX_SLOTS + '장 한도로 인해 ' + (incoming.length - available) + '장은 추가되지 않았습니다. 앞 ' + available + '장만 추가합니다.');
            incoming = incoming.slice(0, available);
          }
          incoming.forEach(function (f) {
            _state.photos.push(f);
            _state.thumbUrls.push(null);
          });
        }
      }

      // photos 길이가 slots보다 길어진 경우 slots 확장 (익명 차대비)
      while (_state.slots.length < _state.photos.length && _state.slots.length < MAX_SLOTS) {
        var existingChadaebi = _state.slots.filter(function (s) { return s.role === 'chadaebi'; });
        var n = existingChadaebi.length + 1;
        _state.slots.push({ role: 'chadaebi', label: '차대비 ' + n, workerName: null });
      }
    }

    renderCards();
    showSlotUI();
  }

  // -------------------------------------------------------
  // 단계 4: 합성
  // -------------------------------------------------------
  function step4Compose(projectName) {
    // 사업소 선택 검증
    var officeEl = getEl('field-office');
    if (officeEl && !officeEl.value) {
      alert('사업소를 선택하세요.');
      return Promise.resolve();
    }

    var workers = _state.slots
      .filter(function (s) { return s.role !== 'document'; })
      .map(function (s) { return s.label; });
    // 실제 작업원 이름 목록은 AppMain에서 가져옴
    var allWorkerStr = (window.AppMain ? window.AppMain.getSelectedWorkers() : []).join(' ');
    var dateStr = (getEl('field-date') || {}).value || '';

    var tasks = [];

    _state.slots.forEach(function (slot, idx) {
      var file = _state.photos[idx];
      if (!file) return; // 사진 없는 카드는 스킵

      var boardData;
      var label;
      var filename;

      if (slot.role === 'worker') {
        boardData = window.AppMain.collectBoardData(allWorkerStr);
        label = '작업원 사진';
        filename = buildFilename(dateStr, '작업자', 1);
      } else if (slot.role === 'document') {
        boardData = window.AppMain.collectBoardData(allWorkerStr);
        label = '서류 사진';
        filename = buildFilename(dateStr, '서류', 1);
      } else {
        var workerName = slot.workerName || slot.label;
        boardData = window.AppMain.collectBoardData(workerName);
        label = slot.label;
        filename = buildFilename(dateStr, '차대비', workerName);
      }

      tasks.push({ idx: idx, file: file, boardData: boardData, label: label, filename: filename });
    });

    if (tasks.length === 0) {
      renderEmptyPreviewGrid();
      return Promise.resolve();
    }

    var promises = tasks.map(function (t) {
      return Compose.compose(t.file, t.boardData).then(function (blob) {
        return { idx: t.idx, label: t.label, blob: blob, filename: t.filename };
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
        _state.composed[r.idx] = { blob: r.blob, blobUrl: url, filename: r.filename, label: r.label };
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

      var composed = _state.composed[r.idx];
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
  //   → onChange 핸들러 안에서 GPS Promise 결과를 기다린 뒤 카드 UI 진입
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

    // 사진 선택이 완료되면 GPS 결과를 기다린 뒤 카드 UI 진입
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
        step3SlotCardUI(files, workers);

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
    var workers = (window.AppMain ? window.AppMain.getSelectedWorkers() : []).slice().sort();
    var office = (getEl('field-office') || {}).value || '';
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

    var items = [];

    Object.keys(_state.composed).forEach(function (k) {
      var c = _state.composed[k];
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

    var addBtn = getEl('slot-add-btn');
    if (addBtn) addBtn.addEventListener('click', addChadaebiSlot);

    var clearPhotosBtn = getEl('slot-clear-photos-btn');
    if (clearPhotosBtn) clearPhotosBtn.addEventListener('click', clearAllPhotos);
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
