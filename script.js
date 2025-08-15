/********** CONFIG **********/
/* Google Sheet CSV (header: Question,Option1,Option2,Option3,Option4,Answer) */
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRiqqInQm40Eo-MOFDuPOC40etCZdH3Fxnb5ZrZwJk2ziHeIVGOYyQ0xqWKNsL-vw1FxEfYzr7u18fZ/pub?output=csv";

/* Two logos (replace with your links; Google Drive -> uc?export=view&id=...) */
const LOGO_LEFT  = "https://drive.google.com/file/d/1QCjEZ7XRiElI9pBeyCxtfnFLh_xuB4iS/view?usp=drive_link";
const LOGO_RIGHT = "https://drive.google.com/file/d/1QCjEZ7XRiElI9pBeyCxtfnFLh_xuB4iS/view?usp=drive_link";

/* Scoring (leaderboard still fully editable) */
const CORRECT_POINTS = 10;
/****************************/

/* ------- DOM refs ------- */
const logoLeft = document.getElementById("logoLeft");
const logoRight = document.getElementById("logoRight");
logoLeft.src = LOGO_LEFT;
logoRight.src = LOGO_RIGHT;

const timerInput = document.getElementById("timerInput");
const timeEl = document.getElementById("time");
const timerContainer = document.querySelector(".timer");
const overlay = document.getElementById("timeout-overlay");

const currentTeamEl = document.getElementById("currentTeam");
const qText = document.getElementById("question");
const optionsWrap = document.getElementById("options");
const showAnswerBtn = document.getElementById("showAnswerBtn");
const nextBtn = document.getElementById("nextBtn");

const teamsWrap = document.getElementById("teams");

/* ------- State ------- */
let questions = [];         // { question, options:[4], answerIndex }
let qIndex = 0;
let currentTeam = 0;
let teams = [
  { name:"Team A", score:0 },
  { name:"Team B", score:0 },
  { name:"Team C", score:0 },
  { name:"Team D", score:0 },
  { name:"Team E", score:0 },
  { name:"Team F", score:0 },
];

let timerId = null;
let timeLeft = 30;
let clickedSet = new Set(); // which option indexes clicked this question
let correctIndex = -1;
let questionCompleted = false;

/* ------- Utils ------- */
function csvToRows(csvText){
  // Simple CSV parser handling quoted commas
  const rows = [];
  let row = [], cell = "", inQuotes = false;

  for (let i=0;i<csvText.length;i++){
    const c = csvText[i];
    if (c === '"'){
      if (inQuotes && csvText[i+1] === '"'){ cell += '"'; i++; }
      else inQuotes = !inQuotes;
    }else if (c === ',' && !inQuotes){
      row.push(cell); cell = "";
    }else if (c === '\n' && !inQuotes){
      row.push(cell); rows.push(row);
      row = []; cell = "";
    }else{
      cell += c;
    }
  }
  if (cell.length || row.length){ row.push(cell); rows.push(row); }
  return rows;
}
function isImageUrl(s){
  if (!s) return false;
  const lower = s.trim().toLowerCase();
  if (lower.startsWith("img:")) return true;
  return /^https?:\/\/.+\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(lower);
}

/* ------- Leaderboard ------- */
function renderTeams(){
  teamsWrap.innerHTML = "";
  teams.forEach((t, idx)=>{
    const row = document.createElement("div");
    row.className = "team" + (idx===currentTeam ? " active" : "");
    row.innerHTML = `
      <input type="text" value="${t.name}" />
      <span class="score" contenteditable="true">${t.score}</span>
      <button class="smallbtn" data-i="${idx}" data-delta="1">+1</button>
      <button class="smallbtn" data-i="${idx}" data-delta="-1">-1</button>
      <button class="smallbtn" data-i="${idx}" data-delta="5">+5</button>
      <button class="smallbtn" data-i="${idx}" data-delta="-5">-5</button>
    `;
    row.querySelector("input").addEventListener("change", e=>{
      teams[idx].name = e.target.value.trim() || `Team ${idx+1}`;
      updateCurrentTeamDisplay();
    });
    const scoreCell = row.querySelector(".score");
    scoreCell.addEventListener("input", ()=>{
      const val = parseInt(scoreCell.innerText.replace(/[^\d-]/g,"")) || 0;
      teams[idx].score = val;
    });
    row.querySelectorAll(".smallbtn").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const i = +btn.dataset.i;
        const delta = +btn.dataset.delta;
        teams[i].score += delta;
        renderTeams();
      });
    });
    teamsWrap.appendChild(row);
  });
}
function updateCurrentTeamDisplay(){
  currentTeamEl.innerHTML = `Current Team: <span class="name">${teams[currentTeam].name}</span>`;
  document.querySelectorAll(".team").forEach((el,i)=>{
    el.classList.toggle("active", i===currentTeam);
  });
}

