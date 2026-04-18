/*
 * storage.js — localStorage 래퍼 (스키마 v2)
 *
 * StateV2:
 * {
 *   version: 2,
 *   projectNames: string[],
 *   workers: string[],
 *   lastSelected: {
 *     projectName?: string,
 *     workers?: string[],
 *     office?: string,
 *     workplace?: string,
 *     workplaceCoord?: { lat: number, lng: number }
 *   },
 *   sessionHistory: Array<{
 *     projectName: string,
 *     workers: string[],
 *     office: string,
 *     workplace: string,
 *     workplaceCoord?: { lat: number, lng: number },
 *     timestamp: string
 *   }>
 * }
 */

var Storage = (function () {
  var KEY = 'ami-board-state';
  var SESSION_MAX = 30;

  var DEFAULT_V2 = {
    version: 2,
    projectNames: [],
    workers: [],
    lastSelected: {},
    sessionHistory: []
  };

  // -------------------------------------------------------
  // 마이그레이션 v1 → v2
  // -------------------------------------------------------
  function migrateV1(raw) {
    var v2 = {
      version: 2,
      projectNames: [],
      workers: [],
      lastSelected: {},
      sessionHistory: []
    };

    var cf = raw.commonFields || {};

    var pName = (cf.projectName || '').trim();
    if (pName) {
      v2.projectNames = [pName];
      v2.lastSelected.projectName = pName;
    }

    if (cf.lastOffice) v2.lastSelected.office = cf.lastOffice;
    if (cf.workplace) v2.lastSelected.workplace = cf.workplace;

    var history = raw.workerHistory || [];
    var seen = {};
    history.forEach(function (name) {
      name = (name || '').trim();
      if (name && !seen[name]) {
        seen[name] = true;
        v2.workers.push(name);
      }
    });

    return v2;
  }

  // -------------------------------------------------------
  // load / save
  // -------------------------------------------------------
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT_V2));

      var parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== 'object') {
        return JSON.parse(JSON.stringify(DEFAULT_V2));
      }

      if (parsed.version !== 2) {
        var migrated = migrateV1(parsed);
        _save(migrated);
        return migrated;
      }

      var state = JSON.parse(JSON.stringify(DEFAULT_V2));
      if (Array.isArray(parsed.projectNames)) state.projectNames = parsed.projectNames;
      if (Array.isArray(parsed.workers)) state.workers = parsed.workers;
      if (parsed.lastSelected && typeof parsed.lastSelected === 'object') {
        state.lastSelected = parsed.lastSelected;
      }
      if (Array.isArray(parsed.sessionHistory)) state.sessionHistory = parsed.sessionHistory;
      return state;
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULT_V2));
    }
  }

  function _save(state) {
    var attempts = [
      function () { localStorage.setItem(KEY, JSON.stringify(state)); },
      function () {
        var s = JSON.parse(JSON.stringify(state));
        s.sessionHistory = s.sessionHistory.slice(-10);
        localStorage.setItem(KEY, JSON.stringify(s));
      },
      function () {
        var s = JSON.parse(JSON.stringify(state));
        s.sessionHistory = [];
        localStorage.setItem(KEY, JSON.stringify(s));
      }
    ];

    for (var i = 0; i < attempts.length; i++) {
      try {
        attempts[i]();
        return;
      } catch (e) {
        if (i === attempts.length - 1) {
          var minimal = {
            version: 2,
            projectNames: state.projectNames.slice(0, 5),
            workers: state.workers.slice(0, 20),
            lastSelected: state.lastSelected,
            sessionHistory: []
          };
          try {
            localStorage.setItem(KEY, JSON.stringify(minimal));
            alert('저장 공간 부족 — 일부 데이터만 저장됩니다.');
          } catch (e2) {
            alert('저장 실패. 새로고침 후 다시 시도하세요.');
          }
        }
      }
    }
  }

  // -------------------------------------------------------
  // v2 API
  // -------------------------------------------------------
  function getState() {
    return load();
  }

  function saveState(s) {
    _save(s);
  }

  function addProjectName(name) {
    name = (name || '').trim();
    if (!name) return;
    var state = load();
    if (state.projectNames.indexOf(name) === -1) {
      state.projectNames.push(name);
      _save(state);
    }
  }

  function removeProjectName(name) {
    var state = load();
    state.projectNames = state.projectNames.filter(function (n) { return n !== name; });
    _save(state);
  }

  function addWorker(name) {
    name = (name || '').trim();
    if (!name) return;
    var state = load();
    if (state.workers.indexOf(name) === -1) {
      state.workers.push(name);
      _save(state);
    }
  }

  function removeWorker(name) {
    var state = load();
    state.workers = state.workers.filter(function (n) { return n !== name; });
    _save(state);
  }

  function moveWorker(name, direction) {
    var state = load();
    var idx = state.workers.indexOf(name);
    if (idx === -1) return;
    var newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= state.workers.length) return;
    var arr = state.workers.slice();
    var tmp = arr[idx];
    arr[idx] = arr[newIdx];
    arr[newIdx] = tmp;
    state.workers = arr;
    _save(state);
  }

  function setLastSelected(partial) {
    var state = load();
    Object.keys(partial).forEach(function (k) {
      state.lastSelected[k] = partial[k];
    });
    _save(state);
  }

  function appendSession(entry) {
    var state = load();
    state.sessionHistory.push(entry);
    if (state.sessionHistory.length > SESSION_MAX) {
      state.sessionHistory = state.sessionHistory.slice(-SESSION_MAX);
    }
    _save(state);
  }

  function findMatchingSession(projectName, workers) {
    var state = load();
    var sortedWorkers = workers.slice().sort();
    for (var i = state.sessionHistory.length - 1; i >= 0; i--) {
      var entry = state.sessionHistory[i];
      if (entry.projectName !== projectName) continue;
      var entryWorkers = (entry.workers || []).slice().sort();
      if (entryWorkers.length !== sortedWorkers.length) continue;
      var match = true;
      for (var j = 0; j < sortedWorkers.length; j++) {
        if (entryWorkers[j] !== sortedWorkers[j]) { match = false; break; }
      }
      if (match) return entry;
    }
    return null;
  }

  // -------------------------------------------------------
  // v1 호환 alias (app.js가 Phase B 전까지 그대로 동작하도록)
  // -------------------------------------------------------

  function getCommonFields() {
    var state = load();
    var ls = state.lastSelected || {};
    return {
      projectName: ls.projectName || '',
      lastOffice: ls.office || '',
      workplace: ls.workplace || ''
    };
  }

  function saveCommonFields(fields) {
    var partial = {};
    if (fields.projectName !== undefined) partial.projectName = fields.projectName;
    if (fields.lastOffice !== undefined) partial.office = fields.lastOffice;
    if (fields.workplace !== undefined) partial.workplace = fields.workplace;
    if (Object.keys(partial).length) setLastSelected(partial);
  }

  function saveLastOffice(office) {
    setLastSelected({ office: office });
  }

  function saveWorkplace(workplace) {
    setLastSelected({ workplace: workplace });
  }

  function getWorkerHistory() {
    return load().workers || [];
  }

  function addWorkers(names) {
    names.forEach(function (name) {
      addWorker(name);
    });
  }

  function addWorkerIfNew(name) {
    addWorker(name);
  }

  function getSavedCrews() {
    return [];
  }

  function saveCrew() {
    return null;
  }

  function deleteCrew() {}

  function getRecentSessions() {
    return {};
  }

  function recordSession() {}

  function isTodaySession(session) {
    return session && dateOf(session) === todayStr();
  }

  function dateOf(session) {
    return session && session.date ? session.date : '';
  }

  function todayStr() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  return {
    // v2 API
    getState: getState,
    saveState: saveState,
    addProjectName: addProjectName,
    removeProjectName: removeProjectName,
    addWorker: addWorker,
    removeWorker: removeWorker,
    moveWorker: moveWorker,
    setLastSelected: setLastSelected,
    appendSession: appendSession,
    findMatchingSession: findMatchingSession,

    // v1 alias (Phase B 전까지 유지)
    load: load,
    save: _save,
    getCommonFields: getCommonFields,
    saveCommonFields: saveCommonFields,
    saveLastOffice: saveLastOffice,
    saveWorkplace: saveWorkplace,
    getWorkerHistory: getWorkerHistory,
    addWorkers: addWorkers,
    addWorkerIfNew: addWorkerIfNew,
    getSavedCrews: getSavedCrews,
    saveCrew: saveCrew,
    deleteCrew: deleteCrew,
    getRecentSessions: getRecentSessions,
    recordSession: recordSession,
    isTodaySession: isTodaySession,
    todayStr: todayStr
  };
})();
