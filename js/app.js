/*
 * app.js — 공통필드 폼, 사진 3섹션, 합성 미리보기, 밴드 공유, 히스토리/조 관리
 */

(function () {
  var OFFICES = [
    '광진성동지사',
    '동대문중랑지사',
    '서대문은평지사',
    '서울본부직할',
    '강북성북지사',
    '마포용산지사',
    '노원도봉지사'
  ];

  var AM_HOUR_BOUNDARY = 12;

  var photoState = {
    workers: { file: null, blobUrl: null, tags: [] },
    documents: { file: null, blobUrl: null, tags: [] },
    vehicles: []
  };

  var previewUrls = [];
  var shareDownloadUrls = [];

  // -------------------------------------------------------
  // 초기화
  // -------------------------------------------------------
  function init() {
    buildOfficeOptions();
    loadCommonFields();
    autoFillDate();
    autoFillContent();
    bindFormEvents();
    bindPhotoEvents();
    bindComposeBtn();
    bindShareBtn();
    bindCrewUI();
    bindSessionCopyBtns();
    bindSettingsBtn();
    refreshCrewSelect();
    refreshSessionCopyBtnState();
  }

  // -------------------------------------------------------
  // 사업소 드롭다운
  // -------------------------------------------------------
  function buildOfficeOptions() {
    var sel = document.getElementById('field-office');
    OFFICES.forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  }

  // -------------------------------------------------------
  // localStorage 복원
  // -------------------------------------------------------
  function loadCommonFields() {
    var fields = Storage.getCommonFields();
    if (fields.projectName) {
      document.getElementById('field-project').value = fields.projectName;
    }
    if (fields.lastOffice) {
      document.getElementById('field-office').value = fields.lastOffice;
    }
    if (fields.workplace) {
      document.getElementById('field-workplace').value = fields.workplace;
    }
    refreshWorkerDatalist();
  }

  function refreshWorkerDatalist() {
    var history = Storage.getWorkerHistory();
    var dl = document.getElementById('worker-datalist');
    dl.innerHTML = '';
    history.forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      dl.appendChild(opt);
    });
  }

  // -------------------------------------------------------
  // 날짜 자동 채움
  // -------------------------------------------------------
  function autoFillDate() {
    var today = new Date();
    var y = today.getFullYear();
    var m = String(today.getMonth() + 1).padStart(2, '0');
    var d = String(today.getDate()).padStart(2, '0');
    document.getElementById('field-date').value = y + '.' + m + '.' + d;
  }

  // -------------------------------------------------------
  // 내용 자동 채움 (시간대 기반)
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
  // 폼 이벤트 바인딩
  // -------------------------------------------------------
  function bindFormEvents() {
    var projectEl = document.getElementById('field-project');
    var officeEl = document.getElementById('field-office');
    var workplaceEl = document.getElementById('field-workplace');
    var gpsBtn = document.getElementById('btn-gps');

    projectEl.addEventListener('input', function () {
      Storage.saveCommonFields({ projectName: this.value });
    });

    officeEl.addEventListener('change', function () {
      Storage.saveLastOffice(this.value);
    });

    workplaceEl.addEventListener('input', function () {
      Storage.saveWorkplace(this.value);
    });

    gpsBtn.addEventListener('click', requestGPS);
  }

  // -------------------------------------------------------
  // GPS 역지오코딩
  // -------------------------------------------------------
  function requestGPS() {
    var btn = document.getElementById('btn-gps');
    var workplaceEl = document.getElementById('field-workplace');
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
            Storage.saveWorkplace(address);
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
  // 작업원 입력 → blur 시 히스토리 저장
  // -------------------------------------------------------
  function bindTagBlurSave(inputEl, isMulti) {
    inputEl.addEventListener('blur', function () {
      if (isMulti) {
        parseTags(this.value).forEach(function (name) {
          Storage.addWorkerIfNew(name);
        });
      } else {
        Storage.addWorkerIfNew(this.value.trim());
      }
      refreshWorkerDatalist();
    });
  }

  // -------------------------------------------------------
  // 사진 섹션 바인딩
  // -------------------------------------------------------
  function bindPhotoEvents() {
    var tagsWorkers = document.getElementById('tags-workers');
    var tagsDocuments = document.getElementById('tags-documents');

    document.getElementById('file-workers').addEventListener('change', function (e) {
      handleSinglePhoto(e.target.files[0], 'workers');
      e.target.value = '';
    });
    document.getElementById('btn-delete-workers').addEventListener('click', function () {
      deleteSinglePhoto('workers');
    });
    tagsWorkers.addEventListener('input', function () {
      photoState.workers.tags = parseTags(this.value);
    });
    bindTagBlurSave(tagsWorkers, true);

    document.getElementById('file-documents').addEventListener('change', function (e) {
      handleSinglePhoto(e.target.files[0], 'documents');
      e.target.value = '';
    });
    document.getElementById('btn-delete-documents').addEventListener('click', function () {
      deleteSinglePhoto('documents');
    });
    tagsDocuments.addEventListener('input', function () {
      photoState.documents.tags = parseTags(this.value);
    });
    bindTagBlurSave(tagsDocuments, true);

    document.getElementById('file-vehicles').addEventListener('change', function (e) {
      var files = Array.prototype.slice.call(e.target.files);
      files.forEach(function (file) {
        addVehiclePhoto(file);
      });
      e.target.value = '';
    });
  }

  function parseTags(str) {
    return str.split(/[,\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
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
    state.tags = [];
    var tagsEl = document.getElementById('tags-' + section);
    if (tagsEl) tagsEl.value = '';
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
    tagInput.addEventListener('blur', function () {
      Storage.addWorkerIfNew(this.value.trim());
      refreshWorkerDatalist();
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

  function collectBoardData(workers) {
    return {
      projectName: document.getElementById('field-project').value.trim(),
      office: document.getElementById('field-office').value,
      workplace: document.getElementById('field-workplace').value.trim(),
      content: document.getElementById('field-content').value.trim(),
      workers: workers,
      workDate: document.getElementById('field-date').value.trim()
    };
  }

  function buildComposeTasks() {
    var tasks = [];

    if (photoState.workers.file) {
      tasks.push({
        file: photoState.workers.file,
        boardData: collectBoardData(photoState.workers.tags.join(' ') || ''),
        label: '작업자 사진',
        section: 'workers',
        index: 0
      });
    }

    if (photoState.documents.file) {
      tasks.push({
        file: photoState.documents.file,
        boardData: collectBoardData(photoState.documents.tags.join(' ') || ''),
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

  // 작업일자 "YYYY.MM.DD" → "YYYYMMDD" (파일명용)
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

      var allWorkers = photoState.workers.tags.concat(photoState.documents.tags);
      photoState.vehicles.forEach(function (v) {
        if (v.tag) allWorkers.push(v.tag);
      });
      if (allWorkers.length > 0) {
        Storage.addWorkers(allWorkers);
        refreshWorkerDatalist();
      }

      btn.disabled = false;
    }).catch(function (err) {
      resultArea.innerHTML = '<p class="warn">합성 오류: ' + err.message + '</p>';
      btn.disabled = false;
    });
  }

  // -------------------------------------------------------
  // Phase 4: 밴드 공유
  // -------------------------------------------------------
  function bindShareBtn() {
    document.getElementById('btn-share').addEventListener('click', runShare);
  }

  function runShare() {
    var btn = document.getElementById('btn-share');
    var statusEl = document.getElementById('share-status');
    var fallbackEl = document.getElementById('share-fallback');

    btn.disabled = true;
    statusEl.textContent = '합성 중...';
    fallbackEl.style.display = 'none';

    revokePreviewUrls();
    revokeShareDownloadUrls();

    var tasks = buildComposeTasks();

    if (tasks.length === 0) {
      statusEl.textContent = '';
      statusEl.innerHTML = '<span class="warn">업로드된 사진이 없습니다.</span>';
      btn.disabled = false;
      return;
    }

    var dateStr = document.getElementById('field-date').value.trim();
    var dateTag = dateForFilename(dateStr);

    var promises = tasks.map(function (t) {
      return Compose.compose(t.file, t.boardData).then(function (blob) {
        var filename = 'board_' + dateTag + '_' + t.section + '_' + t.index + '.jpg';
        var file = new File([blob], filename, { type: 'image/jpeg', lastModified: Date.now() });
        return file;
      });
    });

    Promise.all(promises).then(function (files) {
      statusEl.textContent = '';

      var canFileShare = (
        navigator.canShare &&
        navigator.share &&
        navigator.canShare({ files: files })
      );

      if (canFileShare) {
        var office = document.getElementById('field-office').value;
        var workplace = document.getElementById('field-workplace').value.trim();
        var content = document.getElementById('field-content').value.trim();

        return navigator.share({
          files: files,
          title: '동산보드판 사진',
          text: office + ' / ' + workplace + ' / ' + content
        }).then(function () {
          onShareSuccess();
          btn.disabled = false;
        }).catch(function (err) {
          btn.disabled = false;
          if (err.name === 'AbortError') {
            // 사용자가 공유 취소 — 조용히 무시
            return;
          }
          alert('공유 중 오류가 발생했습니다: ' + err.message);
        });
      } else {
        // 폴백: 다운로드 링크 제공
        btn.disabled = false;
        showShareFallback(files);
      }
    }).catch(function (err) {
      statusEl.textContent = '';
      btn.disabled = false;
      alert('합성 중 오류가 발생했습니다: ' + err.message);
    });
  }

  function showShareFallback(files) {
    var fallbackEl = document.getElementById('share-fallback');
    var downloadList = document.getElementById('share-download-list');
    downloadList.innerHTML = '';

    files.forEach(function (file) {
      var url = URL.createObjectURL(file);
      shareDownloadUrls.push(url);

      var a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.className = 'btn-secondary btn-sm download-link';
      a.textContent = file.name + ' 저장';
      downloadList.appendChild(a);
    });

    fallbackEl.style.display = 'block';
  }

  function revokePreviewUrls() {
    previewUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    previewUrls = [];
  }

  function revokeShareDownloadUrls() {
    shareDownloadUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    shareDownloadUrls = [];
  }

  function onShareSuccess() {
    var sessionData = {
      commonFields: {
        office: document.getElementById('field-office').value,
        workplace: document.getElementById('field-workplace').value.trim()
      },
      sections: {
        workers: { tags: photoState.workers.tags.slice() },
        documents: { tags: photoState.documents.tags.slice() },
        vehicles: photoState.vehicles.map(function (v) {
          return { tag: v.tag || '' };
        })
      }
    };
    Storage.recordSession(sessionData);
    refreshSessionCopyBtnState();
  }

  // -------------------------------------------------------
  // Phase 5: 세션 복사 ("오전과 동일" / "어제와 동일")
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
    // 사업소, 작업장소 복사
    if (session.commonFields) {
      if (session.commonFields.office) {
        document.getElementById('field-office').value = session.commonFields.office;
        Storage.saveLastOffice(session.commonFields.office);
      }
      if (session.commonFields.workplace) {
        document.getElementById('field-workplace').value = session.commonFields.workplace;
        Storage.saveWorkplace(session.commonFields.workplace);
      }
    }

    // 작업자 태그 복사
    if (session.sections) {
      if (session.sections.workers) {
        var wTags = session.sections.workers.tags || [];
        photoState.workers.tags = wTags.slice();
        document.getElementById('tags-workers').value = wTags.join(' ');
      }
      if (session.sections.documents) {
        var dTags = session.sections.documents.tags || [];
        photoState.documents.tags = dTags.slice();
        document.getElementById('tags-documents').value = dTags.join(' ');
      }
      // 차대비 사진은 복사 불가 — 사진을 새로 선택한 뒤 이름을 직접 입력해야 함
    }

    alert('작업 정보를 복사했습니다. 사진은 다시 촬영해주세요.');
    refreshSessionCopyBtnState();
  }

  // -------------------------------------------------------
  // Phase 5: 조 저장/불러오기
  // -------------------------------------------------------
  function bindCrewUI() {
    document.getElementById('btn-save-crew').addEventListener('click', function () {
      var tags = photoState.workers.tags.slice();
      if (tags.length === 0) {
        alert('작업자 사진 섹션에 작업원을 먼저 입력해주세요.');
        return;
      }
      var name = prompt('저장할 조 이름을 입력하세요 (예: A조, 용산팀):');
      if (name === null) return;
      name = name.trim();
      if (!name) {
        alert('조 이름을 입력해주세요.');
        return;
      }
      var crew = Storage.saveCrew(name, tags);
      if (crew) {
        refreshCrewSelect();
        renderCrewList();
        alert('"' + crew.name + '"이(가) 저장되었습니다.');
      }
    });

    document.getElementById('btn-load-crew').addEventListener('click', function () {
      var sel = document.getElementById('select-crew');
      var id = sel.value;
      if (!id) {
        alert('불러올 조를 선택해주세요.');
        return;
      }
      var crews = Storage.getSavedCrews();
      var crew = null;
      for (var i = 0; i < crews.length; i++) {
        if (crews[i].id === id) { crew = crews[i]; break; }
      }
      if (!crew) {
        alert('해당 조를 찾을 수 없습니다.');
        return;
      }

      var members = crew.members;
      // 작업자 + 서류 섹션 태그 덮어쓰기
      photoState.workers.tags = members.slice();
      photoState.documents.tags = members.slice();
      document.getElementById('tags-workers').value = members.join(' ');
      document.getElementById('tags-documents').value = members.join(' ');

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
    // 라우터에 메인/설정 핸들러 등록
    Router.register('#/', function () {
      document.getElementById('page-main').style.display = 'block';
      document.getElementById('page-settings').style.display = 'none';
      // 첫 진입 시에만 init 실행 (이후 재진입은 상태 유지)
      if (!setup._mainInited) {
        setup._mainInited = true;
        init(); // init 내부 loadCommonFields에서 refreshWorkerDatalist 호출
        return;
      }
      // 설정에서 작업원 추가 후 재진입 시 datalist 갱신
      refreshWorkerDatalist();
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
})();
