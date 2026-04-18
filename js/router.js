/*
 * router.js — hash 기반 라우터
 * 지원 경로: #/ (메인), #/settings (설정/온보딩)
 */

var Router = (function () {
  var pages = {};

  function register(hash, handler) {
    pages[hash] = handler;
  }

  function currentHash() {
    var h = location.hash || '';
    if (!h || h === '#' || h === '#/') return '#/';
    return h;
  }

  function navigate(hash) {
    location.hash = hash;
  }

  function resolve() {
    var hash = currentHash();
    var handler = pages[hash];
    if (handler) {
      handler();
    } else {
      // 알 수 없는 경로 → 메인
      navigate('#/');
    }
  }

  function init() {
    window.addEventListener('hashchange', resolve);

    // 첫 진입: 작업원이 없으면 설정 페이지로
    var state = Storage.getState();
    if (!state.workers || state.workers.length === 0) {
      if (location.hash === '#/settings') {
        // 이미 해당 hash — hashchange 발생 안 하므로 직접 resolve
        resolve();
      } else {
        navigate('#/settings');
      }
    } else {
      resolve();
    }
  }

  return {
    register: register,
    navigate: navigate,
    init: init,
    resolve: resolve
  };
})();
