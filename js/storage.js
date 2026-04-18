/*
 * storage.js — localStorage 래퍼
 *
 * 스키마 (key: "ami-board-state"):
 * {
 *   commonFields: {
 *     projectName: string,
 *     lastOffice: string,
 *     workplace: string
 *   },
 *   workerHistory: string[],
 *   savedCrews: Array<{
 *     id: string,
 *     name: string,
 *     members: string[],
 *     createdAt: string
 *   }>,
 *   recentSessions: {
 *     morning?: Session,
 *     afternoon?: Session,
 *     yesterday?: Session
 *   }
 * }
 *
 * Session: {
 *   timestamp: string,        // ISO
 *   date: string,             // "YYYY-MM-DD"
 *   commonFields: { office, workplace },
 *   sections: {
 *     workers: { tags: string[] },
 *     documents: { tags: string[] },
 *     vehicles: Array<{ tag: string }>
 *   }
 * }
 */

var Storage = (function () {
  var KEY = 'ami-board-state';
  var MAX_CREWS = 20;

  var DEFAULTS = {
    commonFields: {
      projectName: '',
      lastOffice: '',
      workplace: ''
    },
    workerHistory: [],
    savedCrews: [],
    recentSessions: {}
  };

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
      var parsed = JSON.parse(raw);
      return merge(DEFAULTS, parsed);
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  function save(state) {
    var attempts = [
      function () { localStorage.setItem(KEY, JSON.stringify(state)); },
      function () {
        state.recentSessions = {};
        localStorage.setItem(KEY, JSON.stringify(state));
      },
      function () {
        if (state.savedCrews && state.savedCrews.length > 10) {
          state.savedCrews = state.savedCrews.slice(-10);
        }
        localStorage.setItem(KEY, JSON.stringify(state));
      },
      function () {
        if (state.savedCrews && state.savedCrews.length > 5) {
          state.savedCrews = state.savedCrews.slice(-5);
        }
        localStorage.setItem(KEY, JSON.stringify(state));
      }
    ];

    for (var i = 0; i < attempts.length; i++) {
      try {
        attempts[i]();
        return;
      } catch (e) {
        if (i === attempts.length - 1) {
          var minimal = {
            commonFields: state.commonFields,
            workerHistory: state.workerHistory.slice(0, 20),
            savedCrews: [],
            recentSessions: {}
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

  function merge(defaults, obj) {
    var result = JSON.parse(JSON.stringify(defaults));
    if (!obj || typeof obj !== 'object') return result;
    Object.keys(obj).forEach(function (k) {
      if (k in result && obj[k] !== null && typeof obj[k] === typeof result[k]) {
        if (typeof obj[k] === 'object' && !Array.isArray(obj[k])) {
          result[k] = merge(result[k], obj[k]);
        } else {
          result[k] = obj[k];
        }
      } else {
        result[k] = obj[k];
      }
    });
    return result;
  }

  function todayStr() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function dateOf(session) {
    return session && session.date ? session.date : '';
  }

  // --- commonFields ---

  function getCommonFields() {
    return load().commonFields;
  }

  function saveCommonFields(fields) {
    var state = load();
    state.commonFields = Object.assign(state.commonFields, fields);
    save(state);
  }

  function saveLastOffice(office) {
    var state = load();
    state.commonFields.lastOffice = office;
    save(state);
  }

  function saveWorkplace(workplace) {
    var state = load();
    state.commonFields.workplace = workplace;
    save(state);
  }

  // --- workerHistory ---

  function getWorkerHistory() {
    return load().workerHistory || [];
  }

  function addWorkers(names) {
    var state = load();
    var history = state.workerHistory || [];
    names.forEach(function (name) {
      name = name.trim();
      if (name && history.indexOf(name) === -1) {
        history.push(name);
      }
    });
    state.workerHistory = history;
    save(state);
  }

  function addWorkerIfNew(name) {
    name = (name || '').trim();
    if (!name) return;
    var state = load();
    var history = state.workerHistory || [];
    if (history.indexOf(name) === -1) {
      history.push(name);
      state.workerHistory = history;
      save(state);
    }
  }

  // --- savedCrews ---

  function getSavedCrews() {
    return load().savedCrews || [];
  }

  function saveCrew(name, members) {
    name = (name || '').trim();
    if (!name || !members || members.length === 0) return null;
    var state = load();
    var crews = state.savedCrews || [];
    var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var crew = {
      id: id,
      name: name,
      members: members.slice(),
      createdAt: new Date().toISOString()
    };
    crews.push(crew);
    if (crews.length > MAX_CREWS) {
      crews = crews.slice(crews.length - MAX_CREWS);
    }
    state.savedCrews = crews;
    save(state);
    return crew;
  }

  function deleteCrew(id) {
    var state = load();
    state.savedCrews = (state.savedCrews || []).filter(function (c) {
      return c.id !== id;
    });
    save(state);
  }

  // --- recentSessions ---

  function getRecentSessions() {
    return load().recentSessions || {};
  }

  function recordSession(sessionData) {
    var state = load();
    var today = todayStr();
    var sessions = state.recentSessions || {};

    // 날짜 롤오버: 이전 날짜 세션 → yesterday로 이동
    var prevDaySession = null;
    if (sessions.afternoon && dateOf(sessions.afternoon) !== today) {
      prevDaySession = sessions.afternoon;
    } else if (sessions.morning && dateOf(sessions.morning) !== today) {
      prevDaySession = sessions.morning;
    }

    if (prevDaySession) {
      sessions = { yesterday: prevDaySession };
    }

    var hour = new Date().getHours();
    var slot = hour < 12 ? 'morning' : 'afternoon';

    var session = {
      timestamp: new Date().toISOString(),
      date: today,
      commonFields: {
        office: sessionData.commonFields.office || '',
        workplace: sessionData.commonFields.workplace || ''
      },
      sections: {
        workers: { tags: (sessionData.sections.workers.tags || []).slice() },
        documents: { tags: (sessionData.sections.documents.tags || []).slice() },
        vehicles: (sessionData.sections.vehicles || []).map(function (v) {
          return { tag: v.tag || '' };
        })
      }
    };

    sessions[slot] = session;
    state.recentSessions = sessions;
    save(state);
  }

  // 초기화 시 stale morning/afternoon 감지용 (rollover는 recordSession에서)
  function isTodaySession(session) {
    return session && dateOf(session) === todayStr();
  }

  return {
    load: load,
    save: save,
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
