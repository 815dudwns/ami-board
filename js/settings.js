/*
 * settings.js — 설정/온보딩 페이지 로직
 */

var Settings = (function () {
  function isOnboarding() {
    var state = Storage.getState();
    return !state.workers || state.workers.length === 0;
  }

  function render() {
    var onboarding = isOnboarding();

    document.getElementById('settings-heading').textContent = onboarding
      ? '초기 설정 / 공사명과 작업원을 등록해주세요'
      : '설정';

    var doneBtn = document.getElementById('btn-onboarding-done');
    var mainBtn = document.getElementById('btn-go-main');

    if (onboarding) {
      doneBtn.style.display = 'inline-block';
      mainBtn.style.display = 'none';
    } else {
      doneBtn.style.display = 'none';
      mainBtn.style.display = 'inline-block';
    }

    renderProjectList();
    renderWorkerList();
    updateDoneBtn();
  }

  function renderProjectList() {
    var state = Storage.getState();
    var ul = document.getElementById('project-list');
    ul.innerHTML = '';
    state.projectNames.forEach(function (name) {
      var li = document.createElement('li');
      li.className = 'settings-list-item';

      var nameSpan = document.createElement('span');
      nameSpan.className = 'settings-item-name';
      nameSpan.textContent = name;

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-icon btn-danger-text';
      delBtn.textContent = 'x';
      delBtn.setAttribute('aria-label', name + ' 삭제');
      delBtn.addEventListener('click', function () {
        Storage.removeProjectName(name);
        renderProjectList();
        updateDoneBtn();
      });

      li.appendChild(nameSpan);
      li.appendChild(delBtn);
      ul.appendChild(li);
    });
  }

  function renderWorkerList() {
    var state = Storage.getState();
    var ul = document.getElementById('worker-list');
    ul.innerHTML = '';
    state.workers.forEach(function (name, idx) {
      var li = document.createElement('li');
      li.className = 'settings-list-item';

      var numSpan = document.createElement('span');
      numSpan.className = 'settings-item-num';
      numSpan.textContent = (idx + 1) + '.';

      var nameSpan = document.createElement('span');
      nameSpan.className = 'settings-item-name';
      nameSpan.textContent = name;

      var upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'btn-icon';
      upBtn.textContent = '\u25b2';
      upBtn.setAttribute('aria-label', name + ' 위로');
      upBtn.disabled = idx === 0;
      upBtn.addEventListener('click', function () {
        Storage.moveWorker(name, 'up');
        renderWorkerList();
      });

      var downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'btn-icon';
      downBtn.textContent = '\u25bc';
      downBtn.setAttribute('aria-label', name + ' 아래로');
      downBtn.disabled = idx === state.workers.length - 1;
      downBtn.addEventListener('click', function () {
        Storage.moveWorker(name, 'down');
        renderWorkerList();
      });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-icon btn-danger-text';
      delBtn.textContent = 'x';
      delBtn.setAttribute('aria-label', name + ' 삭제');
      delBtn.addEventListener('click', function () {
        Storage.removeWorker(name);
        renderWorkerList();
        updateDoneBtn();
      });

      li.appendChild(numSpan);
      li.appendChild(nameSpan);
      li.appendChild(upBtn);
      li.appendChild(downBtn);
      li.appendChild(delBtn);
      ul.appendChild(li);
    });
  }

  function updateDoneBtn() {
    var state = Storage.getState();
    var hasProject = state.projectNames.length >= 1;
    var hasWorker = state.workers.length >= 1;
    var doneBtn = document.getElementById('btn-onboarding-done');
    doneBtn.disabled = !(hasProject && hasWorker);
    if (!hasProject && !hasWorker) {
      doneBtn.textContent = '공사명·작업원 추가하세요';
    } else if (!hasProject) {
      doneBtn.textContent = '공사명 추가하세요';
    } else if (!hasWorker) {
      doneBtn.textContent = '작업원 추가하세요';
    } else {
      doneBtn.textContent = '완료';
    }
  }

  function bindEvents() {
    // 공사명 추가
    var projectInput = document.getElementById('project-input');
    var btnAddProject = document.getElementById('btn-add-project');

    function addProject() {
      var name = projectInput.value.trim();
      if (!name) return;
      Storage.addProjectName(name);
      projectInput.value = '';
      renderProjectList();
      updateDoneBtn();
    }

    btnAddProject.addEventListener('click', addProject);
    projectInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing) addProject();
    });

    // 작업원 추가
    var workerInput = document.getElementById('worker-input');
    var btnAddWorker = document.getElementById('btn-add-worker');

    function addWorker() {
      var name = workerInput.value.trim();
      if (!name) return;
      Storage.addWorker(name);
      workerInput.value = '';
      renderWorkerList();
      updateDoneBtn();
    }

    btnAddWorker.addEventListener('click', addWorker);
    workerInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing) addWorker();
    });

    // 온보딩 완료 버튼
    document.getElementById('btn-onboarding-done').addEventListener('click', function () {
      Router.navigate('#/');
    });

    // 메인으로 버튼
    document.getElementById('btn-go-main').addEventListener('click', function () {
      Router.navigate('#/');
    });
  }

  function init() {
    bindEvents();
  }

  return {
    init: init,
    render: render
  };
})();
