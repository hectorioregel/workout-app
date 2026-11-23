(() => {
  const STORAGE_KEY = "hector-workout-v1";
  const WEIGHT_STEP = 5;
  const PRESETS = [
    { id: "30", label: "30s", seconds: 30 },
    { id: "60", label: "60s", seconds: 60 },
    { id: "90", label: "90s", seconds: 90 },
    { id: "2m", label: "2m", seconds: 120 },
    { id: "3m", label: "3m", seconds: 180 },
    { id: "custom", label: "Custom", seconds: 0 }
  ];

  const ui = {
    view: "home", // home | group
    groupId: null,
    selected: null, // { exerciseId, setIndex }
    sheet: null, // { type, ... }
    toastTimer: 0,
    runId: null
  };

  const timer = {
    remainingMs: 0,
    endAt: 0,
    running: false,
    interval: 0,
    presetId: "60",
    customMin: 1,
    customSec: 0,
    wakeLock: null,
    justFinished: false,
    stage: null,
    nextOffer: null
  };

  const track = {
    status: "idle", // idle | running | paused
    watchId: null,
    points: [],
    elapsedBefore: 0,
    segmentStart: 0,
    tick: 0,
    gpsError: "",
    waitingGps: false,
    map: null,
    line: null,
    startMarker: null,
    endMarker: null,
    wakeLock: null
  };

  function uid() {
    return (crypto.randomUUID && crypto.randomUUID()) ||
      ("id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function formatLongDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric"
    });
  }

  function setsOf(count, reps, weight) {
    return Array.from({ length: count }, () => ({ targetReps: reps, weight }));
  }

  function ex(name, opts) {
    const weight = opts.bodyweight ? 0 : (opts.weight || 0);
    const reps = opts.reps != null ? opts.reps : (opts.repMin || 0);
    return {
      id: opts.id || uid(),
      name,
      equipmentNote: opts.note || "",
      notes: opts.notes || "",
      isBodyweight: !!opts.bodyweight,
      sets: setsOf(opts.sets || 1, reps, weight),
      stages: opts.stages || null,
      history: opts.history || [],
      repMin: opts.repMin || 0,
      repMax: opts.repMax || 0,
      weightStep: opts.step || 0,
      logUnit: opts.unit || "reps"
    };
  }

  function treadmillIntervals() {
    return ex("Treadmill intervals", {
      id: "c-treadmill",
      bodyweight: true,
      sets: 2,
      reps: 0,
      notes: "2 rounds",
      stages: [
        { label: "Walk", duration: "3 min", setting: "3.5" },
        { label: "Jog", duration: "4 min", setting: "7.1" },
        { label: "Sprint", duration: "1 min", setting: "10.5" }
      ]
    });
  }

  function phase1Groups() {
    const db = (name, id, sets, repMin, repMax, weight, notes) =>
      ex(name, { id, sets, repMin, repMax, reps: repMin, weight, step: 5, notes });
    return [
      {
        id: "day-a",
        name: "Day A",
        mark: "A",
        exercises: [
          db("Goblet squat to box", "a-squat", 3, 10, 12, 50, "one 50 lb dumbbell"),
          db("DB bench/floor press", "a-press", 3, 8, 12, 50, ""),
          db("One-arm DB row", "a-row", 3, 10, 12, 45, "per side"),
          ex("Leg curl (machine)", { id: "a-curl", sets: 3, repMin: 12, repMax: 15, reps: 12, weight: 150, step: 10 }),
          ex("Plank", { id: "a-plank", bodyweight: true, sets: 3, repMin: 30, repMax: 45, reps: 30, unit: "sec", notes: "log seconds" })
        ]
      },
      {
        id: "day-b",
        name: "Day B",
        mark: "B",
        exercises: [
          db("DB Romanian deadlift", "b-rdl", 3, 10, 12, 45, ""),
          db("Seated DB shoulder press", "b-press", 3, 8, 12, 30, ""),
          ex("Push-ups", { id: "b-push", bodyweight: true, sets: 3, reps: 8, notes: "2 reps short of failure" }),
          ex("Leg extension (machine)", { id: "b-ext", sets: 3, repMin: 12, repMax: 15, reps: 12, weight: 150, step: 10 }),
          ex("Dead bug", { id: "b-bug", bodyweight: true, sets: 3, repMin: 10, repMax: 10, reps: 10, notes: "per side" })
        ]
      },
      {
        id: "day-c",
        name: "Day C",
        mark: "C",
        exercises: [
          db("DB hip thrust", "c-thrust", 3, 12, 15, 55, "one 55 lb dumbbell · 2 s squeeze"),
          db("Incline DB press", "c-incline", 3, 8, 12, 45, ""),
          db("Two-arm DB row", "c-row", 3, 10, 12, 40, ""),
          db("Calf raise", "c-calf", 3, 15, 20, 30, "30 lb each hand · 1 s pause"),
          db("DB curl", "c-curl", 2, 10, 12, 40, ""),
          db("Overhead triceps extension", "c-tri", 2, 10, 12, 45, "one 45 lb dumbbell"),
          treadmillIntervals()
        ]
      }
    ];
  }

  function defaultData() {
    return {
      version: 1,
      groups: phase1Groups(),
      activeSession: null,
      installTipDismissed: false,
      runs: []
    };
  }

  let data = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.groups)) return defaultData();
      const migrated = migrate(parsed);
      if (migrated.changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated.data));
      return migrated.data;
    } catch (err) {
      return defaultData();
    }
  }

  function migrate(parsed) {
    let changed = false;
    if (!Array.isArray(parsed.runs)) {
      parsed.runs = [];
      changed = true;
    }
    parsed.groups = parsed.groups || [];
    if (!parsed.groups.some((g) => g.id === "day-a")) {
      parsed.groups = phase1Groups().concat(parsed.groups);
      changed = true;
    }
    for (const group of parsed.groups) {
      if ((group.id === "arms" || group.id === "abs" || group.id === "legs") && !group.archived) {
        group.archived = true;
        changed = true;
      }
      for (const exercise of group.exercises || []) {
        if (exercise && exercise.name === "Leg machine up") {
          exercise.name = "Leg machine";
          changed = true;
        }
      }
    }
    return { data: parsed, changed };
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function rolloverSessionIfNeeded() {
    if (data.activeSession && data.activeSession.date !== todayISO()) {
      if (sessionHasProgress()) finalizeSession(true);
      else data.activeSession = null;
    }
  }

  function findGroup(id) {
    return data.groups.find((g) => g.id === id);
  }

  function findExercise(id) {
    for (const group of data.groups) {
      const found = group.exercises.find((e) => e.id === id);
      if (found) return { group, exercise: found };
    }
    return null;
  }

  function allExercises() {
    return data.groups.flatMap((g) => g.exercises.map((e) => ({ group: g, exercise: e })));
  }

  function ensureSession() {
    if (!data.activeSession) {
      data.activeSession = { date: todayISO(), exercises: {} };
    }
    return data.activeSession;
  }

  function workingSets(exercise) {
    const sess = data.activeSession && data.activeSession.exercises[exercise.id];
    let sets;
    if (sess && Array.isArray(sess.sets)) {
      sets = sess.sets.map((s) => ({ ...s }));
    } else {
      sets = exercise.sets.map((s) => ({
        reps: s.targetReps,
        weight: s.weight,
        done: false
      }));
    }
    if (exercise.stages && exercise.stages.length) {
      sets = sets.map((s) => {
        const stagesDone = normalizeStagesDone(exercise, s);
        return {
          ...s,
          stagesDone,
          done: stagesDone.length ? stagesDone.every(Boolean) : !!s.done
        };
      });
    }
    return sets;
  }

  function normalizeStagesDone(exercise, set) {
    const n = (exercise.stages || []).length;
    const prev = Array.isArray(set.stagesDone) ? set.stagesDone : null;
    if (!prev) return Array.from({ length: n }, () => !!set.done);
    return Array.from({ length: n }, (_, i) => prev[i] === true);
  }

  function parseDurationSeconds(value) {
    if (value == null || value === "") return 0;
    if (typeof value === "number" && isFinite(value)) {
      return value <= 30 ? Math.round(value * 60) : Math.round(value);
    }
    const raw = String(value).trim().toLowerCase();
    if (!raw) return 0;
    const hms = raw.match(/^(\d+)\s*:\s*(\d{1,2})\s*:\s*(\d{1,2})$/);
    if (hms) return (Number(hms[1]) * 3600) + (Number(hms[2]) * 60) + Number(hms[3]);
    const clock = raw.match(/^(\d+)\s*:\s*(\d{1,2})$/);
    if (clock) return (Number(clock[1]) * 60) + Number(clock[2]);
    const minSec = raw.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes)\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds)?$/);
    if (minSec) return Math.round(Number(minSec[1]) * 60 + Number(minSec[3]));
    const min = raw.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes)\b/);
    if (min) return Math.round(Number(min[1]) * 60);
    const sec = raw.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds)\b/);
    if (sec) return Math.round(Number(sec[1]));
    const bare = raw.match(/^(\d+(?:\.\d+)?)$/);
    if (bare) {
      const n = Number(bare[1]);
      return n <= 30 ? Math.round(n * 60) : Math.round(n);
    }
    return 0;
  }

  function stageSeconds(stage) {
    return parseDurationSeconds(stage && stage.duration);
  }

  const SPEED_MIN = 0.5;
  const SPEED_MAX = 15;
  const SPEED_STEP = 0.1;

  function stageSpeedNumber(setting) {
    const n = parseFloat(String(setting == null ? "" : setting).replace(/[^0-9.]/g, ""));
    return isFinite(n) ? n : SPEED_MIN;
  }

  function formatSpeed(n) {
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  function clampSpeed(n) {
    const rounded = Math.round(n * 10) / 10;
    return Math.min(SPEED_MAX, Math.max(SPEED_MIN, rounded));
  }

  function formatStageSetting(setting) {
    const raw = String(setting == null ? "" : setting).trim();
    if (!raw) return "";
    const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
    if (!isFinite(n)) return "@ " + raw;
    return "@ " + formatSpeed(n);
  }

  function currentSetIndex(exercise) {
    if (ui.selected && ui.selected.exerciseId === exercise.id && Number.isInteger(ui.selected.setIndex)) {
      const sets = workingSets(exercise);
      if (ui.selected.setIndex >= 0 && ui.selected.setIndex < sets.length) return ui.selected.setIndex;
    }
    const sets = workingSets(exercise);
    const open = sets.findIndex((s) => !s.done);
    return open === -1 ? 0 : open;
  }

  function writeWorkingSets(exercise, sets) {
    const session = ensureSession();
    session.exercises[exercise.id] = { sets };
    persist();
  }

  function sessionHasProgress() {
    if (!data.activeSession) return false;
    return Object.values(data.activeSession.exercises).some((e) =>
      (e.sets || []).some((s) => s.done || (s.stagesDone || []).some(Boolean))
    );
  }

  function sessionStats() {
    if (!data.activeSession) return { doneSets: 0, exercises: 0 };
    let doneSets = 0;
    let exercises = 0;
    for (const entry of Object.values(data.activeSession.exercises)) {
      const n = (entry.sets || []).filter((s) => s.done).length;
      if (n) {
        doneSets += n;
        exercises += 1;
      }
    }
    return { doneSets, exercises };
  }

  function finalizeSession(silent) {
    if (!data.activeSession) return;
    const date = data.activeSession.date || todayISO();
    let saved = 0;
    for (const [exerciseId, entry] of Object.entries(data.activeSession.exercises)) {
      const found = findExercise(exerciseId);
      if (!found) continue;
      const sets = entry.sets || [];
      const completed = sets.filter((s) => s.done).map((s) => {
        const row = { reps: s.reps, weight: s.weight };
        if (found.exercise.stages && found.exercise.stages.length) {
          row.stages = found.exercise.stages.map((st, i) => ({
            label: st.label || "Stage",
            duration: st.duration || "",
            setting: (Array.isArray(s.stageSpeeds) && s.stageSpeeds[i] != null && s.stageSpeeds[i] !== "")
              ? String(s.stageSpeeds[i])
              : (st.setting || "")
          }));
        }
        return row;
      });
      if (completed.length) {
        found.exercise.history.unshift({
          id: uid(),
          date,
          sets: completed
        });
        saved += 1;
      }
      const earned = earnedOverload(found.exercise, completed);
      found.exercise.sets = sets.map((s, i) => ({
        targetReps: found.exercise.stages ? (found.exercise.sets[i]?.targetReps || 0) : s.reps,
        weight: (s.weight || 0) + (earned ? found.exercise.weightStep : 0)
      }));
      found.exercise.overload = earned ? true : (completed.length ? false : !!found.exercise.overload);
      if (sets.some((s) => s.weight > 0)) found.exercise.isBodyweight = false;
    }
    const mobility = (data.activeSession && data.activeSession.mobility) || {};
    data.mobilityLog = data.mobilityLog || [];
    let loggedMobility = false;
    for (const [groupId, on] of Object.entries(mobility)) {
      if (!on) continue;
      if (!data.mobilityLog.some((m) => m.groupId === groupId && m.date === date)) {
        data.mobilityLog.push({ date, groupId });
        loggedMobility = true;
      }
    }
    data.activeSession = null;
    persist();
    if (!silent && (saved || loggedMobility)) toast("Workout saved");
    else if (!silent) toast("Nothing to save yet");
    return saved;
  }

  function mobilityChecked(groupId) {
    const today = todayISO();
    if ((data.mobilityLog || []).some((m) => m.groupId === groupId && m.date === today)) return true;
    const session = data.activeSession && data.activeSession.mobility;
    return !!(session && session[groupId]);
  }

  function earnedOverload(exercise, completed) {
    if (!exercise.repMax || !exercise.weightStep) return false;
    if (!completed.length || completed.length < (exercise.sets || []).length) return false;
    return completed.every((s) => s.reps >= exercise.repMax);
  }

  function clearSession() {
    data.activeSession = null;
    ui.selected = null;
    persist();
    toast("Progress cleared");
  }

  function weightLabel(weight, isBodyweight) {
    if (!weight || weight === 0) return "Body weight";
    return weight + " lb";
  }

  function targetLine(exercise, weight) {
    const unit = exercise.logUnit === "sec" ? " s" : "";
    let range = "";
    if (exercise.repMax) {
      range = exercise.repMin && exercise.repMin !== exercise.repMax
        ? exercise.repMin + "–" + exercise.repMax + unit
        : String(exercise.repMax) + unit;
    }
    const bits = [];
    if (exercise.logUnit !== "sec") bits.push(weightLabel(weight, exercise.isBodyweight));
    if (range) bits.push(range);
    if (exercise.equipmentNote) bits.push(exercise.equipmentNote);
    return bits.join(" · ");
  }

  function lastUsed(exercise) {
    if (exercise.history && exercise.history[0]) {
      const last = exercise.history[0];
      const weights = last.sets.map((s) => s.weight);
      const reps = last.sets.map((s) => s.reps);
      return { date: last.date, weights, reps };
    }
    return null;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  function hideToast() {
    const el = document.getElementById("toast");
    if (el) el.hidden = true;
    clearTimeout(ui.toastTimer);
  }

  /* ---------- render ---------- */

  function render() {
    rolloverSessionIfNeeded();
    const app = document.getElementById("app");
    const live = document.getElementById("run-live");
    if (ui.view === "run" && live && track.status !== "idle" && !ui.forceRunRender) {
      updateRunLiveDom();
      renderSheet();
      updateTimerButtons();
      return;
    }
    ui.forceRunRender = false;
    if (ui.view !== "run") destroyRunMap();
    if (ui.view === "group") app.innerHTML = renderGroup();
    else if (ui.view === "run") app.innerHTML = renderRun();
    else if (ui.view === "run-detail") app.innerHTML = renderRunDetail();
    else app.innerHTML = renderHome();
    if (ui.view === "run") mountLiveMap();
    if (ui.view === "run-detail") mountDetailMap();
    renderSheet();
    updateTimerButtons();
  }

  function timerButtonHtml() {
    if (timer.running) {
      return `<button class="icon-btn running" data-act="open-timer" aria-label="Open timer">${formatTime(timer.remainingMs)}</button>`;
    }
    return `<button class="icon-btn" data-act="open-timer" aria-label="Timer">${iconTimer()}</button>`;
  }

  function renderHome() {
    const dateLabel = formatLongDate(todayISO());
    const stats = sessionStats();
    const banner = stats.doneSets
      ? `<button class="session-banner" data-act="save-workout">
           <div style="flex:1">
             <strong>In progress · ${escapeHtml(dateLabel)}</strong>
             <span>${stats.doneSets} set${stats.doneSets === 1 ? "" : "s"} across ${stats.exercises} exercise${stats.exercises === 1 ? "" : "s"} · tap to save</span>
           </div>
         </button>`
      : "";

    const runBanner = track.status !== "idle" ? `<button class="session-banner run-banner" data-act="open-run">
           <div style="flex:1">
             <strong>Run ${track.status === "paused" ? "paused" : "in progress"}</strong>
             <span>${escapeHtml(runSummaryLine())} · tap to return</span>
           </div>
         </button>` : "";

    const card = (g) => {
      const progress = groupProgress(g);
      const sub = progress.done
        ? `${progress.done}/${progress.total} sets today · ${g.exercises.length} exercises`
        : `${g.exercises.length} exercises`;
      const letter = g.mark || g.name[0];
      return `<button class="group-card ${escapeHtml(g.id)}${g.archived ? " archived" : ""}" data-act="open-group" data-id="${escapeHtml(g.id)}">
        <div class="group-mark">${escapeHtml(letter)}</div>
        <div class="group-meta">
          <h2>${escapeHtml(g.name)}</h2>
          <p>${escapeHtml(sub)}</p>
        </div>
        <div class="chev">›</div>
      </button>`;
    };
    const current = data.groups.filter((g) => !g.archived).map(card).join("");
    const previous = data.groups.filter((g) => g.archived);
    const previousHtml = previous.length
      ? `<h2 class="prev-head">Previous plan</h2>${previous.map(card).join("")}`
      : "";

    const tip = data.installTipDismissed ? "" : `
      <div class="tip install-tip">
        <strong>Add to Home Screen</strong><br>
        iPhone: Share → Add to Home Screen.<br>
        Android: menu → Add to Home Screen or Install app.
        <div style="margin-top:8px">
          <button class="btn small" data-act="dismiss-tip">Got it</button>
        </div>
      </div>`;

    return `
      <header class="topbar">
        <div style="flex:1">
          <h1><span class="sub">${escapeHtml(dateLabel)}</span>Workout</h1>
        </div>
        ${timerButtonHtml()}
      </header>
      <div class="page">
        ${banner}
        ${runBanner}
        ${current}
        ${previousHtml}
        ${renderRunCard()}
        <div class="home-actions">
          <button class="btn" data-act="export">Export</button>
          <button class="btn" data-act="import">Import</button>
        </div>
        <input id="import-file" type="file" accept="application/json,.json" hidden>
        ${tip}
      </div>`;
  }

  function groupProgress(group) {
    let total = 0;
    let done = 0;
    for (const exer of group.exercises) {
      const sets = workingSets(exer);
      total += sets.length;
      done += sets.filter((s) => s.done).length;
    }
    return { done, total };
  }

  function renderGroup() {
    const group = findGroup(ui.groupId);
    if (!group) {
      ui.view = "home";
      return renderHome();
    }
    const stats = sessionStats();
    const cards = group.exercises.map((exercise) => renderExercise(exercise)).join("");
    return `
      <header class="topbar">
        <button class="icon-btn" data-act="go-home" aria-label="Back">${iconBack()}</button>
        <h1>${escapeHtml(group.name)}</h1>
        ${timerButtonHtml()}
      </header>
      <div class="page group-page">
        ${group.archived ? "" : `<p class="day-rest">Rest 60-90 s</p>
        <label class="warmup"><input type="checkbox" data-act="toggle-mobility" ${mobilityChecked(group.id) ? "checked" : ""}> Mobility warm-up (3-5 min)</label>`}
        ${cards}
        <button class="add-ex" data-act="add-exercise" data-group="${escapeHtml(group.id)}">+ Add exercise</button>
        <div class="row-actions">
          ${stats.doneSets ? `<button class="btn" data-act="clear-session">Clear</button>` : ""}
          <button class="btn primary" data-act="save-workout">Save workout</button>
        </div>
      </div>`;
  }

  function renderExercise(exercise) {
    const sets = workingSets(exercise);
    const selected = (ui.selected && ui.selected.exerciseId === exercise.id)
      ? ui.selected.setIndex
      : null;
    const last = lastUsed(exercise);
    const lastLine = last
      ? ` · Last ${last.reps.join("/")}${exercise.logUnit === "sec" ? " s" : "×" + (last.weights[0] ? last.weights[0] + " lb" : "BW")}`
      : "";
    const defaultWeight = exercise.sets[0] ? exercise.sets[0].weight : 0;
    const isSec = exercise.logUnit === "sec";
    const isTimed = !!(exercise.stages && exercise.stages.length);
    const setIndex = isTimed ? currentSetIndex(exercise) : selected;
    const stages = isTimed ? renderStages(exercise, sets, setIndex) : "";
    const setBtns = isTimed ? "" : sets.map((s, i) => {
      const cls = ["set-btn"];
      if (s.done) cls.push("done");
      if (selected === i) cls.push("selected");
      const reps = isSec ? s.reps + "s" : String(s.reps);
      const wt = isSec ? "time" : (s.weight ? s.weight + " lb" : "BW");
      return `<button class="${cls.join(" ")}" data-act="tap-set" data-ex="${exercise.id}" data-i="${i}">
        <span class="lbl">Set ${i + 1}</span>
        <span class="reps">${escapeHtml(reps)}</span>
        <span class="wt">${escapeHtml(wt)}</span>
      </button>`;
    }).join("");

    const showAdjust = selected != null && !isTimed;
    const cur = selected != null ? sets[selected] : null;
    const adjust = showAdjust && cur ? `
      <div class="adjust${cur && (exercise.isBodyweight && cur.weight === 0) ? "" : ""}">
        <div class="stepper-wrap">
          <div class="kind-lbl">${isSec ? "Seconds" : "Reps"}</div>
          <div class="stepper">
            <button data-act="step" data-ex="${exercise.id}" data-i="${selected}" data-field="reps" data-dir="-1" aria-label="Decrease reps">−</button>
            <div class="val">${cur.reps}</div>
            <button data-act="step" data-ex="${exercise.id}" data-i="${selected}" data-field="reps" data-dir="1" aria-label="Increase reps">+</button>
          </div>
        </div>
        <div class="stepper-wrap">
          <div class="kind-lbl">Weight</div>
          <div class="stepper">
            <button data-act="step" data-ex="${exercise.id}" data-i="${selected}" data-field="weight" data-dir="-1" aria-label="Decrease weight">−</button>
            <div class="val">${cur.weight ? cur.weight + " lb" : "BW"}</div>
            <button data-act="step" data-ex="${exercise.id}" data-i="${selected}" data-field="weight" data-dir="1" aria-label="Increase weight">+</button>
          </div>
        </div>
      </div>` : "";

    return `<article class="ex-card" data-ex="${exercise.id}">
      <div class="ex-head">
        <h3>${escapeHtml(exercise.name)}</h3>
      </div>
      <p class="ex-last">${escapeHtml(targetLine(exercise, defaultWeight))}${escapeHtml(lastLine)}</p>
      ${exercise.notes ? `<p class="ex-note">${escapeHtml(exercise.notes)}</p>` : ""}
      ${exercise.overload ? `<p class="overload">Weight up next time</p>` : ""}
      ${stages}
      <div class="sets">${setBtns}</div>
      ${adjust}
      <div class="ex-tools">
        <button class="linkish" data-act="open-history" data-ex="${exercise.id}">History</button>
        <button class="linkish" data-act="edit-exercise" data-ex="${exercise.id}">Edit</button>
      </div>
    </article>`;
  }

  function firstOpenIndex(sets) {
    const i = sets.findIndex((s) => !s.done);
    return i === -1 ? (sets.length ? sets.length - 1 : 0) : i;
  }

  function renderStages(exercise, sets, setIndex) {
    const totalSets = sets.length;
    const safeIndex = Math.max(0, Math.min(setIndex, totalSets - 1));
    const set = sets[safeIndex] || sets[0];
    const stagesDone = set ? normalizeStagesDone(exercise, set) : [];
    const pills = sets.map((s, i) => {
      const cls = ["set-pill"];
      if (i === safeIndex) cls.push("on");
      if (s.done) cls.push("done");
      return `<button class="${cls.join(" ")}" data-act="select-set" data-ex="${exercise.id}" data-i="${i}" aria-label="Set ${i + 1}${s.done ? " done" : ""}">${i + 1}</button>`;
    }).join("");
    const rows = exercise.stages.map((st, i) => {
      const cls = ["stage-btn"];
      if (stagesDone[i]) cls.push("done");
      const running = timer.running && timer.stage &&
        timer.stage.exerciseId === exercise.id &&
        timer.stage.setIndex === safeIndex &&
        timer.stage.stageIndex === i;
      if (running) cls.push("running");
      const setting = formatStageSetting(st.setting);
      const mark = stagesDone[i] ? "✓ " : "";
      const label = st.label || "Stage";
      return `<div class="${cls.join(" ")}" role="button" tabindex="0" data-act="tap-stage" data-ex="${exercise.id}" data-set="${safeIndex}" data-i="${i}">
        <span class="stage-main">
          <span class="stage-name">${mark}${escapeHtml(label)}</span>
          <span class="dur">${escapeHtml(st.duration || "")}</span>
        </span>
        <span class="speed-ctrl">
          <button type="button" class="speed-btn" data-act="stage-speed" data-ex="${exercise.id}" data-i="${i}" data-dir="-1" aria-label="Decrease ${escapeHtml(label)} speed">−</button>
          <span class="setting">${escapeHtml(setting)}</span>
          <button type="button" class="speed-btn" data-act="stage-speed" data-ex="${exercise.id}" data-i="${i}" data-dir="1" aria-label="Increase ${escapeHtml(label)} speed">+</button>
        </span>
      </div>`;
    }).join("");
    return `<div class="stages">
      <div class="stage-setbar">
        <div class="stage-set-label">Set ${safeIndex + 1} of ${totalSets}</div>
        <div class="set-pills">${pills}</div>
        <button class="linkish stage-reset" data-act="reset-stages" data-ex="${exercise.id}" data-set="${safeIndex}">Reset</button>
      </div>
      ${rows}
    </div>`;
  }

  /* ---------- sheets ---------- */

  function renderSheet() {
    const root = document.getElementById("sheet-root");
    if (!ui.sheet) {
      root.innerHTML = "";
      return;
    }
    const type = ui.sheet.type;
    let body = "";
    if (type === "timer") body = sheetTimer();
    else if (type === "history") body = sheetHistory();
    else if (type === "edit") body = sheetEdit();
    else if (type === "confirm") body = sheetConfirm();
    else if (type === "import-confirm") body = sheetImportConfirm();
    root.innerHTML = `<div class="backdrop" data-act="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true">${body}</div>`;
  }

  function sheetTimer() {
    const stage = timer.stage;
    const display = formatTime(timer.justFinished && !timer.running ? 0 : (timer.running || timer.remainingMs ? timer.remainingMs : currentPresetSeconds() * 1000));
    const cls = timer.justFinished && !timer.running ? "timer-display done" : "timer-display";
    const presets = stage ? "" : `<div class="presets">${PRESETS.map((p) =>
      `<button class="preset${timer.presetId === p.id ? " on" : ""}" data-act="timer-preset" data-id="${p.id}">${p.label}</button>`
    ).join("")}</div>`;
    const custom = !stage && timer.presetId === "custom" ? `
      <div class="custom-row">
        <div class="stepper-wrap">
          <div class="kind-lbl">Minutes</div>
          <div class="stepper">
            <button data-act="custom-step" data-field="min" data-dir="-1">−</button>
            <div class="val">${timer.customMin}</div>
            <button data-act="custom-step" data-field="min" data-dir="1">+</button>
          </div>
        </div>
        <div class="stepper-wrap">
          <div class="kind-lbl">Seconds</div>
          <div class="stepper">
            <button data-act="custom-step" data-field="sec" data-dir="-1">−</button>
            <div class="val">${String(timer.customSec).padStart(2, "0")}</div>
            <button data-act="custom-step" data-field="sec" data-dir="1">+</button>
          </div>
        </div>
      </div>` : "";
    const startLabel = timer.running ? "Pause" : (timer.remainingMs > 0 && !timer.justFinished ? "Resume" : "Start");
    const title = stage ? escapeHtml(stage.label) : "Timer";
    const sub = stage
      ? `<p class="timer-sub" id="timer-stage-sub">${stage.setting ? "@ " + escapeHtml(stage.setting) + " · " : ""}Set ${stage.setIndex + 1} of ${stage.totalSets}</p>`
      : "";
    let finishedNote = "";
    if (timer.justFinished && !timer.running && stage) {
      finishedNote = timer.nextOffer
        ? `<button class="btn primary next-stage-btn" data-act="start-next-stage">${escapeHtml(timer.nextOffer.buttonLabel)}</button>`
        : `<p class="timer-complete">All stages complete</p>`;
    }
    return `
      <div class="sheet-handle"></div>
      <h2>${title}</h2>
      ${sub}
      <div class="${cls}" id="timer-display">${display}</div>
      ${finishedNote}
      ${presets}
      ${custom}
      <div class="timer-controls">
        <button class="btn" data-act="timer-reset">Reset</button>
        <button class="btn primary" data-act="timer-toggle" style="grid-column: span 2">${startLabel}</button>
      </div>`;
  }

  function sheetHistory() {
    const found = findExercise(ui.sheet.exerciseId);
    if (!found) return `<div class="sheet-handle"></div><p class="empty">Missing exercise.</p>`;
    const exercise = found.exercise;
    const items = (exercise.history || []).map((h) => {
      const rows = h.sets.map((s, i) => {
        const right = (s.stages && s.stages.length)
          ? s.stages.map((st) => (st.label || "Stage") + (st.setting ? " @ " + st.setting : "")).join(" · ")
          : (exercise.stages
            ? "Completed"
            : `${s.reps} reps${s.weight ? " × " + s.weight + " lb" : " · BW"}`);
        return `<div class="hist-set"><span>Set ${i + 1}</span><span>${escapeHtml(right)}</span></div>`;
      }).join("");
      return `<div class="hist-item"><h3>${escapeHtml(formatLongDate(h.date))}</h3>${rows || "<div class='hist-set'>No sets</div>"}</div>`;
    }).join("");
    return `
      <div class="sheet-handle"></div>
      <h2>${escapeHtml(exercise.name)}</h2>
      ${items || '<p class="empty">No sessions yet. Log a set and save your workout.</p>'}
      <button class="btn ghost" data-act="close-sheet">Close</button>`;
  }

  function sheetEdit() {
    const isNew = ui.sheet.mode === "new";
    const draft = ui.sheet.draft;
    const groupOptions = data.groups.map((g) =>
      `<option value="${escapeHtml(g.id)}"${g.id === draft.groupId ? " selected" : ""}>${escapeHtml(g.name)}</option>`
    ).join("");
    const setRows = draft.sets.map((s, i) => `
      <div class="edit-set-row">
        <div class="idx">${i + 1}</div>
        <input type="number" inputmode="numeric" min="0" value="${s.targetReps}" data-act="draft-set" data-i="${i}" data-field="targetReps" aria-label="Reps">
        <input type="number" inputmode="decimal" min="0" step="5" value="${s.weight}" data-act="draft-set" data-i="${i}" data-field="weight" aria-label="Weight">
        <button class="icon-btn" data-act="draft-remove-set" data-i="${i}" aria-label="Remove set" ${draft.sets.length <= 1 ? "disabled" : ""}>${iconTrash()}</button>
      </div>`).join("");
    const stagesOn = !!draft.useStages;
    const stageRows = (draft.stages || []).map((st, i) => `
      <div class="stage-edit-row">
        <input placeholder="Label" value="${escapeHtml(st.label)}" data-act="draft-stage" data-i="${i}" data-field="label">
        <input placeholder="3 min" value="${escapeHtml(st.duration)}" data-act="draft-stage" data-i="${i}" data-field="duration">
        <input placeholder="Setting" value="${escapeHtml(st.setting)}" data-act="draft-stage" data-i="${i}" data-field="setting">
        <button class="icon-btn" data-act="draft-remove-stage" data-i="${i}" aria-label="Remove stage">${iconTrash()}</button>
      </div>`).join("");
    return `
      <div class="sheet-handle"></div>
      <h2>${isNew ? "Add exercise" : "Edit exercise"}</h2>
      <div class="field"><label>Name</label>
        <input id="draft-name" value="${escapeHtml(draft.name)}" data-act="draft-name">
      </div>
      <div class="field"><label>Group</label>
        <select id="draft-group" data-act="draft-group" style="width:100%;background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:14px 16px;min-height:52px">${groupOptions}</select>
      </div>
      <div class="field"><label>Equipment note</label>
        <input id="draft-equip" value="${escapeHtml(draft.equipmentNote)}" placeholder="e.g. blue lever adjusted" data-act="draft-equip">
      </div>
      <div class="field"><label>Notes</label>
        <input id="draft-notes" value="${escapeHtml(draft.notes)}" placeholder="Optional" data-act="draft-notes">
      </div>
      <label class="toggle"><span>Timed stages (like treadmill)</span>
        <input type="checkbox" data-act="draft-stages-toggle" ${stagesOn ? "checked" : ""}>
      </label>
      ${stagesOn ? `
        <div class="field"><label>Stages</label>
          ${stageRows || "<p class='empty' style='padding:8px'>No stages yet.</p>"}
          <p class="field-hint">Duration starts the timer, e.g. 3 min or 3:00. Setting is the speed.</p>
          <button class="btn small" data-act="draft-add-stage">+ Add stage</button>
        </div>
        <div class="field"><label>Number of sets</label>
          ${setRows}
          <button class="btn small" data-act="draft-add-set">+ Add set</button>
        </div>` : `
        <div class="field"><label>Sets (reps / weight lb)</label>
          ${setRows}
          <button class="btn small" data-act="draft-add-set">+ Add set</button>
        </div>`}
      <div class="row-actions" style="position:static;background:none;padding:8px 0 0">
        ${isNew ? "" : `<button class="btn danger" data-act="delete-exercise">Delete</button>`}
        <button class="btn primary" data-act="save-exercise">Save</button>
      </div>`;
  }

  function sheetConfirm() {
    return `
      <div class="sheet-handle"></div>
      <h2>${escapeHtml(ui.sheet.title || "Are you sure?")}</h2>
      <p class="confirm-text">${escapeHtml(ui.sheet.message || "")}</p>
      <div class="row-actions" style="position:static;background:none;padding:0">
        <button class="btn" data-act="close-sheet">Cancel</button>
        <button class="btn ${ui.sheet.danger ? "danger" : "primary"}" data-act="confirm-ok">${escapeHtml(ui.sheet.okLabel || "OK")}</button>
      </div>`;
  }

  function sheetImportConfirm() {
    return `
      <div class="sheet-handle"></div>
      <h2>Replace all data?</h2>
      <p class="confirm-text">Importing will replace your exercises, history, and any unsaved session on this device.</p>
      <div class="row-actions" style="position:static;background:none;padding:0">
        <button class="btn" data-act="close-sheet">Cancel</button>
        <button class="btn primary" data-act="import-ok">Import</button>
      </div>`;
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function currentPresetSeconds() {
    if (timer.stage && timer.stage.durationSec) return timer.stage.durationSec;
    if (timer.presetId === "custom") {
      return Math.max(1, (timer.customMin * 60) + timer.customSec);
    }
    const p = PRESETS.find((x) => x.id === timer.presetId);
    return p ? p.seconds : 60;
  }

  function updateTimerButtons() {
    const display = document.getElementById("timer-display");
    if (display) {
      const ms = timer.justFinished && !timer.running ? 0 : (timer.running || timer.remainingMs ? timer.remainingMs : currentPresetSeconds() * 1000);
      display.textContent = formatTime(ms);
      display.classList.toggle("done", !!(timer.justFinished && !timer.running));
    }
    document.querySelectorAll(".icon-btn.running, .icon-btn[data-act='open-timer']").forEach((btn) => {
      if (timer.running) {
        btn.classList.add("running");
        btn.textContent = formatTime(timer.remainingMs);
        btn.setAttribute("aria-label", "Open timer");
      }
    });
  }

  /* ---------- timer logic ---------- */

  function timerStart() {
    timer.justFinished = false;
    if (!timer.remainingMs) timer.remainingMs = currentPresetSeconds() * 1000;
    timer.endAt = Date.now() + timer.remainingMs;
    timer.running = true;
    startInterval();
    requestWakeLock();
    render();
  }

  function timerPause() {
    if (timer.running) {
      timer.remainingMs = Math.max(0, timer.endAt - Date.now());
      timer.running = false;
    }
    stopInterval();
    releaseWakeLock();
    render();
  }

  function timerReset() {
    timer.running = false;
    timer.remainingMs = currentPresetSeconds() * 1000;
    timer.justFinished = false;
    stopInterval();
    releaseWakeLock();
    render();
  }

  function timerToggle() {
    if (timer.running) timerPause();
    else timerStart();
  }

  function adjustStageSpeed(exerciseId, stageIndex, dir) {
    const found = findExercise(exerciseId);
    if (!found || !found.exercise.stages || !found.exercise.stages[stageIndex]) return;
    const stage = found.exercise.stages[stageIndex];
    const next = clampSpeed(stageSpeedNumber(stage.setting) + dir * SPEED_STEP);
    const text = formatSpeed(next);
    stage.setting = text;
    if (timer.stage && timer.stage.exerciseId === exerciseId && timer.stage.stageIndex === stageIndex) {
      timer.stage.setting = text;
    }
    persist();
    render();
  }

  function startStageTimer(exerciseId, setIndex, stageIndex) {
    const found = findExercise(exerciseId);
    if (!found || !found.exercise.stages) return;
    const stage = found.exercise.stages[stageIndex];
    if (!stage) return;
    const sec = stageSeconds(stage);
    if (!sec) {
      toast("Add a duration to this stage");
      return;
    }
    const sets = workingSets(found.exercise);
    hideToast();
    ui.selected = { exerciseId, setIndex };
    timer.stage = {
      exerciseId,
      setIndex,
      stageIndex,
      label: stage.label || "Stage",
      setting: stage.setting || "",
      durationSec: sec,
      totalSets: sets.length,
      stageCount: found.exercise.stages.length
    };
    timer.nextOffer = null;
    timer.justFinished = false;
    timer.remainingMs = sec * 1000;
    timer.presetId = "custom";
    timer.customMin = Math.floor(sec / 60);
    timer.customSec = sec % 60;
    ui.sheet = { type: "timer" };
    timerStart();
  }

  function completeStage(ctx) {
    const found = findExercise(ctx.exerciseId);
    if (!found) return;
    const sets = workingSets(found.exercise).map((s) => ({
      ...s,
      stagesDone: (s.stagesDone || []).slice()
    }));
    const set = sets[ctx.setIndex];
    if (!set) return;
    const n = found.exercise.stages.length;
    if (!set.stagesDone || set.stagesDone.length !== n) {
      set.stagesDone = normalizeStagesDone(found.exercise, set);
    }
    set.stagesDone[ctx.stageIndex] = true;
    set.done = set.stagesDone.length ? set.stagesDone.every(Boolean) : set.done;
    set.stageSpeeds = Array.isArray(set.stageSpeeds) ? set.stageSpeeds.slice() : [];
    set.stageSpeeds[ctx.stageIndex] = found.exercise.stages[ctx.stageIndex].setting || "";
    writeWorkingSets(found.exercise, sets);
  }

  function offerFor(exercise, setIndex, stageIndex, totalSets, fromSetIndex) {
    const stage = exercise.stages[stageIndex];
    const setting = stage.setting ? " @ " + stage.setting : "";
    const jumpedSet = fromSetIndex !== setIndex;
    const label = jumpedSet
      ? "Next: Set " + (setIndex + 1) + " · " + (stage.label || "Stage") + setting
      : "Next: " + (stage.label || "Stage") + setting;
    return {
      exerciseId: exercise.id,
      setIndex,
      stageIndex,
      buttonLabel: label
    };
  }

  function computeNextOffer(ctx) {
    const found = findExercise(ctx.exerciseId);
    if (!found) return null;
    const stages = found.exercise.stages || [];
    const sets = workingSets(found.exercise);
    const offerAt = (setIndex) => {
      const set = sets[setIndex];
      if (!set) return null;
      const done = normalizeStagesDone(found.exercise, set);
      if (done.length && done.every((flag) => !flag)) {
        return offerFor(found.exercise, setIndex, 0, sets.length, ctx.setIndex);
      }
      const i = done.findIndex((flag) => !flag);
      if (i === -1) return null;
      return offerFor(found.exercise, setIndex, i, sets.length, ctx.setIndex);
    };
    const same = sets[ctx.setIndex];
    if (same && ctx.stageIndex < stages.length - 1) {
      const done = normalizeStagesDone(found.exercise, same);
      for (let i = ctx.stageIndex + 1; i < stages.length; i++) {
        if (!done[i]) return offerFor(found.exercise, ctx.setIndex, i, sets.length, ctx.setIndex);
      }
    }
    for (let s = ctx.setIndex + 1; s < sets.length; s++) {
      const next = offerAt(s);
      if (next) return next;
    }
    return null;
  }

  function resetSetStages(exerciseId, setIndex) {
    const found = findExercise(exerciseId);
    if (!found) return;
    const sets = workingSets(found.exercise).map((s) => ({ ...s, stagesDone: (s.stagesDone || []).slice() }));
    if (!sets[setIndex]) return;
    sets[setIndex].stagesDone = (found.exercise.stages || []).map(() => false);
    sets[setIndex].stageSpeeds = [];
    sets[setIndex].done = false;
    writeWorkingSets(found.exercise, sets);
    if (timer.stage && timer.stage.exerciseId === exerciseId && timer.stage.setIndex === setIndex) {
      timer.running = false;
      timer.justFinished = false;
      timer.nextOffer = null;
      timer.remainingMs = currentPresetSeconds() * 1000;
      stopInterval();
      releaseWakeLock();
    }
  }

  function startInterval() {
    stopInterval();
    timer.interval = setInterval(tick, 200);
    tick();
  }

  function stopInterval() {
    if (timer.interval) clearInterval(timer.interval);
    timer.interval = 0;
  }

  function tick() {
    if (!timer.running) return;
    timer.remainingMs = Math.max(0, timer.endAt - Date.now());
    if (timer.remainingMs <= 0) {
      timer.running = false;
      timer.remainingMs = 0;
      timer.justFinished = true;
      stopInterval();
      releaseWakeLock();
      if (timer.stage) {
        completeStage(timer.stage);
        timer.nextOffer = computeNextOffer(timer.stage);
      }
      beep();
      vibrate([220, 80, 220, 80, 400]);
      render();
      return;
    }
    updateTimerButtons();
  }

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.9, now);
      master.connect(ctx.destination);
      const bursts = [0, 0.22, 0.44, 0.8, 1.02];
      bursts.forEach((offset, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = i % 2 === 0 ? 880 : 1320;
        g.gain.setValueAtTime(0.0001, now + offset);
        g.gain.exponentialRampToValueAtTime(0.85, now + offset + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
        osc.connect(g);
        g.connect(master);
        osc.start(now + offset);
        osc.stop(now + offset + 0.2);
      });
      setTimeout(() => ctx.close(), 2000);
    } catch (err) { /* ignore */ }
  }

  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (err) { /* ignore */ }
  }

  async function requestWakeLock() {
    try {
      if (navigator.wakeLock && navigator.wakeLock.request) {
        timer.wakeLock = await navigator.wakeLock.request("screen");
        timer.wakeLock.addEventListener("release", () => {});
      }
    } catch (err) { timer.wakeLock = null; }
  }

  function releaseWakeLock() {
    try { if (timer.wakeLock) timer.wakeLock.release(); } catch (err) { /* ignore */ }
    timer.wakeLock = null;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (timer.running) {
        tick();
        requestWakeLock();
      }
      if (track.status === "running") {
        requestRunWakeLock();
        updateRunLiveDom();
      }
    }
  });

  /* ---------- events ---------- */

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    if (!t) return;
    const act = t.dataset.act;
    if (act === "stage-speed") {
      e.stopPropagation();
      e.preventDefault();
    }
    handleAction(act, t, e);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.closest("[data-act='stage-speed']")) return;
    const t = e.target.closest("[data-act='tap-stage']");
    if (!t) return;
    e.preventDefault();
    handleAction("tap-stage", t, e);
  });

  document.addEventListener("input", (e) => {
    const t = e.target.closest("[data-act]");
    if (!t) return;
    const act = t.dataset.act;
    if (act === "draft-name") ui.sheet.draft.name = t.value;
    if (act === "draft-equip") ui.sheet.draft.equipmentNote = t.value;
    if (act === "draft-notes") ui.sheet.draft.notes = t.value;
    if (act === "draft-group") ui.sheet.draft.groupId = t.value;
    if (act === "draft-set") {
      const i = Number(t.dataset.i);
      const field = t.dataset.field;
      const val = Number(t.value);
      ui.sheet.draft.sets[i][field] = isFinite(val) ? val : 0;
    }
    if (act === "draft-stage") {
      const i = Number(t.dataset.i);
      ui.sheet.draft.stages[i][t.dataset.field] = t.value;
    }
  });

  document.addEventListener("change", (e) => {
    const t = e.target.closest("[data-act]");
    if (!t) return;
    if (t.dataset.act === "toggle-mobility") {
      const session = ensureSession();
      session.mobility = session.mobility || {};
      session.mobility[ui.groupId] = !!t.checked;
      persist();
      return;
    }
    if (t.dataset.act === "draft-stages-toggle") {
      ui.sheet.draft.useStages = t.checked;
      if (t.checked && (!ui.sheet.draft.stages || !ui.sheet.draft.stages.length)) {
        ui.sheet.draft.stages = [
          { label: "Walk", duration: "3 min", setting: "3.5" },
          { label: "Jog", duration: "4 min", setting: "7.1" },
          { label: "Sprint", duration: "1 min", setting: "10.5" }
        ];
      }
      render();
    }
    if (t.dataset.act === "draft-group") ui.sheet.draft.groupId = t.value;
    if (t.id === "import-file" && t.files && t.files[0]) {
      const file = t.files[0];
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (!parsed || !Array.isArray(parsed.groups)) throw new Error("Invalid file");
          ui.pendingImport = parsed;
          ui.sheet = { type: "import-confirm" };
          render();
        } catch (err) {
          toast("Could not read that file");
        }
        t.value = "";
      };
      reader.readAsText(file);
    }
  });

  function handleAction(act, t, e) {
    if (act === "open-group") {
      ui.view = "group";
      ui.groupId = t.dataset.id;
      ui.selected = null;
      location.hash = "#/g/" + ui.groupId;
      render();
      return;
    }
    if (act === "go-home") {
      ui.view = "home";
      ui.groupId = null;
      location.hash = "#/";
      render();
      return;
    }
    if (act === "open-timer") {
      hideToast();
      const pausedStage = !!(timer.stage && timer.remainingMs > 0 && !timer.justFinished &&
        timer.remainingMs < timer.stage.durationSec * 1000);
      if (!timer.running && !timer.justFinished && !pausedStage) {
        timer.stage = null;
        timer.nextOffer = null;
      }
      if (!timer.running && !timer.remainingMs) timer.remainingMs = currentPresetSeconds() * 1000;
      ui.sheet = { type: "timer" };
      render();
      return;
    }
    if (act === "close-sheet") {
      if (ui.sheet && ui.sheet.type === "import-confirm") ui.pendingImport = null;
      ui.sheet = null;
      render();
      return;
    }
    if (act === "tap-set") {
      const id = t.dataset.ex;
      const i = Number(t.dataset.i);
      const found = findExercise(id);
      if (!found) return;
      const sets = workingSets(found.exercise).map((s) => ({ ...s }));
      if (ui.selected && ui.selected.exerciseId === id && ui.selected.setIndex === i) {
        sets[i].done = !sets[i].done;
        if (sets[i].done) vibrate(20);
      } else if (!sets[i].done && ui.selected && ui.selected.exerciseId === id) {
        // first tap selects; if already selected path above handles toggle.
        // If selecting a different set, just select. If tapping an unselected set, select it.
        // Fast logging: if tapping a set that isn't selected, select AND mark done (gym speed).
        // Re-tap to undo. That's one-tap complete.
        sets[i].done = true;
        vibrate(20);
      } else if (!sets[i].done) {
        sets[i].done = true;
        vibrate(20);
      } else {
        // already done, not selected — select so they can adjust / uncheck
      }
      ui.selected = { exerciseId: id, setIndex: i };
      writeWorkingSets(found.exercise, sets);
      render();
      return;
    }
    if (act === "step") {
      const id = t.dataset.ex;
      const i = Number(t.dataset.i);
      const field = t.dataset.field;
      const dir = Number(t.dataset.dir);
      const found = findExercise(id);
      if (!found) return;
      const sets = workingSets(found.exercise).map((s) => ({ ...s }));
      if (field === "reps") sets[i].reps = Math.max(0, sets[i].reps + dir);
      if (field === "weight") {
        const step = found.exercise.weightStep || WEIGHT_STEP;
        sets[i].weight = Math.max(0, sets[i].weight + dir * step);
      }
      ui.selected = { exerciseId: id, setIndex: i };
      writeWorkingSets(found.exercise, sets);
      render();
      return;
    }
    if (act === "save-workout") {
      finalizeSession(false);
      ui.selected = null;
      render();
      return;
    }
    if (act === "clear-session") {
      ui.sheet = {
        type: "confirm",
        title: "Clear progress?",
        message: "Unsaved sets from today will be discarded. History already saved is kept.",
        okLabel: "Clear",
        danger: true,
        onOk: () => { clearSession(); ui.sheet = null; render(); }
      };
      render();
      return;
    }
    if (act === "confirm-ok") {
      const fn = ui.sheet && ui.sheet.onOk;
      if (fn) fn();
      return;
    }
    if (act === "open-history") {
      hideToast();
      ui.sheet = { type: "history", exerciseId: t.dataset.ex };
      render();
      return;
    }
    if (act === "edit-exercise") {
      openEditor(t.dataset.ex, t.dataset.group);
      return;
    }
    if (act === "add-exercise") {
      openEditor(null, t.dataset.group || ui.groupId);
      return;
    }
    if (act === "draft-add-set") {
      const last = ui.sheet.draft.sets[ui.sheet.draft.sets.length - 1] || { targetReps: 10, weight: 0 };
      ui.sheet.draft.sets.push({ targetReps: last.targetReps, weight: last.weight });
      render();
      return;
    }
    if (act === "draft-remove-set") {
      const i = Number(t.dataset.i);
      if (ui.sheet.draft.sets.length > 1) ui.sheet.draft.sets.splice(i, 1);
      render();
      return;
    }
    if (act === "draft-add-stage") {
      ui.sheet.draft.stages = ui.sheet.draft.stages || [];
      ui.sheet.draft.stages.push({ label: "", duration: "", setting: "" });
      render();
      return;
    }
    if (act === "draft-remove-stage") {
      ui.sheet.draft.stages.splice(Number(t.dataset.i), 1);
      render();
      return;
    }
    if (act === "save-exercise") {
      saveDraftExercise();
      return;
    }
    if (act === "delete-exercise") {
      const id = ui.sheet.draft.id;
      const name = ui.sheet.draft.name;
      ui.sheet = {
        type: "confirm",
        title: "Delete exercise?",
        message: `“${name}” and its history will be removed.`,
        okLabel: "Delete",
        danger: true,
        onOk: () => { deleteExercise(id); ui.sheet = null; toast("Exercise deleted"); render(); }
      };
      render();
      return;
    }
    if (act === "timer-preset") {
      timer.presetId = t.dataset.id;
      if (!timer.running) {
        timer.remainingMs = currentPresetSeconds() * 1000;
        timer.justFinished = false;
      }
      render();
      return;
    }
    if (act === "custom-step") {
      const field = t.dataset.field;
      const dir = Number(t.dataset.dir);
      if (field === "min") timer.customMin = Math.max(0, Math.min(99, timer.customMin + dir));
      if (field === "sec") {
        let s = timer.customSec + dir * 5;
        if (s >= 60) { timer.customMin = Math.min(99, timer.customMin + 1); s = 0; }
        if (s < 0) {
          if (timer.customMin > 0) { timer.customMin -= 1; s = 55; }
          else s = 0;
        }
        timer.customSec = s;
      }
      if (timer.customMin === 0 && timer.customSec === 0) timer.customSec = 5;
      if (!timer.running) {
        timer.remainingMs = currentPresetSeconds() * 1000;
        timer.justFinished = false;
      }
      render();
      return;
    }
    if (act === "stage-speed") {
      adjustStageSpeed(t.dataset.ex, Number(t.dataset.i), Number(t.dataset.dir));
      return;
    }
    if (act === "tap-stage") {
      startStageTimer(t.dataset.ex, Number(t.dataset.set), Number(t.dataset.i));
      return;
    }
    if (act === "select-set") {
      const exerciseId = t.dataset.ex;
      const setIndex = Number(t.dataset.i);
      ui.selected = { exerciseId, setIndex };
      const found = findExercise(exerciseId);
      if (found && found.exercise.stages && found.exercise.stages.length) {
        const sets = workingSets(found.exercise);
        const set = sets[setIndex];
        const done = set ? normalizeStagesDone(found.exercise, set) : [];
        const open = done.findIndex((flag) => !flag);
        const switching = !timer.stage || timer.stage.setIndex !== setIndex || timer.stage.exerciseId !== exerciseId;
        if (switching && timer.stage) {
          timer.running = false;
          timer.justFinished = false;
          timer.stage = null;
          timer.nextOffer = null;
          stopInterval();
          releaseWakeLock();
        }
        if (switching && open !== -1) {
          const stageIndex = done.every((flag) => !flag) ? 0 : open;
          startStageTimer(exerciseId, setIndex, stageIndex);
          return;
        }
      }
      render();
      return;
    }
    if (act === "reset-stages") {
      resetSetStages(t.dataset.ex, Number(t.dataset.set));
      ui.selected = { exerciseId: t.dataset.ex, setIndex: Number(t.dataset.set) };
      toast("Set reset");
      render();
      return;
    }
    if (act === "start-next-stage") {
      const offer = timer.nextOffer;
      if (offer) startStageTimer(offer.exerciseId, offer.setIndex, offer.stageIndex);
      return;
    }
    if (act === "timer-toggle") { timerToggle(); return; }
    if (act === "timer-reset") { timerReset(); return; }
    if (act === "export") { exportData(); return; }
    if (act === "import") {
      const input = document.getElementById("import-file");
      if (input) input.click();
      return;
    }
    if (act === "import-ok") {
      if (ui.pendingImport) {
        data = normalizeImported(ui.pendingImport);
        ui.pendingImport = null;
        persist();
        ui.sheet = null;
        ui.view = "home";
        ui.selected = null;
        toast("Imported");
        render();
      }
      return;
    }
    if (act === "dismiss-tip") {
      data.installTipDismissed = true;
      persist();
      render();
      return;
    }
    if (act === "open-run") {
      ui.view = "run";
      ui.runId = null;
      ui.forceRunRender = true;
      location.hash = "#/run";
      render();
      return;
    }
    if (act === "open-run-detail") {
      const rec = findRun(t.dataset.id);
      if (!rec) return;
      ui.view = "run-detail";
      ui.runId = rec.id;
      location.hash = "#/run/" + rec.id;
      render();
      return;
    }
    if (act === "start-run") { startRun(); return; }
    if (act === "pause-run") { pauseRun(); return; }
    if (act === "resume-run") { resumeRun(); return; }
    if (act === "finish-run") { finishRun(); return; }
    if (act === "reload-app") {
      location.reload();
      return;
    }
  }

  function openEditor(exerciseId, groupId) {
    if (exerciseId) {
      const found = findExercise(exerciseId);
      if (!found) return;
      const exer = found.exercise;
      ui.sheet = {
        type: "edit",
        mode: "edit",
        draft: {
          id: exer.id,
          name: exer.name,
          groupId: found.group.id,
          equipmentNote: exer.equipmentNote || "",
          notes: exer.notes || "",
          useStages: !!(exer.stages && exer.stages.length),
          stages: (exer.stages || []).map((s) => ({ ...s })),
          sets: exer.sets.map((s) => ({ targetReps: s.targetReps, weight: s.weight })),
          history: exer.history || []
        }
      };
    } else {
      ui.sheet = {
        type: "edit",
        mode: "new",
        draft: {
          id: uid(),
          name: "",
          groupId: groupId || "arms",
          equipmentNote: "",
          notes: "",
          useStages: false,
          stages: [],
          sets: [{ targetReps: 10, weight: 0 }],
          history: []
        }
      };
    }
    render();
  }

  function saveDraftExercise() {
    const draft = ui.sheet.draft;
    const name = (draft.name || "").trim();
    if (!name) { toast("Name is required"); return; }
    const sets = (draft.sets || []).map((s) => ({
      targetReps: Math.max(0, Number(s.targetReps) || 0),
      weight: Math.max(0, Number(s.weight) || 0)
    }));
    if (!sets.length) { toast("Add at least one set"); return; }
    const payload = {
      id: draft.id,
      name,
      equipmentNote: (draft.equipmentNote || "").trim(),
      notes: (draft.notes || "").trim(),
      isBodyweight: sets.every((s) => !s.weight),
      sets,
      stages: draft.useStages ? (draft.stages || []).filter((s) => s.label || s.duration || s.setting) : null,
      history: draft.history || []
    };
    // move / update
    for (const group of data.groups) {
      group.exercises = group.exercises.filter((e) => e.id !== payload.id);
    }
    const target = findGroup(draft.groupId) || data.groups[0];
    target.exercises.push(payload);
    if (data.activeSession && data.activeSession.exercises[payload.id]) {
      const prev = data.activeSession.exercises[payload.id].sets || [];
      data.activeSession.exercises[payload.id].sets = payload.sets.map((s, i) => ({
        reps: prev[i] ? prev[i].reps : s.targetReps,
        weight: prev[i] ? prev[i].weight : s.weight,
        done: prev[i] ? prev[i].done : false,
        stagesDone: prev[i] && prev[i].stagesDone ? prev[i].stagesDone.slice() : undefined
      }));
    }
    persist();
    const added = ui.sheet.mode === "new";
    ui.sheet = null;
    toast(added ? "Exercise added" : "Exercise saved");
    render();
  }

  function deleteExercise(id) {
    for (const group of data.groups) {
      group.exercises = group.exercises.filter((e) => e.id !== id);
    }
    if (data.activeSession && data.activeSession.exercises[id]) {
      delete data.activeSession.exercises[id];
    }
    persist();
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = "workout-backup-" + todayISO() + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
    toast("Exported");
  }

  function normalizeImported(parsed) {
    return migrate({
      version: 1,
      groups: parsed.groups,
      activeSession: parsed.activeSession || null,
      installTipDismissed: !!parsed.installTipDismissed,
      runs: Array.isArray(parsed.runs) ? parsed.runs : []
    }).data;
  }

  /* ---------- outdoor run ---------- */

  function findRun(id) {
    return (data.runs || []).find((r) => r.id === id) || null;
  }

  function currentElapsed() {
    if (track.status === "running") {
      return track.elapsedBefore + Math.max(0, Date.now() - track.segmentStart);
    }
    return track.elapsedBefore;
  }

  function currentRunStats() {
    const math = globalThis.RunMath;
    return math.computeStats(track.points, currentElapsed());
  }

  function runSummaryLine() {
    const math = globalThis.RunMath;
    const stats = currentRunStats();
    return math.formatElapsed(currentElapsed()) + " · " + math.formatMiles(stats.miles);
  }

  function renderRunCard() {
    const n = (data.runs || []).length;
    const live = track.status !== "idle";
    const sub = live
      ? (track.status === "paused" ? "Paused · " : "Live · ") + runSummaryLine()
      : (n ? (n + " saved run" + (n === 1 ? "" : "s")) : "Track a walk or run outside");
    return `<button class="group-card run" data-act="open-run">
      <div class="group-mark">R</div>
      <div class="group-meta">
        <h2>Outdoor Run</h2>
        <p>${escapeHtml(sub)}</p>
      </div>
      <div class="chev">›</div>
    </button>`;
  }

  function renderRun() {
    const math = globalThis.RunMath;
    const live = track.status !== "idle";
    const stats = currentRunStats();
    const elapsed = math.formatElapsed(currentElapsed());
    const statusLbl = track.status === "paused" ? "Paused" : (track.status === "running" ? "Recording" : "Ready");
    const gps = track.gpsError
      ? `<div class="run-gps err" id="run-gps">${escapeHtml(track.gpsError)}</div>`
      : `<div class="run-gps" id="run-gps">${track.waitingGps && live ? "Waiting for GPS…" : (live ? statusLbl : "")}</div>`;
    const controls = !live
      ? `<div class="row-actions" style="position:static;background:none;padding:0;border:0">
           <button class="btn primary" data-act="start-run">Start run</button>
         </div>`
      : `<div class="row-actions" style="position:static;background:none;padding:0;border:0">
           ${track.status === "paused"
             ? `<button class="btn primary" data-act="resume-run">Resume</button>`
             : `<button class="btn" data-act="pause-run">Pause</button>`}
           <button class="btn danger" data-act="finish-run">Finish</button>
         </div>`;
    const runs = (data.runs || []);
    const history = (!live && runs.length)
      ? `<h2 style="margin:22px 0 10px;font-size:16px;letter-spacing:-0.02em">Past runs</h2>
         <div class="run-list">${runs.map(runListItem).join("")}</div>`
      : (!live ? `<p class="empty">No saved runs yet.</p>` : "");
    return `
      <header class="topbar">
        <button class="icon-btn" data-act="go-home" aria-label="Back">${iconBack()}</button>
        <h1>Outdoor Run</h1>
        ${timerButtonHtml()}
      </header>
      <div class="page run-page"${live ? " id='run-live'" : ""}>
        <div class="run-note"><strong>Keep the screen on</strong> while tracking. GPS only works with the screen awake — this app does not track in the background.</div>
        <div id="run-map" class="run-map" role="img" aria-label="Run route map"></div>
        <div class="run-stats">
          <div class="run-stat wide"><div class="lbl">Time</div><div class="val" id="run-elapsed">${elapsed}</div></div>
          <div class="run-stat"><div class="lbl">Distance</div><div class="val" id="run-distance">${math.formatMiles(stats.miles)}</div></div>
          <div class="run-stat"><div class="lbl">Current pace</div><div class="val" id="run-pace">${math.formatPace(stats.currentPaceSecPerMile)}</div></div>
          <div class="run-stat"><div class="lbl">Avg pace</div><div class="val" id="run-avg-pace">${math.formatPace(stats.avgPaceSecPerMile)}</div></div>
          <div class="run-stat"><div class="lbl">Avg speed</div><div class="val" id="run-avg-speed">${math.formatMph(stats.avgSpeedMph)}</div></div>
        </div>
        ${gps}
        ${controls}
        ${history}
      </div>`;
  }

  function runListItem(rec) {
    const math = globalThis.RunMath;
    return `<button class="run-item" data-act="open-run-detail" data-id="${escapeHtml(rec.id)}">
      <div>
        <h3>${escapeHtml(formatLongDate(rec.date))}</h3>
        <p>${math.formatMiles(rec.distanceMiles)} · ${math.formatElapsed(rec.durationMs)} · ${math.formatMph(rec.avgSpeedMph)} · ${math.formatPace(rec.avgPaceSecPerMile)}</p>
      </div>
      <div class="chev">›</div>
    </button>`;
  }

  function renderRunDetail() {
    const rec = findRun(ui.runId);
    if (!rec) {
      return `<header class="topbar">
        <button class="icon-btn" data-act="open-run" aria-label="Back">${iconBack()}</button>
        <h1>Run</h1>${timerButtonHtml()}
      </header><div class="page"><p class="empty">That run was not found.</p></div>`;
    }
    const math = globalThis.RunMath;
    return `
      <header class="topbar">
        <button class="icon-btn" data-act="open-run" aria-label="Back">${iconBack()}</button>
        <h1>${escapeHtml(formatLongDate(rec.date))}</h1>
        ${timerButtonHtml()}
      </header>
      <div class="page run-page" id="run-detail" data-run="${escapeHtml(rec.id)}">
        <div id="run-detail-map" class="run-detail-map" role="img" aria-label="Saved run route"></div>
        <div class="run-stats">
          <div class="run-stat wide"><div class="lbl">Time</div><div class="val">${math.formatElapsed(rec.durationMs)}</div></div>
          <div class="run-stat"><div class="lbl">Distance</div><div class="val">${math.formatMiles(rec.distanceMiles)}</div></div>
          <div class="run-stat"><div class="lbl">Avg speed</div><div class="val">${math.formatMph(rec.avgSpeedMph)}</div></div>
          <div class="run-stat wide"><div class="lbl">Average pace</div><div class="val">${math.formatPace(rec.avgPaceSecPerMile)}</div></div>
        </div>
      </div>`;
  }

  function updateRunLiveDom() {
    const math = globalThis.RunMath;
    const stats = currentRunStats();
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set("run-elapsed", math.formatElapsed(currentElapsed()));
    set("run-distance", math.formatMiles(stats.miles));
    set("run-pace", math.formatPace(stats.currentPaceSecPerMile));
    set("run-avg-pace", math.formatPace(stats.avgPaceSecPerMile));
    set("run-avg-speed", math.formatMph(stats.avgSpeedMph));
    const gps = document.getElementById("run-gps");
    if (gps) {
      gps.classList.toggle("err", !!track.gpsError);
      gps.textContent = track.gpsError
        ? track.gpsError
        : (track.waitingGps ? "Waiting for GPS…" : (track.status === "paused" ? "Paused" : "Recording"));
    }
    refreshLiveLine();
  }

  function startRunTick() {
    stopRunTick();
    track.tick = setInterval(() => {
      if (track.status === "running") updateRunLiveDom();
    }, 250);
  }

  function stopRunTick() {
    if (track.tick) clearInterval(track.tick);
    track.tick = 0;
  }

  function startRun() {
    if (!navigator.geolocation) {
      toast("GPS is not available on this device");
      return;
    }
    track.status = "running";
    track.points = [];
    track.elapsedBefore = 0;
    track.segmentStart = Date.now();
    track.gpsError = "";
    track.waitingGps = true;
    startWatch();
    requestRunWakeLock();
    startRunTick();
    ui.forceRunRender = true;
    ui.view = "run";
    if (location.hash !== "#/run") location.hash = "#/run";
    else render();
  }

  function pauseRun() {
    if (track.status !== "running") return;
    track.elapsedBefore = currentElapsed();
    track.status = "paused";
    stopWatch();
    stopRunTick();
    releaseRunWakeLock();
    ui.forceRunRender = true;
    render();
  }

  function resumeRun() {
    if (track.status !== "paused") return;
    track.status = "running";
    track.segmentStart = Date.now();
    track.gpsError = "";
    track.waitingGps = true;
    startWatch();
    requestRunWakeLock();
    startRunTick();
    ui.forceRunRender = true;
    render();
  }

  function finishRun() {
    const stats = currentRunStats();
    const elapsedMs = currentElapsed();
    const tooShort = elapsedMs < 10000 && stats.miles < 0.02;
    ui.sheet = {
      type: "confirm",
      title: tooShort ? "Discard this run?" : "Finish run?",
      message: tooShort
        ? "This run is too short to save and will be discarded."
        : `${globalThis.RunMath.formatMiles(stats.miles)} in ${globalThis.RunMath.formatElapsed(elapsedMs)} will be saved to history.`,
      okLabel: tooShort ? "Discard" : "Save run",
      danger: tooShort,
      onOk: () => { commitFinishRun(!tooShort); }
    };
    render();
  }

  function commitFinishRun(save) {
    if (track.status === "running") {
      track.elapsedBefore = currentElapsed();
    }
    stopWatch();
    stopRunTick();
    releaseRunWakeLock();
    const elapsedMs = track.elapsedBefore;
    const stats = globalThis.RunMath.computeStats(track.points, elapsedMs);
    let saved = null;
    if (save && (elapsedMs >= 10000 || stats.miles >= 0.02)) {
      saved = {
        id: uid(),
        date: todayISO(),
        startedAt: track.points[0] ? track.points[0].t : Date.now() - elapsedMs,
        finishedAt: Date.now(),
        durationMs: elapsedMs,
        distanceMiles: stats.miles,
        avgSpeedMph: stats.avgSpeedMph,
        avgPaceSecPerMile: stats.avgPaceSecPerMile,
        path: track.points.map((pt) => ({ lat: pt.lat, lng: pt.lng, t: pt.t }))
      };
      data.runs = data.runs || [];
      data.runs.unshift(saved);
      persist();
    }
    track.status = "idle";
    track.points = [];
    track.elapsedBefore = 0;
    track.gpsError = "";
    track.waitingGps = false;
    ui.sheet = null;
    ui.forceRunRender = true;
    if (saved) {
      ui.view = "run-detail";
      ui.runId = saved.id;
      location.hash = "#/run/" + saved.id;
      toast("Run saved");
    } else {
      ui.view = "run";
      ui.runId = null;
      location.hash = "#/run";
      toast("Run discarded");
    }
    render();
  }

  function startWatch() {
    stopWatch();
    track.watchId = navigator.geolocation.watchPosition(onGeo, onGeoError, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 15000
    });
  }

  function stopWatch() {
    if (track.watchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(track.watchId);
    }
    track.watchId = null;
  }

  function onGeo(pos) {
    if (track.status !== "running") return;
    const coords = pos.coords || {};
    const point = {
      lat: coords.latitude,
      lng: coords.longitude,
      t: pos.timestamp || Date.now(),
      accuracy: coords.accuracy
    };
    const prev = track.points[track.points.length - 1] || null;
    const result = globalThis.RunMath.filterPoint(prev, point);
    if (!result.accept) {
      if (result.reason === "accuracy") {
        track.gpsError = "GPS accuracy is low — move to open sky.";
      } else if (track.gpsError && result.reason !== "accuracy") {
        track.gpsError = "";
      }
      return;
    }
    track.gpsError = "";
    track.waitingGps = false;
    track.points.push({ lat: point.lat, lng: point.lng, t: point.t });
    updateRunLiveDom();
  }

  function onGeoError(err) {
    if (track.status !== "running") return;
    const code = err && err.code;
    if (code === 1) track.gpsError = "Location permission denied.";
    else if (code === 2) track.gpsError = "Location unavailable. Try open sky.";
    else if (code === 3) track.gpsError = "GPS timed out. Still trying…";
    else track.gpsError = "Could not get a GPS fix.";
    updateRunLiveDom();
  }

  async function requestRunWakeLock() {
    try {
      if (navigator.wakeLock && navigator.wakeLock.request) {
        track.wakeLock = await navigator.wakeLock.request("screen");
      }
    } catch (err) { track.wakeLock = null; }
  }

  function releaseRunWakeLock() {
    try { if (track.wakeLock) track.wakeLock.release(); } catch (err) { /* ignore */ }
    track.wakeLock = null;
  }

  function latLngs(points) {
    return (points || []).map((pt) => [pt.lat, pt.lng]);
  }

  function ensureLeafletIcons() {
    if (typeof L === "undefined" || !L.Icon || !L.Icon.Default) return;
    L.Icon.Default.mergeOptions({
      iconUrl: "vendor/leaflet/images/marker-icon.png",
      iconRetinaUrl: "vendor/leaflet/images/marker-icon-2x.png",
      shadowUrl: "vendor/leaflet/images/marker-shadow.png"
    });
  }

  function destroyRunMap() {
    if (track.map) {
      try { track.map.remove(); } catch (err) { /* ignore */ }
    }
    track.map = null;
    track.line = null;
    track.startMarker = null;
    track.endMarker = null;
  }

  function addOsmLayer(map) {
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19
    }).addTo(map);
  }

  function mountLiveMap() {
    const el = document.getElementById("run-map");
    if (!el || typeof L === "undefined") return;
    ensureLeafletIcons();
    if (track.map) {
      const container = track.map.getContainer && track.map.getContainer();
      if (container === el) {
        track.map.invalidateSize();
        refreshLiveLine();
        return;
      }
      destroyRunMap();
    }
    track.map = L.map(el, { zoomControl: true, attributionControl: true });
    addOsmLayer(track.map);
    if (track.points.length) {
      track.map.setView([track.points[track.points.length - 1].lat, track.points[track.points.length - 1].lng], 16);
    } else {
      track.map.setView([20, 0], 2);
    }
    track.line = L.polyline(latLngs(track.points), { color: "#C8F542", weight: 4, opacity: 0.95 }).addTo(track.map);
    refreshLiveLine();
    setTimeout(() => { if (track.map) track.map.invalidateSize(); }, 80);
  }

  function routeDot(latlng, kind) {
    const start = kind === "start";
    return L.circleMarker(latlng, {
      radius: start ? 8 : 7,
      color: start ? "#F4F6F8" : "#C8F542",
      weight: 2,
      fillColor: "#C8F542",
      fillOpacity: 1
    });
  }

  function refreshLiveLine() {
    if (!track.map || !track.line) return;
    const pts = latLngs(track.points);
    track.line.setLatLngs(pts);
    if (!pts.length) return;
    if (!track.startMarker) track.startMarker = routeDot(pts[0], "start").addTo(track.map);
    else track.startMarker.setLatLng(pts[0]);
    if (pts.length === 1) {
      track.map.setView(pts[0], 16);
    } else {
      if (!track.endMarker) track.endMarker = routeDot(pts[pts.length - 1], "end").addTo(track.map);
      else track.endMarker.setLatLng(pts[pts.length - 1]);
      track.map.panTo(pts[pts.length - 1], { animate: false });
    }
  }

  function mountDetailMap() {
    const el = document.getElementById("run-detail-map");
    if (!el || typeof L === "undefined") return;
    ensureLeafletIcons();
    const rec = findRun(ui.runId);
    const map = L.map(el, { zoomControl: true, attributionControl: true });
    addOsmLayer(map);
    const pts = rec ? latLngs(rec.path || []) : [];
    if (pts.length > 1) {
      const line = L.polyline(pts, { color: "#C8F542", weight: 4 }).addTo(map);
      routeDot(pts[0], "start").addTo(map);
      routeDot(pts[pts.length - 1], "end").addTo(map);
      map.fitBounds(line.getBounds(), { padding: [24, 24] });
    } else if (pts.length === 1) {
      routeDot(pts[0], "start").addTo(map);
      map.setView(pts[0], 16);
    } else {
      map.setView([20, 0], 2);
    }
    setTimeout(() => map.invalidateSize(), 80);
    // store so destroyRunMap can clean if we reuse track.map? use a separate handle
    if (track.map) destroyRunMap();
    track.map = map;
  }



  function iconTimer() {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M9 2h6"/><path d="M12 2v3"/></svg>`;
  }
  function iconBack() {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>`;
  }
  function iconTrash() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>`;
  }

  /* ---------- routing / pwa ---------- */

  function applyHash() {
    const hash = (location.hash || "#/").replace(/^#/, "");
    const parts = hash.split("/").filter(Boolean);
    if (parts[0] === "g" && parts[1] && findGroup(parts[1])) {
      ui.view = "group";
      ui.groupId = parts[1];
      ui.runId = null;
    } else if (parts[0] === "run" && parts[1]) {
      const rec = findRun(parts[1]);
      if (rec) {
        ui.view = "run-detail";
        ui.runId = rec.id;
      } else {
        ui.view = "run";
        ui.runId = null;
      }
    } else if (parts[0] === "run") {
      ui.view = "run";
      ui.runId = null;
    } else {
      ui.view = "home";
      ui.groupId = null;
      ui.runId = null;
    }
    render();
  }

  window.addEventListener("hashchange", applyHash);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").then((reg) => {
        const hadController = !!navigator.serviceWorker.controller;
        const maybePrompt = () => {
          if (hadController) showUpdateBanner();
        };
        if (reg.waiting && hadController) showUpdateBanner();
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            if (sw.state === "installed" && hadController) showUpdateBanner();
          });
        });
        navigator.serviceWorker.addEventListener("controllerchange", maybePrompt);
        reg.update().catch(() => {});
      }).catch(() => {});
    });
  }

  function showUpdateBanner() {
    const el = document.getElementById("sw-update");
    if (el) el.hidden = false;
  }

  rolloverSessionIfNeeded();
  applyHash();
})();
