/*
 * autofill.js — Phase C: "자동 입히기" 통합 플로우
 *
 * 의존: storage.js, compose.js, app.js(window.AppMain)
 * 파일 입력: auto-file-workers / auto-file-documents / auto-file-vehicle
 *   (보조 UI의 #file-workers 등과 완전 분리 — 기존 핸들러 영향 없음)
 * 취소 감지: window.focus + confirm 패턴 대신 "선택" / "건너뛰기" UI 버튼 채택
 *   (PLAN의 Y/N confirm 패턴과의 차이: 모바일 change 미발화 우회를 위해 버튼 폴백 사용)
 */

(function () {

  // -------------------------------------------------------
  // 임시 상태 (메모리 only, localStorage 사용 안 함)
  // -------------------------------------------------------
  var _autoFillState = {
    active: false,
    step: 0,                   // 1~5
    workers: [],               // 현재 선택된 작업원 배열
    workersPhoto: null,        // { file, composedBlob, blobUrl }
    documentsPhoto: null,      // { file, composedBlob, blobUrl }
    vehiclesByWorker: {},      // { 이름: { file, composedBlob, blobUrl } }
    vehicleLoop: {
      index: 0,
      onDone: null
    }
  };

  // 다중 클릭 가드 — runSaveAndBand 동시 실행 방지
  var _saveInProgress = false;

  // -------------------------------------------------------
  // 상태 초기화 (Blob URL 회수 포함)
  // -------------------------------------------------------
  function resetState() {
    if (_autoFillState.workersPhoto && _autoFillState.workersPhoto.blobUrl) {
      URL.revokeObjectURL(_autoFillState.workersPhoto.blobUrl);
    }
    if (_autoFillState.documentsPhoto && _autoFillState.documentsPhoto.blobUrl) {
      URL.revokeObjectURL(_autoFillState.documentsPhoto.blobUrl);
    }
    Object.keys(_autoFillState.vehiclesByWorker).forEach(function (name) {
      var v = _autoFillState.vehiclesByWorker[name];
      if (v && v.blobUrl) URL.revokeObjectURL(v.blobUrl);
    });

    _autoFillState.active = false;
    _autoFillState.step = 0;
    _autoFillState.workers = [];
    _autoFillState.workersPhoto = null;
    _autoFillState.documentsPhoto = null;
    _autoFillState.vehiclesByWorker = {};
    _autoFillState.vehicleLoop = { index: 0, onDone: null };

    hidePrompt();
    hidePreviewGrid();

    // btn-save-band 비활성화
    var saveBandBtn = getEl('btn-save-band');
    if (saveBandBtn) saveBandBtn.disabled = true;
  }

  // -------------------------------------------------------
  // DOM 헬퍼
  // -------------------------------------------------------
  function getEl(id) { return document.getElementById(id); }

  function showPrompt(text, onPick, onSkip) {
    getEl('autofill-prompt-text').textContent = text;
    getEl('autofill-prompt').style.display = 'block';
    getEl('btn-autofill-pick')._handler = onPick;
    getEl('btn-autofill-skip')._handler = onSkip;
  }

  function hidePrompt() {
    getEl('autofill-prompt').style.display = 'none';
  }

  function hidePreviewGrid() {
    getEl('preview-grid').style.display = 'none';
  }

  // -------------------------------------------------------
  // 파일 입력 트리거 (promise 반환)
  //   onPick 클릭 → 지정된 input 열기
  //   파일 선택 완료(change) → resolve(file)
  //   건너뛰기 클릭 → resolve(null)
  // -------------------------------------------------------
  function promptFileInput(promptText, inputId) {
    return new Promise(function (resolve) {
      var input = getEl(inputId);

      // 이전 핸들러 해제 (중복 방지)
      var prevHandler = input._autoHandler;
      if (prevHandler) input.removeEventListener('change', prevHandler);

      function onChange(e) {
        input.removeEventListener('change', onChange);
        input._autoHandler = null;
        var file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
        input.value = '';
        hidePrompt();
        resolve(file);
      }

      input.addEventListener('change', onChange);
      input._autoHandler = onChange;

      showPrompt(
        promptText,
        function onPick() {
          input.click();
        },
        function onSkip() {
          input.removeEventListener('change', onChange);
          input._autoHandler = null;
          input.value = '';
          hidePrompt();
          resolve(null);
        }
      );
    });
  }

  // -------------------------------------------------------
  // 단계 1: 공통필드 자동 채우기
  // -------------------------------------------------------
  function step1CommonFields(projectName, workers) {
    return new Promise(function (resolve) {
      var matched = Storage.findMatchingSession(
        projectName,
        workers.slice().sort()
      );

      if (matched) {
        // 매치: 프리필 + 배너 표시
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

      // 매치 없음: GPS 시도
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
  // 단계 2: 작업원 사진 선택
  // -------------------------------------------------------
  function step2WorkersPhoto() {
    return promptFileInput('작업원 사진 고르세요', 'auto-file-workers')
      .then(function (file) {
        _autoFillState.workersPhoto = file ? { file: file, composedBlob: null, blobUrl: null } : null;
      });
  }

  // -------------------------------------------------------
  // 단계 3: 서류 사진 선택
  // -------------------------------------------------------
  function step3DocumentsPhoto() {
    return promptFileInput('서류 사진 고르세요', 'auto-file-documents')
      .then(function (file) {
        _autoFillState.documentsPhoto = file ? { file: file, composedBlob: null, blobUrl: null } : null;
      });
  }

  // -------------------------------------------------------
  // 단계 4: 차대비 사진 (작업원별 루프)
  // -------------------------------------------------------
  function step4VehiclesLoop(workers) {
    return new Promise(function (resolve) {
      var results = {};

      function processNext(idx) {
        if (idx >= workers.length) {
          _autoFillState.vehiclesByWorker = results;
          resolve();
          return;
        }

        var name = workers[idx];
        promptFileInput(name + ' 차대비 사진 고르세요', 'auto-file-vehicle')
          .then(function (file) {
            results[name] = file ? { file: file, composedBlob: null, blobUrl: null } : null;
            processNext(idx + 1);
          });
      }

      processNext(0);
    });
  }

  // -------------------------------------------------------
  // 단계 5: 합성 미리보기
  // -------------------------------------------------------
  function step5Compose(projectName, workers) {
    var allWorkerStr = workers.join(' ');
    var boardData = window.AppMain.collectBoardData(allWorkerStr);

    var tasks = [];

    if (_autoFillState.workersPhoto) {
      tasks.push({
        key: '__workers__',
        label: '작업원 사진',
        file: _autoFillState.workersPhoto.file,
        boardData: boardData
      });
    }

    if (_autoFillState.documentsPhoto) {
      tasks.push({
        key: '__documents__',
        label: '서류 사진',
        file: _autoFillState.documentsPhoto.file,
        boardData: boardData
      });
    }

    workers.forEach(function (name) {
      var v = _autoFillState.vehiclesByWorker[name];
      if (v && v.file) {
        var vBoardData = window.AppMain.collectBoardData(name);
        tasks.push({
          key: name,
          label: name + ' 차대비',
          file: v.file,
          boardData: vBoardData
        });
      }
    });

    if (tasks.length === 0) {
      renderEmptyPreviewGrid();
      return Promise.resolve();
    }

    var promises = tasks.map(function (t) {
      return Compose.compose(t.file, t.boardData).then(function (blob) {
        return { key: t.key, label: t.label, blob: blob };
      });
    });

    return Promise.all(promises).then(function (results) {
      // composedBlob / blobUrl 저장
      results.forEach(function (r) {
        var url = URL.createObjectURL(r.blob);
        if (r.key === '__workers__' && _autoFillState.workersPhoto) {
          _autoFillState.workersPhoto.composedBlob = r.blob;
          _autoFillState.workersPhoto.blobUrl = url;
        } else if (r.key === '__documents__' && _autoFillState.documentsPhoto) {
          _autoFillState.documentsPhoto.composedBlob = r.blob;
          _autoFillState.documentsPhoto.blobUrl = url;
        } else if (_autoFillState.vehiclesByWorker[r.key]) {
          _autoFillState.vehiclesByWorker[r.key].composedBlob = r.blob;
          _autoFillState.vehiclesByWorker[r.key].blobUrl = url;
        }
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

      var rePickBtn = document.createElement('button');
      rePickBtn.className = 'btn-secondary btn-sm';
      rePickBtn.textContent = '다시 선택';
      rePickBtn.type = 'button';

      // 다시 선택: 해당 항목만 재실행
      (function (key, label) {
        rePickBtn.addEventListener('click', function () {
          rePickSingle(key, label);
        });
      })(r.key, r.label);

      header.appendChild(label);
      header.appendChild(rePickBtn);

      var img = document.createElement('img');
      img.className = 'preview-grid-item__img';
      img.alt = r.label + ' 합성 결과';

      // blobUrl 찾기
      var url = null;
      if (r.key === '__workers__' && _autoFillState.workersPhoto) {
        url = _autoFillState.workersPhoto.blobUrl;
      } else if (r.key === '__documents__' && _autoFillState.documentsPhoto) {
        url = _autoFillState.documentsPhoto.blobUrl;
      } else if (_autoFillState.vehiclesByWorker[r.key]) {
        url = _autoFillState.vehiclesByWorker[r.key].blobUrl;
      }

      if (url) img.src = url;

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
  // 개별 재선택
  // -------------------------------------------------------
  function rePickSingle(key, label) {
    var inputId;
    var workerName = null;

    if (key === '__workers__') {
      inputId = 'auto-file-workers';
    } else if (key === '__documents__') {
      inputId = 'auto-file-documents';
    } else {
      inputId = 'auto-file-vehicle';
      workerName = key;
    }

    promptFileInput(label + ' 사진 다시 고르세요', inputId).then(function (file) {
      if (!file) return; // 건너뛰기 시 기존 유지

      var workers = _autoFillState.workers;
      var allWorkerStr = workers.join(' ');

      var boardData;
      if (key === '__workers__' || key === '__documents__') {
        boardData = window.AppMain.collectBoardData(allWorkerStr);
      } else {
        boardData = window.AppMain.collectBoardData(workerName);
      }

      Compose.compose(file, boardData).then(function (blob) {
        var newUrl = URL.createObjectURL(blob);

        // 기존 URL 해제
        if (key === '__workers__' && _autoFillState.workersPhoto) {
          if (_autoFillState.workersPhoto.blobUrl) URL.revokeObjectURL(_autoFillState.workersPhoto.blobUrl);
          _autoFillState.workersPhoto = { file: file, composedBlob: blob, blobUrl: newUrl };
        } else if (key === '__documents__' && _autoFillState.documentsPhoto) {
          if (_autoFillState.documentsPhoto.blobUrl) URL.revokeObjectURL(_autoFillState.documentsPhoto.blobUrl);
          _autoFillState.documentsPhoto = { file: file, composedBlob: blob, blobUrl: newUrl };
        } else if (_autoFillState.vehiclesByWorker[key]) {
          if (_autoFillState.vehiclesByWorker[key].blobUrl) URL.revokeObjectURL(_autoFillState.vehiclesByWorker[key].blobUrl);
          _autoFillState.vehiclesByWorker[key] = { file: file, composedBlob: blob, blobUrl: newUrl };
        }

        // 해당 그리드 아이템의 img 갱신
        updateGridItemImage(key, newUrl);
      }).catch(function (err) {
        alert('합성 오류: ' + err.message);
      });
    });
  }

  function updateGridItemImage(key, url) {
    var items = getEl('preview-grid-items').querySelectorAll('.preview-grid-item');
    var labels = {
      '__workers__': '작업원 사진',
      '__documents__': '서류 사진'
    };
    var targetLabel = labels[key] || (key + ' 차대비');

    for (var i = 0; i < items.length; i++) {
      var labelEl = items[i].querySelector('.preview-grid-item__label');
      if (labelEl && labelEl.textContent === targetLabel) {
        var img = items[i].querySelector('.preview-grid-item__img');
        if (img) img.src = url;
        break;
      }
    }
  }

  // -------------------------------------------------------
  // 메인 플로우
  // -------------------------------------------------------
  function runAutofill() {
    // 재클릭 시 기존 상태 확인
    if (_autoFillState.active) {
      if (!confirm('진행 중인 자동 입히기를 초기화하시겠습니까?')) return;
      resetState();
    }

    // 선행 조건: 공사명 + 작업원 최소 1개 선택
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

    _autoFillState.active = true;
    _autoFillState.workers = workers.slice();

    var btn = getEl('btn-autofill');
    btn.disabled = true;
    btn.textContent = '진행 중...';

    // 단계 순차 실행
    step1CommonFields(projectName, workers)
      .then(function () {
        _autoFillState.step = 2;
        return step2WorkersPhoto();
      })
      .then(function () {
        _autoFillState.step = 3;
        return step3DocumentsPhoto();
      })
      .then(function () {
        _autoFillState.step = 4;
        return step4VehiclesLoop(workers);
      })
      .then(function () {
        _autoFillState.step = 5;
        return step5Compose(projectName, workers);
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = '자동 입히기';
        _autoFillState.active = false;
      })
      .catch(function (err) {
        console.error('autofill error:', err);
        btn.disabled = false;
        btn.textContent = '자동 입히기';
        _autoFillState.active = false;
        alert('자동 입히기 중 오류가 발생했습니다: ' + err.message);
      });
  }

  // -------------------------------------------------------
  // Phase D: btn-save-band 활성/비활성 업데이트
  // -------------------------------------------------------
  function updateSaveBandBtn() {
    var btn = getEl('btn-save-band');
    if (!btn) return;
    var hasComposed = hasSomethingComposed();
    btn.disabled = !hasComposed;
  }

  function hasSomethingComposed() {
    if (_autoFillState.workersPhoto && _autoFillState.workersPhoto.composedBlob) return true;
    if (_autoFillState.documentsPhoto && _autoFillState.documentsPhoto.composedBlob) return true;
    var names = Object.keys(_autoFillState.vehiclesByWorker);
    for (var i = 0; i < names.length; i++) {
      var v = _autoFillState.vehiclesByWorker[names[i]];
      if (v && v.composedBlob) return true;
    }
    return false;
  }

  // -------------------------------------------------------
  // Phase D: 파일명 생성 헬퍼
  //   작업자 사진: board_YYYYMMDD_작업자_N.jpg
  //   서류 사진:   board_YYYYMMDD_서류_N.jpg
  //   차대비 사진: board_YYYYMMDD_차대비_{이름}.jpg
  // -------------------------------------------------------
  function buildFilename(dateStr, type, suffix) {
    var datePart = (dateStr || '').replace(/\./g, '').replace(/\s+/g, '');
    if (!/^\d{8}$/.test(datePart)) {
      // 폴백: 오늘 날짜 (YYYYMMDD)
      datePart = new Date().toISOString().split('T')[0].replace(/-/g, '');
    }
    return 'board_' + datePart + '_' + type + '_' + suffix + '.jpg';
  }

  // -------------------------------------------------------
  // Phase D: 딥링크 트리거 (테스트용 훅 포함)
  // -------------------------------------------------------
  function triggerDeepLink(url) {
    window.location.href = url;
  }

  function triggerFallback(url) {
    window.open(url, '_blank');
  }

  // -------------------------------------------------------
  // Phase D: 로컬 다운로드 (순차 지연)
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
  // Phase D: 밴드 앱 딥링크 + 폴백
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
      // 데스크톱: 바로 폴백
      triggerFallback('https://band.us/');
      return;
    }

    // visibilitychange로 앱 전환 감지 → 폴백 타이머 취소
    var fallbackTimer = null;
    var visHandler = null;

    function cancelFallback() {
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      if (visHandler) {
        document.removeEventListener('visibilitychange', visHandler);
        visHandler = null;
      }
    }

    visHandler = function () {
      if (document.hidden) {
        cancelFallback();
      }
    };
    document.addEventListener('visibilitychange', visHandler);

    // 800ms 후 앱 미설치 폴백
    fallbackTimer = setTimeout(function () {
      cancelFallback();
      triggerFallback('https://band.us/');
    }, 800);

    // 딥링크 실행
    triggerDeepLink(deeplink);
  }

  // -------------------------------------------------------
  // Phase D: 세션 기록
  // -------------------------------------------------------
  function recordSession() {
    var projectName = (getEl('project-name') || {}).value || '';
    var workers = _autoFillState.workers.slice().sort();
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
  // Phase D: 저장 + 밴드 열기 메인 로직
  // -------------------------------------------------------
  function runSaveAndBand() {
    if (_saveInProgress) return;
    if (!hasSomethingComposed()) return;
    _saveInProgress = true;

    var dateStr = (getEl('field-date') || {}).value || '';
    var items = [];
    var workerCount = 0;
    var docCount = 0;

    if (_autoFillState.workersPhoto && _autoFillState.workersPhoto.composedBlob) {
      workerCount++;
      items.push({
        blob: _autoFillState.workersPhoto.composedBlob,
        filename: buildFilename(dateStr, '작업자', workerCount)
      });
    }

    if (_autoFillState.documentsPhoto && _autoFillState.documentsPhoto.composedBlob) {
      docCount++;
      items.push({
        blob: _autoFillState.documentsPhoto.composedBlob,
        filename: buildFilename(dateStr, '서류', docCount)
      });
    }

    var orderedWorkers = (_autoFillState.workers || []).slice().sort();
    orderedWorkers.forEach(function (name) {
      var v = _autoFillState.vehiclesByWorker[name];
      if (v && v.composedBlob) {
        items.push({
          blob: v.composedBlob,
          filename: buildFilename(dateStr, '차대비', name)
        });
      }
    });

    if (items.length === 0) { _saveInProgress = false; return; }

    // 버튼 일시 비활성
    var btn = getEl('btn-save-band');
    if (btn) btn.disabled = true;

    downloadBlobs(items)
      .then(function () {
        // 세션 기록 (D-5)
        recordSession();
        // 밴드 딥링크
        openBandApp();
      })
      .catch(function (err) {
        console.error('save+band error:', err);
        alert('저장 중 오류가 발생했습니다: ' + err.message);
      })
      .then(function () {
        // then(성공/실패 모두) — finally 미지원 환경 대비
        if (btn) btn.disabled = false;
        _saveInProgress = false;
      });
  }

  // -------------------------------------------------------
  // 이벤트 바인딩
  // -------------------------------------------------------
  function bindEvents() {
    var autofillBtn = getEl('btn-autofill');
    if (autofillBtn) {
      autofillBtn.addEventListener('click', runAutofill);
    }

    var pickBtn = getEl('btn-autofill-pick');
    if (pickBtn) {
      pickBtn.addEventListener('click', function () {
        if (typeof pickBtn._handler === 'function') pickBtn._handler();
      });
    }

    var skipBtn = getEl('btn-autofill-skip');
    if (skipBtn) {
      skipBtn.addEventListener('click', function () {
        if (typeof skipBtn._handler === 'function') skipBtn._handler();
      });
    }

    // "저장 + 밴드 열기" — Phase D 실제 동작
    var saveBandBtn = getEl('btn-save-band');
    if (saveBandBtn) {
      saveBandBtn.addEventListener('click', runSaveAndBand);
    }
  }

  // -------------------------------------------------------
  // 초기화 (DOMContentLoaded 이후 app.js의 setup 완료 시점에 맞춤)
  // -------------------------------------------------------
  function init() {
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 외부 노출 (스모크 테스트용)
  window.AutoFill = {
    _state: _autoFillState,
    runAutofill: runAutofill,
    resetState: resetState,
    // Phase D 테스트 훅 — smoke에서 스텁 가능
    _triggerDeepLink: function (url) { triggerDeepLink(url); },
    _triggerFallback: function (url) { triggerFallback(url); },
    _hasSomethingComposed: hasSomethingComposed,
    _buildFilename: buildFilename,
    _downloadBlobs: downloadBlobs
  };

})();