/* ------- Timer ------- */
function startTimer(){
  clearInterval(timerId);
  overlay.hidden = true;
  timerContainer.classList.remove("red");
  timeLeft = parseInt(timerInput.value,10) || 30;
  timeEl.textContent = timeLeft;

  timerId = setInterval(()=>{
    timeLeft--;
    timeEl.textContent = timeLeft;

    if (timeLeft <= 10 && timeLeft > 0){
      timerContainer.classList.add("red");
    }else{
      timerContainer.classList.remove("red");
    }

    if (timeLeft <= 0){
      clearInterval(timerId);
      timerContainer.classList.remove("red");
      overlay.hidden = false;               // entire screen turns red
      disableAllOptions();                  // lock the question
      enableShowAnswerIfAllowed(true);      // allow showing the answer when time is up
    }
  }, 1000);
}

/* ------- Question render/flow ------- */
function loadQuestion(){
  if (qIndex >= questions.length){
    qText.textContent = "Quiz Finished. Great job!";
    optionsWrap.innerHTML = "";
    showAnswerBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  // reset per-question state
  questionCompleted = false;
  clickedSet.clear();
  overlay.hidden = true;

  const q = questions[qIndex];
  qText.textContent = q.question;

  optionsWrap.innerHTML = "";
  q.options.forEach((opt, i)=>{
    const btn = document.createElement("button");
    btn.className = "option";
    btn.dataset.index = i;

    if (isImageUrl(opt)){
      const url = opt.trim().toLowerCase().startsWith("img:")
        ? opt.trim().slice(4).trim()
        : opt.trim();
      const img = document.createElement("img");
      img.src = url;
      img.alt = `Option ${i+1}`;
      btn.appendChild(img);
    }else{
      btn.textContent = opt;
    }

    btn.addEventListener("click", ()=> handleOptionClick(btn, i));
    optionsWrap.appendChild(btn);
  });

  correctIndex = q.answerIndex;

  // fresh controls
  nextBtn.disabled = true;
  showAnswerBtn.disabled = true;

  startTimer();
  updateCurrentTeamDisplay();
}

function handleOptionClick(btn, i){
  if (questionCompleted) return;

  clickedSet.add(i);
  const isCorrect = (i === correctIndex);

  if (isCorrect){
    btn.classList.add("correct");               // green
    // award points immediately (editable on board if you want to change)
    teams[currentTeam].score += CORRECT_POINTS;
    renderTeams();
    // do NOT unlock Next yet; must press Show Answer first (as per rule)
  }else{
    btn.classList.add("wrong");                 // red
    btn.disabled = true;                        // keep wrong disabled
    currentTeam = (currentTeam + 1) % teams.length; // pass to next team
    updateCurrentTeamDisplay();
  }

  enableShowAnswerIfAllowed(false);
}

function enableShowAnswerIfAllowed(force){
  if (force){
    showAnswerBtn.disabled = false;   // time up: allow show answer
    return;
  }
  // Only enable after ALL choices have been clicked at least once
  if (clickedSet.size >= 4){
    showAnswerBtn.disabled = false;
  }
}

function disableAllOptions(){
  document.querySelectorAll(".option").forEach(b=> b.disabled = true);
}

/* Show correct → then enable Next */
showAnswerBtn.addEventListener("click", ()=>{
  document.querySelectorAll(".option").forEach((b, idx)=>{
    if (idx === correctIndex) b.classList.add("correct"); // ensure correct is green
    b.disabled = true;
  });
  questionCompleted = true;
  nextBtn.disabled = false;  // only now Next is enabled
});

nextBtn.addEventListener("click", ()=>{
  qIndex++;
  loadQuestion();
});

/* ------- Data load ------- */
async function loadCSV(){
  const res = await fetch(CSV_URL);
  const text = await res.text();
  const rows = csvToRows(text);
  // Expected header
  const header = rows[0].map(h=>h.trim().toLowerCase());
  const qi = header.indexOf("question");
  const a1 = header.indexOf("option1");
  const a2 = header.indexOf("option2");
  const a3 = header.indexOf("option3");
  const a4 = header.indexOf("option4");
  const ans = header.indexOf("answer");

  questions = rows.slice(1).filter(r=>r.length && r[qi]).map(r=>{
    const opts = [r[a1], r[a2], r[a3], r[a4]].map(x=> (x||"").trim());
    const answerText = (r[ans]||"").trim();
    // Answer can be the exact option text OR a number 1–4
    let answerIndex = -1;
    const n = parseInt(answerText,10);
    if (!Number.isNaN(n) && n>=1 && n<=4) answerIndex = n-1;
    else answerIndex = opts.findIndex(o=> o === answerText);
    if (answerIndex < 0) answerIndex = 0; // fallback
    return { question:r[qi], options:opts, answerIndex };
  });
}

/* ------- Init ------- */
function init(){
  renderTeams();
  updateCurrentTeamDisplay();
  loadCSV().then(loadQuestion);

  // keep timer sane
  timerInput.addEventListener("change", ()=>{
    const v = parseInt(timerInput.value,10);
    if (isNaN(v) || v<5) timerInput.value = 5;
  });
}
init();
