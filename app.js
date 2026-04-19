(function () {
  const storageKey = 'lsd-quiz-state-v1';
  const appData = window.APP_DATA;
  const questionsById = new Map(appData.questions.map((question) => [question.id, question]));
  const setsById = new Map(appData.examSets.map((examSet) => [examSet.id, examSet]));
  const visibleLetters = ['A', 'B', 'C', 'D'];

  const elements = {
    metaQuestionCount: document.getElementById('metaQuestionCount'),
    metaSetCount: document.getElementById('metaSetCount'),
    setupView: document.getElementById('setupView'),
    quizView: document.getElementById('quizView'),
    setSelect: document.getElementById('setSelect'),
    setInfoPill: document.getElementById('setInfoPill'),
    shuffleQuestions: document.getElementById('shuffleQuestions'),
    shuffleOptions: document.getElementById('shuffleOptions'),
    savedSessionNote: document.getElementById('savedSessionNote'),
    startBtn: document.getElementById('startBtn'),
    resumeBtn: document.getElementById('resumeBtn'),
    clearSavedBtn: document.getElementById('clearSavedBtn'),
    sidebarSetTitle: document.getElementById('sidebarSetTitle'),
    timerText: document.getElementById('timerText'),
    answeredCount: document.getElementById('answeredCount'),
    unansweredCount: document.getElementById('unansweredCount'),
    flaggedCount: document.getElementById('flaggedCount'),
    shuffleStateLabel: document.getElementById('shuffleStateLabel'),
    questionNav: document.getElementById('questionNav'),
    submitBtn: document.getElementById('submitBtn'),
    backBtn: document.getElementById('backBtn'),
    resetBtn: document.getElementById('resetBtn'),
    questionMeta: document.getElementById('questionMeta'),
    questionTitle: document.getElementById('questionTitle'),
    flagBtn: document.getElementById('flagBtn'),
    resultBanner: document.getElementById('resultBanner'),
    questionCard: document.getElementById('questionCard'),
    prevBtn: document.getElementById('prevBtn'),
    nextBtn: document.getElementById('nextBtn'),
  };

  const state = loadState();
  let timerHandle = null;

  init();

  function init() {
    elements.metaQuestionCount.textContent = String(appData.meta.questionCount);
    elements.metaSetCount.textContent = String(appData.meta.setCount);

    elements.setSelect.innerHTML = appData.examSets
      .map((examSet) => `<option value="${examSet.id}">${examSet.id} - ${examSet.size} cau</option>`)
      .join('');

    elements.setSelect.value = state.selectedSetId;
    elements.shuffleQuestions.checked = state.preferences.shuffleQuestions;
    elements.shuffleOptions.checked = state.preferences.shuffleOptions;

    bindEvents();
    render();
  }

  function bindEvents() {
    elements.setSelect.addEventListener('change', () => {
      state.selectedSetId = elements.setSelect.value;
      saveState();
      renderSetup();
    });

    elements.shuffleQuestions.addEventListener('change', () => {
      state.preferences.shuffleQuestions = elements.shuffleQuestions.checked;
      saveState();
      renderSetup();
    });

    elements.shuffleOptions.addEventListener('change', () => {
      state.preferences.shuffleOptions = elements.shuffleOptions.checked;
      saveState();
      renderSetup();
    });

    elements.startBtn.addEventListener('click', () => {
      startSession(state.selectedSetId);
    });

    elements.resumeBtn.addEventListener('click', () => {
      if (state.session) {
        state.selectedSetId = state.session.setId;
        elements.setSelect.value = state.selectedSetId;
        render();
      }
    });

    elements.clearSavedBtn.addEventListener('click', () => {
      if (!state.session) {
        return;
      }
      if (!window.confirm('Xoa phien dang luu hien tai?')) {
        return;
      }
      state.session = null;
      saveState();
      render();
    });

    elements.submitBtn.addEventListener('click', submitSession);
    elements.backBtn.addEventListener('click', () => {
      renderSetupOnly();
    });

    elements.resetBtn.addEventListener('click', () => {
      if (!state.session) {
        return;
      }
      if (!window.confirm('Lam lai se xoa toan bo lua chon hien tai. Tiep tuc?')) {
        return;
      }
      startSession(state.session.setId);
    });

    elements.prevBtn.addEventListener('click', () => moveQuestion(-1));
    elements.nextBtn.addEventListener('click', () => moveQuestion(1));
    elements.flagBtn.addEventListener('click', toggleFlagCurrentQuestion);
  }

  function render() {
    renderSetup();
    renderQuiz();
    syncTimer();
  }

  function renderSetup() {
    const selectedSet = setsById.get(state.selectedSetId);
    elements.setInfoPill.textContent = `${selectedSet.size} cau`;

    if (!state.session) {
      elements.savedSessionNote.textContent = 'Chua co phien dang luu.';
      elements.resumeBtn.classList.add('hidden');
      elements.clearSavedBtn.classList.add('hidden');
    } else {
      const unanswered = getUnansweredCount(state.session);
      const status = state.session.submitted ? 'da nop bai' : 'dang lam';
      elements.savedSessionNote.textContent = `Dang co phien ${state.session.setId} (${status}), con ${unanswered} cau chua chon.`;
      elements.resumeBtn.classList.remove('hidden');
      elements.clearSavedBtn.classList.remove('hidden');
    }
  }

  function renderSetupOnly() {
    elements.setupView.classList.remove('hidden');
    elements.quizView.classList.add('hidden');
  }

  function renderQuiz() {
    if (!state.session) {
      renderSetupOnly();
      return;
    }

    elements.setupView.classList.add('hidden');
    elements.quizView.classList.remove('hidden');

    const session = state.session;
    const examSet = setsById.get(session.setId);
    const total = session.questionOrder.length;
    const answered = getAnsweredCount(session);
    const unanswered = total - answered;
    const flagged = session.flaggedIds.length;
    const currentQuestionId = session.questionOrder[session.currentIndex];
    const currentQuestion = getQuestionView(currentQuestionId, session);

    elements.sidebarSetTitle.textContent = `${session.setId} - ${examSet.size} cau`;
    elements.answeredCount.textContent = String(answered);
    elements.unansweredCount.textContent = String(unanswered);
    elements.flaggedCount.textContent = String(flagged);
    elements.shuffleStateLabel.textContent = buildShuffleLabel(session.preferences);
    elements.submitBtn.textContent = session.submitted ? 'Da nop bai' : 'Nop bai';
    elements.submitBtn.disabled = session.submitted;
    elements.flagBtn.textContent = session.flaggedIds.includes(currentQuestionId)
      ? 'Bo danh dau'
      : 'Danh dau cau nay';
    elements.questionMeta.textContent = `${currentQuestion.section} - Cau goc ${currentQuestion.localNumber}`;
    elements.questionTitle.textContent = `Cau ${session.currentIndex + 1} / ${total}`;
    elements.prevBtn.disabled = session.currentIndex === 0;
    elements.nextBtn.disabled = session.currentIndex === total - 1;

    renderResultBanner();
    renderQuestionNav();
    renderQuestionCard(currentQuestion);
  }

  function renderResultBanner() {
    const session = state.session;
    if (!session || !session.submitted) {
      elements.resultBanner.classList.add('hidden');
      elements.resultBanner.textContent = '';
      return;
    }

    const correct = getCorrectCount(session);
    const total = session.questionOrder.length;
    const score = ((correct / total) * 10).toFixed(2);
    elements.resultBanner.classList.remove('hidden');
    elements.resultBanner.textContent = `Ban dung ${correct}/${total} cau. Diem quy doi: ${score}/10. Chon tung cau trong luoi ben trai de xem dap an dung / sai.`;
  }

  function renderQuestionNav() {
    const session = state.session;
    const html = session.questionOrder
      .map((questionId, index) => {
        const selected = session.answers[questionId];
        const classNames = [];
        if (index === session.currentIndex) classNames.push('current');
        if (selected) classNames.push('answered');
        if (session.flaggedIds.includes(questionId)) classNames.push('flagged');
        if (session.submitted) {
          if (selected && selected === questionsById.get(questionId).correctOptionId) {
            classNames.push('correct');
          } else if (selected || questionsById.get(questionId).correctOptionId) {
            classNames.push('wrong');
          }
        }

        return `<button type="button" class="${classNames.join(' ')}" data-index="${index}">${index + 1}</button>`;
      })
      .join('');

    elements.questionNav.innerHTML = html;
    elements.questionNav.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        state.session.currentIndex = Number(button.dataset.index);
        saveState();
        renderQuiz();
      });
    });
  }

  function renderQuestionCard(questionView) {
    const session = state.session;
    const selected = session.answers[questionView.id];

    const optionsHtml = questionView.options
      .map((option, index) => {
        const classNames = ['option'];
        const badges = [];
        if (selected === option.id) {
          classNames.push('selected');
        }

        if (session.submitted) {
          if (option.id === questionView.correctOptionId) {
            classNames.push('correct');
            badges.push('<span class="option-badge correct">Dap an dung</span>');
          } else if (selected === option.id) {
            classNames.push('wrong');
            badges.push('<span class="option-badge wrong">Lua chon cua ban</span>');
          }
        }

        return `
          <button type="button" class="${classNames.join(' ')}" data-option-id="${option.id}">
            <span class="option-letter">${visibleLetters[index] || option.id}</span>
            <span>
              <span class="option-text">${escapeHtml(option.text)}</span>
              ${badges.join('')}
            </span>
          </button>
        `;
      })
      .join('');

    elements.questionCard.innerHTML = `
      <h3>${escapeHtml(questionView.prompt)}</h3>
      <p class="question-submeta">${session.submitted ? 'Che do xem lai dap an.' : 'Chon mot dap an, co the doi cau va quay lai sau.'}</p>
      <div class="options">${optionsHtml}</div>
    `;

    if (session.submitted) {
      return;
    }

    elements.questionCard.querySelectorAll('[data-option-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const questionId = session.questionOrder[session.currentIndex];
        session.answers[questionId] = button.dataset.optionId;
        saveState();
        renderQuiz();
      });
    });
  }

  function startSession(setId) {
    const examSet = setsById.get(setId);
    const seed = Date.now();
    const questionOrder = state.preferences.shuffleQuestions
      ? shuffle(examSet.questionIds, hashString(`${setId}:${seed}:questions`))
      : [...examSet.questionIds];

    const optionOrders = {};
    for (const questionId of questionOrder) {
      const baseOptions = questionsById.get(questionId).options.map((option) => option.id);
      optionOrders[questionId] = state.preferences.shuffleOptions
        ? shuffle(baseOptions, hashString(`${setId}:${seed}:${questionId}:options`))
        : baseOptions;
    }

    state.session = {
      setId,
      startedAt: seed,
      currentIndex: 0,
      questionOrder,
      optionOrders,
      answers: {},
      flaggedIds: [],
      submitted: false,
      finishedAt: null,
      preferences: {
        shuffleQuestions: state.preferences.shuffleQuestions,
        shuffleOptions: state.preferences.shuffleOptions,
      },
    };

    saveState();
    render();
  }

  function moveQuestion(step) {
    if (!state.session) {
      return;
    }
    const nextIndex = state.session.currentIndex + step;
    if (nextIndex < 0 || nextIndex >= state.session.questionOrder.length) {
      return;
    }
    state.session.currentIndex = nextIndex;
    saveState();
    renderQuiz();
  }

  function toggleFlagCurrentQuestion() {
    if (!state.session) {
      return;
    }
    const questionId = state.session.questionOrder[state.session.currentIndex];
    const flagged = new Set(state.session.flaggedIds);
    if (flagged.has(questionId)) {
      flagged.delete(questionId);
    } else {
      flagged.add(questionId);
    }
    state.session.flaggedIds = [...flagged];
    saveState();
    renderQuiz();
  }

  function submitSession() {
    if (!state.session || state.session.submitted) {
      return;
    }

    const unanswered = getUnansweredCount(state.session);
    const message = unanswered > 0
      ? `Con ${unanswered} cau chua chon. Ban van muon nop bai?`
      : 'Ban chac chan muon nop bai?';

    if (!window.confirm(message)) {
      return;
    }

    state.session.submitted = true;
    state.session.finishedAt = Date.now();
    saveState();
    renderQuiz();
  }

  function getQuestionView(questionId, session) {
    const question = questionsById.get(questionId);
    const order = session.optionOrders[questionId];
    const optionLookup = new Map(question.options.map((option) => [option.id, option]));

    return {
      ...question,
      options: order.map((optionId) => optionLookup.get(optionId)),
    };
  }

  function getAnsweredCount(session) {
    return Object.keys(session.answers).length;
  }

  function getUnansweredCount(session) {
    return session.questionOrder.length - getAnsweredCount(session);
  }

  function getCorrectCount(session) {
    return session.questionOrder.filter((questionId) => session.answers[questionId] === questionsById.get(questionId).correctOptionId).length;
  }

  function buildShuffleLabel(preferences) {
    const parts = [];
    if (preferences.shuffleQuestions) parts.push('cau hoi');
    if (preferences.shuffleOptions) parts.push('dap an');
    if (parts.length === 0) return 'Khong xao tron';
    return `Xao tron: ${parts.join(' + ')}`;
  }

  function syncTimer() {
    if (timerHandle) {
      window.clearInterval(timerHandle);
      timerHandle = null;
    }

    updateTimer();

    if (!state.session || state.session.submitted) {
      return;
    }

    timerHandle = window.setInterval(updateTimer, 1000);
  }

  function updateTimer() {
    if (!state.session) {
      elements.timerText.textContent = '00:00';
      return;
    }

    const end = state.session.submitted ? state.session.finishedAt : Date.now();
    elements.timerText.textContent = formatDuration(end - state.session.startedAt);
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function loadState() {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return defaultState();
      }
      const parsed = JSON.parse(raw);
      return {
        selectedSetId: parsed.selectedSetId && setsById.has(parsed.selectedSetId) ? parsed.selectedSetId : appData.examSets[0].id,
        preferences: {
          shuffleQuestions: parsed.preferences?.shuffleQuestions !== false,
          shuffleOptions: parsed.preferences?.shuffleOptions !== false,
        },
        session: sanitizeSession(parsed.session),
      };
    } catch (_error) {
      return defaultState();
    }
  }

  function defaultState() {
    return {
      selectedSetId: appData.examSets[0].id,
      preferences: {
        shuffleQuestions: true,
        shuffleOptions: true,
      },
      session: null,
    };
  }

  function sanitizeSession(session) {
    if (!session || !setsById.has(session.setId)) {
      return null;
    }

    if (!Array.isArray(session.questionOrder) || session.questionOrder.some((questionId) => !questionsById.has(questionId))) {
      return null;
    }

    return {
      setId: session.setId,
      startedAt: Number(session.startedAt) || Date.now(),
      currentIndex: Math.min(Math.max(Number(session.currentIndex) || 0, 0), session.questionOrder.length - 1),
      questionOrder: session.questionOrder,
      optionOrders: session.optionOrders || {},
      answers: session.answers || {},
      flaggedIds: Array.isArray(session.flaggedIds) ? session.flaggedIds : [],
      submitted: Boolean(session.submitted),
      finishedAt: session.finishedAt ? Number(session.finishedAt) : null,
      preferences: session.preferences || {
        shuffleQuestions: true,
        shuffleOptions: true,
      },
    };
  }

  function saveState() {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        selectedSetId: state.selectedSetId,
        preferences: state.preferences,
        session: state.session,
      }),
    );
    syncTimer();
  }

  function shuffle(items, seed) {
    const result = [...items];
    const random = mulberry32(seed);
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }

  function mulberry32(seed) {
    let value = seed >>> 0;
    return function () {
      value += 0x6d2b79f5;
      let temp = value;
      temp = Math.imul(temp ^ (temp >>> 15), temp | 1);
      temp ^= temp + Math.imul(temp ^ (temp >>> 7), temp | 61);
      return ((temp ^ (temp >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
