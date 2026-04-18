/*
 * app.js — Phase B: 공통필드 개편
 *   - B-1: 공사명 <select>
 *   - B-2: 사업소 고정
 *   - B-3: 작업장소 GPS + 지도 모달
 *   - B-4: 작업원 칩 UI
 *   - B-5: "기존과 동일" 자동 감지
 *   - B-6: 날짜/내용 자동 (v1 유지)
 *
 * compose.js 수정 금지 (Phase C)
 * Web Share API 호출부 제거됨 (Phase D)
 * capture 속성 추가 금지 (Phase C)
 */

(function () {
  var AM_HOUR_BOUNDARY = 12;

  // Phase C에서 접근할 선택된 작업원 접근자 — 외부 참조 가능
  // getSelectedWorkers() → string[]
  var _selectedWorkers = [];

  /** 현재 선택된 작업원 배열 반환 (합성 등 외부 참조용) */
  function getSelectedWorkers() {
    return _selectedWorkers.slice();
  }

  // 지도 모달 내부 상태
  var _mapState = {
    map: null,
    marker: null,
    pendingCoord: null,   // { lat, lng }
    pendingAddress: null
  };

  // 사진 상태 (Phase C까지 유지)
  var photoState = {
    workers: { file: null, blobUrl: null },
    documents: { file: null, blobUrl: null },
    vehicles: []
  };

  var previewUrls = [];

  // -------------------------------------------------------
  // 초기화
  // -------------------------------------------------------
  function init() {
    buildProjectSelect();
    initOffice();
    loadWorkplace();
    autoFillDate();
    autoFillContent();
    buildWorkerChips();
    refreshWorkerDatalist();
    bindFormEvents();
    bindMatchBanner();
    bindPhotoEvents();
    bindComposeBtn();
    bindCrewUI();
    bindSessionCopyBtns();
    bindSettingsBtn();
    bindMapModal();
    refreshCrewSelect();
    refreshSessionCopyBtnState();
    // 초기 매치 감지
    triggerMatchCheck();
  }

  // -------------------------------------------------------
  // B-1: 공사명 <select>
  // -------------------------------------------------------
  function buildProjectSelect() {
    var sel = document.getElementById('project-name');
    var state = Storage.getState();
    var names = state.projectNames || [];

    sel.innerHTML = '';

    if (names.length === 0) {
      // 가드: projectNames 비어있으면 안내 옵션
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '-- 공사명 없음 (설정에서 추가하세요) --';
      sel.appendChild(opt);
      var hint = document.createElement('p');
      hint.className = 'warn';
      hint.style.fontSize = '13px';
      hint.style.marginTop = '4px';
      hint.textContent = '설정 페이지에서 공사명을 먼저 등록해주세요.';
      sel.parentNode.appendChild(hint);
      return;
    }

    names.forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });

    // 기본값 = lastSelected.projectName (없으면 첫 번째)
    var last = state.lastSelected && state.lastSelected.projectName;
    if (last && names.indexOf(last) !== -1) {
      sel.value = last;
    } else {
      sel.value = names[0];
      Storage.setLastSelected({ projectName: names[0] });
    }
  }

  // -------------------------------------------------------
  // B-2: 사업소 고정
  // -------------------------------------------------------
  function initOffice() {
    Storage.setLastSelected({ office: '마포용산지사' });
  }

  // -------------------------------------------------------
  // 작업장소 복원
  // -------------------------------------------------------
  function loadWorkplace() {
    var state = Storage.getState();
    var ls = state.lastSelected || {};
    if (ls.workplace) {
      document.getElementById('workplace').value = ls.workplace;
    }
  }

  // -------------------------------------------------------
  // B-6: 날짜 자동 채움
  // -------------------------------------------------------
  function autoFillDate() {
    var today = new Date();
    var y = today.getFullYear();
    var m = String(today.getMonth() + 1).padStart(2, '0');
    var d = String(today.getDate()).padStart(2, '0');
    document.getElementById('field-date').value = y + '.' + m + '.' + d;
  }

  // -------------------------------------------------------
  // B-6: 내용 자동 채움 (시간대 기반)
  // -------------------------------------------------------
  function autoFillContent() {
    var hour = new Date().getHours();
    var slot = hour < AM_HOUR_BOUNDARY ? '오전' : '오후';
    var el = document.getElementById('field-content');
    if (!el.value) {
      el.value = '작업전 안전회의(' + slot + ')';
    }
  }

  // -------------------------------------------------------
  // B-4: 작업원 칩 렌더
  // -------------------------------------------------------
  function buildWorkerChips() {
    var container = document.getElementById('worker-chips');
    container.innerHTML = '';

    var state = Storage.getState();
    var workers = state.workers || [];
    var lastWorkers = (state.lastSelected && state.lastSelected.workers) || [];

    if (workers.length === 0) {
      container.innerHTML = '<span class="empty-hint">등록된 작업원이 없습니다.</span>';
      _selectedWorkers = [];
      return;
    }

    workers.forEach(function (name) {
      var label = document.createElement('label');
      label.className = 'worker-chip';

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = name;
      cb.checked = lastWorkers.indexOf(name) !== -1;

      cb.addEventListener('change', onWorkerChipChange);

      label.appendChild(cb);
      label.appendChild(document.createTextNode(name));
      container.appendChild(label);
    });

    // 초기 _selectedWorkers 동기화
    _selectedWorkers = getCheckedWorkers();
  }

  function getCheckedWorkers() {
    var checkboxes = document.querySelectorAll('#worker-chips input[type="checkbox"]');
    var result = [];
    checkboxes.forEach(function (cb) {
      if (cb.checked) result.push(cb.value);
    });
    return result;
  }

  function onWorkerChipChange() {
    _selectedWorkers = getCheckedWorkers();
    Storage.setLastSelected({ workers: _selectedWorkers.slice() });
    triggerMatchCheck();
  }

  // -------------------------------------------------------
  // 폼 이벤트 바인딩
  // -------------------------------------------------------
  function bindFormEvents() {
    var projectSel = document.getElementById('project-name');
    var workplaceEl = document.getElementById('workplace');
    var gpsBtn = document.getElementById('btn-gps');

    projectSel.addEventListener('change', function () {
      Storage.setLastSelected({ projectName: this.value });
      triggerMatchCheck();
    });

    workplaceEl.addEventListener('input', function () {
      Storage.setLastSelected({ workplace: this.value });
    });

    gpsBtn.addEventListener('click', requestGPS);
  }

  // -------------------------------------------------------
  // B-3: GPS 역지오코딩 (v1 재사용, 함수명 유지)
  // -------------------------------------------------------
  function requestGPS() {
    var btn = document.getElementById('btn-gps');
    var workplaceEl = document.getElementById('workplace');
    var statusEl = document.getElementById('gps-status');

    if (!navigator.geolocation) {
      statusEl.textContent = 'GPS 미지원 브라우저. 수동 입력하세요.';
      return;
    }

    btn.disabled = true;
    statusEl.textContent = '위치 획득 중...';

    navigator.geolocation.getCurrentPosition(
      function (pos) {
        btn.disabled = false;
        statusEl.textContent = '';
        var lat = pos.coords.latitude;
        var lng = pos.coords.longitude;
        reverseGeocode(lat, lng, function (address) {
          if (address) {
            workplaceEl.value = address;
            Storage.setLastSelected({ workplace: address });
          } else {
            statusEl.textContent = 'GPS 주소 변환 실패. 수동 입력하세요.';
          }
        });
      },
      function (err) {
        btn.disabled = false;
        var msg = 'GPS 실패. 수동 입력하세요.';
        if (err.code === 1) msg = '위치 권한이 거부되었습니다. 수동 입력하세요.';
        else if (err.code === 3) msg = 'GPS 시간 초과. 수동 입력하세요.';
        statusEl.textContent = msg;
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }

  function reverseGeocode(lat, lng, callback) {
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
  // B-3: 지도 모달
  // -------------------------------------------------------
  function bindMapModal() {
    document.getElementById('btn-open-map').addEventListener('click', openMapModal);
    document.getElementById('btn-map-cancel').addEventListener('click', closeMapModal);
    document.getElementById('btn-map-confirm').addEventListener('click', confirmMapSelection);

    // 배경 클릭으로 닫기
    document.getElementById('map-modal-backdrop').addEventListener('click', function (e) {
      if (e.target === this) closeMapModal();
    });
  }

  function openMapModal() {
    if (_mapState.marker) {
      _mapState.marker.setMap(null);
      _mapState.marker = null;
    }
    document.getElementById('map-modal-backdrop').style.display = 'flex';

    // 카카오 SDK 로드 후 지도 초기화
    if (typeof kakao === 'undefined' || !kakao.maps) {
      document.getElementById('map-modal-address').textContent = '카카오 지도 SDK를 불러오는 중...';
      return;
    }

    kakao.maps.load(function () {
      initMapIfNeeded();
    });
  }

  function initMapIfNeeded() {
    if (_mapState.map) {
      // 이미 생성된 경우 재사용 (리사이즈 반영)
      kakao.maps.event.trigger(_mapState.map, 'resize');
      return;
    }

    var container = document.getElementById('map-modal-map');

    // 기본 중심: 서울 시청
    var defaultCenter = new kakao.maps.LatLng(37.5665, 126.9780);

    _mapState.map = new kakao.maps.Map(container, {
      center: defaultCenter,
      level: 4
    });

    // GPS 현재 좌표로 중심 이동 (실패 시 서울 시청 유지)
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(function (pos) {
        var center = new kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
        _mapState.map.setCenter(center);
      }, function () { /* 실패 시 서울 시청 기본값 유지 */ }, { timeout: 5000 });
    }

    // 롱프레스: touchstart + setTimeout(500) + touchmove/touchend 취소
    bindLongPress(container);
  }

  function bindLongPress(container) {
    var timer = null;
    var moved = false;

    function onPressStart(e) {
      moved = false;
      timer = setTimeout(function () {
        if (!moved) {
          var coord = getCoordFromEvent(e);
          if (coord) dropPin(coord.lat, coord.lng);
        }
      }, 500);
    }

    function onPressMove() {
      moved = true;
      clearTimeout(timer);
    }

    function onPressEnd() {
      clearTimeout(timer);
    }

    // 터치 (모바일)
    container.addEventListener('touchstart', onPressStart, { passive: true });
    container.addEventListener('touchmove', onPressMove, { passive: true });
    container.addEventListener('touchend', onPressEnd);

    // 마우스 (데스크톱 테스트)
    container.addEventListener('mousedown', onPressStart);
    container.addEventListener('mousemove', onPressMove);
    container.addEventListener('mouseup', onPressEnd);
    container.addEventListener('mouseleave', onPressEnd);
  }

  function getCoordFromEvent(e) {
    if (!_mapState.map) return null;
    var mapEl = document.getElementById('map-modal-map');
    var rect = mapEl.getBoundingClientRect();

    var clientX, clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    var x = clientX - rect.left;
    var y = clientY - rect.top;

    var proj = _mapState.map.getProjection();
    var point = new kakao.maps.Point(x, y);
    var latLng = proj.coordsFromContainerPoint(point);
    return { lat: latLng.getLat(), lng: latLng.getLng() };
  }

  function dropPin(lat, lng) {
    var position = new kakao.maps.LatLng(lat, lng);

    if (_mapState.marker) {
      _mapState.marker.setPosition(position);
    } else {
      _mapState.marker = new kakao.maps.Marker({ position: position, map: _mapState.map });
    }

    _mapState.pendingCoord = { lat: lat, lng: lng };
    _mapState.pendingAddress = null;

    var addrEl = document.getElementById('map-modal-address');
    addrEl.textContent = '주소 변환 중...';
    document.getElementById('btn-map-confirm').disabled = true;

    reverseGeocode(lat, lng, function (address) {
      _mapState.pendingAddress = address;
      addrEl.textContent = address || '주소를 찾을 수 없습니다. (좌표만 저장)';
      document.getElementById('btn-map-confirm').disabled = false;
    });
  }

  function confirmMapSelection() {
    if (!_mapState.pendingCoord) return;

    var address = _mapState.pendingAddress || '';
    document.getElementById('workplace').value = address;
    Storage.setLastSelected({
      workplace: address,
      workplaceCoord: _mapState.pendingCoord
    });

    closeMapModal();
  }

  function closeMapModal() {
    document.getElementById('map-modal-backdrop').style.display = 'none';
    _mapState.pendingCoord = null;
    _mapState.pendingAddress = null;
    // 마커는 유지 (다음 오픈 시 이전 핀 참고용)
    document.getElementById('btn-map-confirm').disabled = true;
    document.getElementById('map-modal-address').textContent = '핀 위치 주소가 여기 표시됩니다';
  }

  // -------------------------------------------------------
  // B-5: "기존과 동일" 자동 감지
  // -------------------------------------------------------
  function triggerMatchCheck() {
    var sel = document.getElementById('project-name');
    var projectName = sel ? sel.value : '';
    var workers = getCheckedWorkers().slice().sort();

    var matched = Storage.findMatchingSession(projectName, workers);

    var banner = document.getElementById('match-banner');
    if (matched) {
      // 프리필
      document.getElementById('office').value = matched.office || '마포용산지사';
      document.getElementById('workplace').value = matched.workplace || '';
      Storage.setLastSelected({
        office: matched.office || '마포용산지사',
        workplace: matched.workplace || '',
        workplaceCoord: matched.workplaceCoord || null
      });
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  }

  function bindMatchBanner() {
    document.getElementById('btn-match-reset').addEventListener('click', function () {
      document.getElementById('office').value = '마포용산지사';
      document.getElementById('workplace').value = '';
      Storage.setLastSelected({ workplace: '', workplaceCoord: null });
      document.getElementById('match-banner').style.display = 'none';
    });
  }

  // -------------------------------------------------------
  // 작업원 datalist 갱신 (하위 호환, Phase C까지)
  // -------------------------------------------------------
  function refreshWorkerDatalist() {
    var history = Storage.getWorkerHistory();
    var dl = document.getElementById('worker-datalist');
    if (!dl) return;
    dl.innerHTML = '';
    history.forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      dl.appendChild(opt);
    });
  }

  // -------------------------------------------------------
  // 합성에서 참조하는 공통 데이터 수집
  // -------------------------------------------------------
  function collectBoardData(workersStr) {
    return {
      projectName: (document.getElementById('project-name') || {}).value || '',
      office: document.getElementById('office').value || '마포용산지사',
      workplace: document.getElementById('workplace').value.trim(),
      content: document.getElementById('field-content').value.trim(),
      workers: workersStr,
      workDate: document.getElementById('field-date').value.trim()
    };
  }

  // -------------------------------------------------------
  // 사진 섹션 바인딩 (Phase C에서 확장 예정)
  // -------------------------------------------------------
  function bindPhotoEvents() {
    document.getElementById('file-workers').addEventListener('change', function (e) {
      handleSinglePhoto(e.target.files[0], 'workers');
      e.target.value = '';
    });
    document.getElementById('btn-delete-workers').addEventListener('click', function () {
      deleteSinglePhoto('workers');
    });

    document.getElementById('file-documents').addEventListener('change', function (e) {
      handleSinglePhoto(e.target.files[0], 'documents');
      e.target.value = '';
    });
    document.getElementById('btn-delete-documents').addEventListener('click', function () {
      deleteSinglePhoto('documents');
    });

    document.getElementById('file-vehicles').addEventListener('change', function (e) {
      var files = Array.prototype.slice.call(e.target.files);
      files.forEach(function (file) { addVehiclePhoto(file); });
      e.target.value = '';
    });
  }

  function handleSinglePhoto(file, section) {
    if (!file) return;
    var state = photoState[section];
    if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
    state.file = file;
    state.blobUrl = URL.createObjectURL(file);
    renderSinglePreview(section, state.blobUrl, file.name);
  }

  function deleteSinglePhoto(section) {
    var state = photoState[section];
    if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
    state.file = null;
    state.blobUrl = null;
    clearSinglePreview(section);
  }

  function renderSinglePreview(section, url, name) {
    var wrap = document.getElementById('preview-' + section);
    wrap.innerHTML = '';
    var img = document.createElement('img');
    img.src = url;
    img.className = 'thumb';
    img.alt = name;
    wrap.appendChild(img);
    document.getElementById('btn-delete-' + section).style.display = 'inline-block';
  }

  function clearSinglePreview(section) {
    document.getElementById('preview-' + section).innerHTML = '<span class="empty-hint">사진 없음</span>';
    document.getElementById('btn-delete-' + section).style.display = 'none';
  }

  function addVehiclePhoto(file) {
    var blobUrl = URL.createObjectURL(file);
    var item = { file: file, blobUrl: blobUrl, tag: '' };
    var idx = photoState.vehicles.length;
    photoState.vehicles.push(item);
    renderVehicleItem(item, idx);
  }

  function renderVehicleItem(item, idx) {
    var list = document.getElementById('vehicle-list');
    var div = document.createElement('div');
    div.className = 'vehicle-item';
    div.dataset.idx = idx;

    var img = document.createElement('img');
    img.src = item.blobUrl;
    img.className = 'thumb';
    img.alt = '차대비 사진 ' + (idx + 1);

    var tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.placeholder = '작업원 이름 (1명)';
    tagInput.className = 'tag-input';
    tagInput.setAttribute('list', 'worker-datalist');
    tagInput.value = item.tag;
    tagInput.addEventListener('input', function () {
      photoState.vehicles[idx].tag = this.value.trim();
    });

    var delBtn = document.createElement('button');
    delBtn.textContent = '삭제';
    delBtn.className = 'btn-sm btn-danger';
    delBtn.addEventListener('click', function () {
      URL.revokeObjectURL(item.blobUrl);
      photoState.vehicles.splice(idx, 1);
      rebuildVehicleList();
    });

    div.appendChild(img);
    div.appendChild(tagInput);
    div.appendChild(delBtn);
    list.appendChild(div);
  }

  function rebuildVehicleList() {
    var list = document.getElementById('vehicle-list');
    list.innerHTML = '';
    photoState.vehicles.forEach(function (item, idx) {
      renderVehicleItem(item, idx);
    });
  }

  // -------------------------------------------------------
  // 합성 미리보기
  // -------------------------------------------------------
  function bindComposeBtn() {
    document.getElementById('btn-compose').addEventListener('click', runCompose);
  }

  function buildComposeTasks() {
    var tasks = [];
    // 작업원 칩에서 선택된 이름 사용 (B-4 통일)
    var workerStr = getSelectedWorkers().join(' ');

    if (photoState.workers.file) {
      tasks.push({
        file: photoState.workers.file,
        boardData: collectBoardData(workerStr),
        label: '작업자 사진',
        section: 'workers',
        index: 0
      });
    }

    if (photoState.documents.file) {
      tasks.push({
        file: photoState.documents.file,
        boardData: collectBoardData(workerStr),
        label: '서류 사진',
        section: 'documents',
        index: 0
      });
    }

    photoState.vehicles.forEach(function (v, i) {
      if (v.file) {
        tasks.push({
          file: v.file,
          boardData: collectBoardData(v.tag || ''),
          label: '차대비 ' + (i + 1),
          section: 'vehicles',
          index: i
        });
      }
    });

    return tasks;
  }

  function dateForFilename(dateStr) {
    return (dateStr || '').replace(/\./g, '');
  }

  function runCompose() {
    var btn = document.getElementById('btn-compose');
    var resultArea = document.getElementById('compose-result');
    btn.disabled = true;
    resultArea.innerHTML = '<p>합성 중...</p>';

    revokePreviewUrls();

    var tasks = buildComposeTasks();

    if (tasks.length === 0) {
      resultArea.innerHTML = '<p class="warn">업로드된 사진이 없습니다.</p>';
      btn.disabled = false;
      return;
    }

    var promises = tasks.map(function (t) {
      return Compose.compose(t.file, t.boardData).then(function (blob) {
        return { blob: blob, label: t.label };
      });
    });

    Promise.all(promises).then(function (results) {
      resultArea.innerHTML = '';
      results.forEach(function (r) {
        var url = URL.createObjectURL(r.blob);
        previewUrls.push(url);

        var wrap = document.createElement('div');
        wrap.className = 'preview-item';

        var labelEl = document.createElement('p');
        labelEl.className = 'preview-label';
        labelEl.textContent = r.label;

        var img = document.createElement('img');
        img.src = url;
        img.className = 'preview-full';
        img.alt = r.label + ' 합성 결과';

        wrap.appendChild(labelEl);
        wrap.appendChild(img);
        resultArea.appendChild(wrap);
      });

      btn.disabled = false;
    }).catch(function (err) {
      resultArea.innerHTML = '<p class="warn">합성 오류: ' + err.message + '</p>';
      btn.disabled = false;
    });
  }

  function revokePreviewUrls() {
    previewUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    previewUrls = [];
  }

  // -------------------------------------------------------
  // Phase 5: 세션 복사 (v1 호환 — CSS 숨김 상태, DOM 유지)
  // -------------------------------------------------------
  function bindSessionCopyBtns() {
    document.getElementById('btn-copy-morning').addEventListener('click', function () {
      var sessions = Storage.getRecentSessions();
      if (sessions.morning && Storage.isTodaySession(sessions.morning)) {
        applySession(sessions.morning);
      } else {
        alert('오전 세션 기록이 없습니다.');
      }
    });

    document.getElementById('btn-copy-yesterday').addEventListener('click', function () {
      var sessions = Storage.getRecentSessions();
      if (sessions.yesterday) {
        applySession(sessions.yesterday);
      } else {
        alert('어제 세션 기록이 없습니다.');
      }
    });
  }

  function refreshSessionCopyBtnState() {
    var sessions = Storage.getRecentSessions();
    var morningBtn = document.getElementById('btn-copy-morning');
    var yesterdayBtn = document.getElementById('btn-copy-yesterday');
    var hintEl = document.getElementById('session-hint');

    var hasMorning = sessions.morning && Storage.isTodaySession(sessions.morning);
    var hasYesterday = !!sessions.yesterday;

    morningBtn.disabled = !hasMorning;
    yesterdayBtn.disabled = !hasYesterday;

    var hints = [];
    if (hasMorning) hints.push('오전 기록 있음');
    if (hasYesterday) hints.push('어제 기록 있음');
    hintEl.textContent = hints.length > 0 ? hints.join(' / ') : '';
  }

  function applySession(session) {
    if (session.commonFields) {
      if (session.commonFields.office) {
        document.getElementById('office').value = session.commonFields.office;
        Storage.setLastSelected({ office: session.commonFields.office });
      }
      if (session.commonFields.workplace) {
        document.getElementById('workplace').value = session.commonFields.workplace;
        Storage.setLastSelected({ workplace: session.commonFields.workplace });
      }
    }
    alert('작업 정보를 복사했습니다. 사진은 다시 선택해주세요.');
    refreshSessionCopyBtnState();
  }

  // -------------------------------------------------------
  // Phase 5: 조 저장/불러오기 (v1 alias — CSS 숨김 상태, DOM 유지)
  // -------------------------------------------------------
  function bindCrewUI() {
    document.getElementById('btn-save-crew').addEventListener('click', function () {
      var workers = getSelectedWorkers();
      if (workers.length === 0) {
        alert('작업원을 먼저 선택해주세요.');
        return;
      }
      var name = prompt('저장할 조 이름을 입력하세요 (예: A조, 용산팀):');
      if (name === null) return;
      name = (name || '').trim();
      if (!name) { alert('조 이름을 입력해주세요.'); return; }
      var crew = Storage.saveCrew(name, workers);
      if (crew) {
        refreshCrewSelect();
        renderCrewList();
        alert('"' + crew.name + '"이(가) 저장되었습니다.');
      }
    });

    document.getElementById('btn-load-crew').addEventListener('click', function () {
      var sel = document.getElementById('select-crew');
      var id = sel.value;
      if (!id) { alert('불러올 조를 선택해주세요.'); return; }
      var crews = Storage.getSavedCrews();
      var crew = null;
      for (var i = 0; i < crews.length; i++) {
        if (crews[i].id === id) { crew = crews[i]; break; }
      }
      if (!crew) { alert('해당 조를 찾을 수 없습니다.'); return; }
      alert('"' + crew.name + '"을(를) 불러왔습니다.');
    });
  }

  function refreshCrewSelect() {
    var sel = document.getElementById('select-crew');
    var current = sel.value;
    sel.innerHTML = '';
    var defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '-- 저장된 조 선택 --';
    sel.appendChild(defaultOpt);
    var crews = Storage.getSavedCrews();
    crews.forEach(function (crew) {
      var opt = document.createElement('option');
      opt.value = crew.id;
      opt.textContent = crew.name + ' (' + crew.members.join(', ') + ')';
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
    renderCrewList();
  }

  function renderCrewList() {
    var listEl = document.getElementById('crew-list');
    listEl.innerHTML = '';
    var crews = Storage.getSavedCrews();
    if (crews.length === 0) {
      var empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = '저장된 조가 없습니다.';
      listEl.appendChild(empty);
      return;
    }
    crews.forEach(function (crew) {
      var row = document.createElement('div');
      row.className = 'crew-row';
      var nameSpan = document.createElement('span');
      nameSpan.className = 'crew-name';
      nameSpan.textContent = crew.name;
      var membersSpan = document.createElement('span');
      membersSpan.className = 'crew-members';
      membersSpan.textContent = crew.members.join(', ');
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-sm btn-danger';
      delBtn.textContent = 'X';
      delBtn.setAttribute('aria-label', crew.name + ' 삭제');
      (function (id, crewName) {
        delBtn.addEventListener('click', function () {
          if (confirm('"' + crewName + '"을(를) 삭제하시겠습니까?')) {
            Storage.deleteCrew(id);
            refreshCrewSelect();
          }
        });
      })(crew.id, crew.name);
      row.appendChild(nameSpan);
      row.appendChild(membersSpan);
      row.appendChild(delBtn);
      listEl.appendChild(row);
    });
  }

  // -------------------------------------------------------
  // 설정 버튼
  // -------------------------------------------------------
  function bindSettingsBtn() {
    var btn = document.getElementById('btn-go-settings');
    if (btn) {
      btn.addEventListener('click', function () {
        Router.navigate('#/settings');
      });
    }
  }

  // -------------------------------------------------------
  // DOM 준비 후 실행
  // -------------------------------------------------------
  function setup() {
    Router.register('#/', function () {
      document.getElementById('page-main').style.display = 'block';
      document.getElementById('page-settings').style.display = 'none';
      if (!setup._mainInited) {
        setup._mainInited = true;
        init();
        return;
      }
      // 설정에서 재진입 시 칩/select 재렌더
      buildWorkerChips();
      buildProjectSelect();
      refreshWorkerDatalist();
      triggerMatchCheck();
    });

    Router.register('#/settings', function () {
      document.getElementById('page-main').style.display = 'none';
      document.getElementById('page-settings').style.display = 'block';
      Settings.render();
    });

    Settings.init();
    Router.init();
  }

  setup._mainInited = false;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }

  // -------------------------------------------------------
  // 외부 노출 (Phase C에서 참조할 공개 함수)
  // -------------------------------------------------------
  window.AppMain = {
    getSelectedWorkers: getSelectedWorkers,
    collectBoardData: collectBoardData,
    triggerMatchCheck: triggerMatchCheck
  };
})();
