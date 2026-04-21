// ===== State =====
let questions = [];
let owners = [];        // owner.json data, keyed by category
let answers = [];       // index -> score value (may be null)
let currentIndex = 0;
let phase = 'intro';    // 'intro' | 'quiz' | 'result'

const OPTIONS = [
  { label: '非常同意', value: 2 },
  { label: '同意',     value: 1 },
  { label: '一般',     value: 0 },
  { label: '不同意',   value: -1 },
  { label: '非常不同意', value: -2 },
];

// ===== Boot =====
async function init() {
  try {
    const [qRes, oRes] = await Promise.all([
      fetch('./question.json'),
      fetch('./owner.json'),
    ]);
    if (!qRes.ok) throw new Error('无法加载 question.json');
    if (!oRes.ok) throw new Error('无法加载 owner.json');
    questions = await qRes.json();
    const ownerList = await oRes.json();
    // Build a map: category -> { avatar, comment }
    owners = {};
    ownerList.forEach(o => { owners[o.category] = o; });
    answers = new Array(questions.length).fill(null);
    renderIntro();
  } catch (e) {
    document.getElementById('app').innerHTML =
      `<div class="card"><p style="color:#e53e3e;text-align:center">加载失败：${e.message}</p></div>`;
  }
}

// ===== Render Intro =====
function renderIntro() {
  phase = 'intro';
  const categories = [...new Set(questions.map(q => q.category))];
  document.getElementById('app').innerHTML = `
    <div class="card">
      <div class="intro-header">
        <div class="intro-emoji">📋</div>
      <div class="intro-title">测测你的群归属</div>
      </div>
      <div class="intro-start">
        <button class="btn btn-primary" onclick="startQuiz()">开始答题 →</button>
      </div>
    </div>`;
}

// ===== Start Quiz =====
function startQuiz() {
  phase = 'quiz';
  currentIndex = 0;
  answers = new Array(questions.length).fill(null);
  renderQuestion();
}

// ===== Render Question =====
function renderQuestion() {
  const q = questions[currentIndex];
  const total = questions.length;
  const progress = ((currentIndex) / total) * 100;
  const selectedVal = answers[currentIndex];

  const optionsHtml = OPTIONS.map(opt => {
    const isSelected = selectedVal === opt.value ? 'selected' : '';
    return `
      <button class="option-btn ${isSelected}" onclick="selectOption(${opt.value})">
        <span>${opt.label}</span>
      </button>`;
  }).join('');

  const canPrev = currentIndex > 0;
  const isLast = currentIndex === total - 1;
  const canNext = selectedVal !== null;

  document.getElementById('app').innerHTML = `
    <div class="card">
      <div class="progress-wrap">
        <div class="progress-label">
          <span>答题进度</span>
          <span>${currentIndex + 1} / ${total}</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width:${progress}%"></div>
        </div>
      </div>

      <div class="question-num">第 ${currentIndex + 1} 题</div>
      <div class="question-text">${q.question}</div>

      <div class="options">${optionsHtml}</div>

      <div class="nav-row">
        <button class="btn btn-secondary" onclick="prevQuestion()" ${canPrev ? '' : 'disabled'}>← 上一题</button>
        ${isLast
          ? `<button class="btn btn-primary" onclick="submitQuiz()" ${canNext ? '' : 'disabled'}>查看结果 🎯</button>`
          : `<button class="btn btn-primary" onclick="nextQuestion()" ${canNext ? '' : 'disabled'}>下一题 →</button>`}
      </div>
    </div>`;
}

// ===== Option Select =====
function selectOption(value) {
  answers[currentIndex] = value;
  renderQuestion();
}

// ===== Navigation =====
function prevQuestion() {
  if (currentIndex > 0) { currentIndex--; renderQuestion(); }
}

function nextQuestion() {
  if (answers[currentIndex] !== null && currentIndex < questions.length - 1) {
    currentIndex++;
    renderQuestion();
  }
}

// ===== Submit & Result =====
function submitQuiz() {
  phase = 'result';

  // Calculate scores per category
  const scoreMap = {};
  questions.forEach((q, i) => {
    if (!(q.category in scoreMap)) scoreMap[q.category] = 0;
    const raw = answers[i] ?? 0;
    scoreMap[q.category] += raw * q.multiplier;
  });

  const categories = Object.keys(scoreMap);
  const maxScore = Math.max(...Object.values(scoreMap));
  const winners = categories.filter(c => scoreMap[c] === maxScore);

  const winnersHtml = winners.map(w => {
    const o = owners[w] || {};
    const avatar = o.avatar || '';
    const avatarHtml = avatar
      ? `<img class="owner-avatar-img" src="${avatar}" alt="${w}" />`
      : `<div class="owner-avatar-placeholder">👤</div>`;
    const comment = o.comment || '';
    return `
      <div class="owner-card">
        ${avatarHtml}
        <div class="owner-name">${w}</div>
        ${comment ? `<div class="owner-comment">${comment}</div>` : ''}
      </div>`;
  }).join('');

  document.getElementById('app').innerHTML = `
    <div class="card">
      <div class="result-header">
        <div class="result-title">你的主人是</div>
      </div>
      <div class="owners-wrap">${winnersHtml}</div>
      <div class="restart-row">
        <button class="btn btn-secondary" onclick="startQuiz()">重新答题</button>
      </div>
    </div>`;
}

// ===== Go =====
init();

