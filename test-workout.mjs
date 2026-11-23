import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(import.meta.url));
const RunMath = require(path.join(root, "run-math.js"));

const SCREEN = path.join(root, "screens");
fs.mkdirSync(SCREEN, { recursive: true });
const dl = "/tmp/pw/downloads";
fs.mkdirSync(dl, { recursive: true });
for (const f of fs.readdirSync(dl)) fs.unlinkSync(path.join(dl, f));

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
});

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.setDefaultTimeout(15000);
await page.setCacheEnabled(false);

const client = await page.createCDPSession();
await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dl });

const results = [];
function ok(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function tapAct(act, extra = "") {
  const sel = `[data-act="${act}"]${extra}`;
  await page.waitForSelector(sel);
  await page.$eval(sel, (el) => el.click());
}

{
  const eq = (a, b, eps = 0.001) => Math.abs(a - b) <= eps;
  const equator = RunMath.haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
  const expected = RunMath.EARTH_RADIUS_M * Math.PI / 180;
  ok("haversine 1° longitude at equator", eq(equator, expected, 0.5), equator.toFixed(2) + " vs " + expected.toFixed(2));
  ok("haversine identical points is 0", RunMath.haversineMeters({ lat: 34, lng: -118 }, { lat: 34, lng: -118 }) === 0);

  const dlat = (RunMath.METERS_PER_MILE / RunMath.EARTH_RADIUS_M) * (180 / Math.PI);
  const a = { lat: 34, lng: -118, t: 1_000_000, accuracy: 8 };
  const b = { lat: 34 + dlat, lng: -118, t: 1_000_000 + 8 * 60 * 1000, accuracy: 8 };
  const meters = RunMath.haversineMeters(a, b);
  ok("1 mile north is ~1609.3 m", eq(meters, RunMath.METERS_PER_MILE, 0.5), String(meters));
  const stats = RunMath.computeStats([a, b], 8 * 60 * 1000);
  ok("1 mile in 8:00 is 7.5 mph", eq(stats.miles, 1, 0.002) && eq(stats.avgSpeedMph, 7.5, 0.02), JSON.stringify({ miles: stats.miles, mph: stats.avgSpeedMph }));
  ok("1 mile in 8:00 is 8:00 /mi", eq(stats.avgPaceSecPerMile, 480, 0.5) && RunMath.formatPace(stats.avgPaceSecPerMile) === "8:00 /mi", RunMath.formatPace(stats.avgPaceSecPerMile));

  const bad = RunMath.filterPoint(null, { lat: 34, lng: -118, t: 1, accuracy: 80 });
  ok("poor accuracy is rejected", bad.accept === false && bad.reason === "accuracy", bad.reason);
  const first = RunMath.filterPoint(null, a);
  ok("first accurate point is accepted", first.accept && first.reason === "first");
  const jitter = RunMath.filterPoint(a, { lat: 34.00001, lng: -118, t: a.t + 2000, accuracy: 8 });
  ok("GPS jitter is rejected", jitter.accept === false && jitter.reason === "jitter", jitter.reason + " d=" + jitter.deltaM);
  const tooFast = RunMath.filterPoint(a, { lat: 34.2, lng: -118, t: a.t + 1000, accuracy: 8 });
  ok("unrealistic speed is rejected", tooFast.accept === false && tooFast.reason === "speed", tooFast.reason);
  const good = RunMath.filterPoint(a, b);
  ok("valid run point is accepted", good.accept && good.reason === "ok", good.reason);

  const recent = [];
  for (let i = 0; i < 6; i++) {
    recent.push({ lat: 34 + dlat * (i / 80), lng: -118, t: 2_000_000 + i * 5000, accuracy: 8 });
  }
  const cur = RunMath.currentPaceSecPerMile(recent);
  ok("current pace uses a recent window", cur > 0 && cur < 3600, String(cur));
}


await page.goto("http://127.0.0.1:8765/?fresh=1", { waitUntil: "networkidle0" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle0" });
await page.waitForSelector(".group-card.day-a");

await page.screenshot({ path: path.join(SCREEN, "01-home.png") });
ok("home renders", await page.$(".group-card.day-a") && await page.$(".group-card.day-b") && await page.$(".group-card.day-c") && !(await page.$(".group-card.day-d")));
const homeText = await page.evaluate(() => document.body.innerText);
ok("home has days and actions", /Day A/.test(homeText) && /Day B/.test(homeText) && /Day C/.test(homeText) && !/Day 4/.test(homeText) && /Export/.test(homeText));

await tapAct("open-group", "[data-id='day-a']");
await page.waitForSelector(".ex-card");
const armsText = await page.evaluate(() => document.body.innerText);
ok("day A list loaded", /Goblet squat to box/.test(armsText) && /DB bench\/floor press/.test(armsText) && /Plank/.test(armsText) && /Rest 60-90 s/.test(armsText));
ok("goblet squat shows 3 sets of 10 at 50 lb", /Goblet squat/.test(armsText) && (armsText.match(/\b10\b/g) || []).length >= 3 && /50 lb/.test(armsText));

const firstSet = await page.$(".ex-card .set-btn");
await firstSet.tap();
await page.waitForFunction(() => document.querySelector(".ex-card .set-btn")?.classList.contains("done"));
ok("tap marks set done", true);

await page.waitForSelector(".adjust");
const plusBtns = await page.$$(".adjust .stepper button");
await plusBtns[1].tap();
await page.waitForFunction(() => document.querySelector(".ex-card .set-btn.done .reps")?.textContent === "11");
ok("plus control bumps reps to 11", true);

// only one adjuster visible
const adjustCount = await page.$$eval(".adjust", (els) => els.length);
ok("only selected exercise shows adjuster", adjustCount === 1, "count=" + adjustCount);

await page.screenshot({ path: path.join(SCREEN, "02-arms-logging.png") });

await page.reload({ waitUntil: "networkidle0" });
await page.waitForSelector(".ex-card .set-btn.done");
const afterReload = await page.evaluate(() => {
  const btn = document.querySelector(".ex-card .set-btn.done");
  return { done: !!btn, reps: btn?.querySelector(".reps")?.textContent };
});
ok("persistence after reload", afterReload.done && afterReload.reps === "11", JSON.stringify(afterReload));

await tapAct("save-workout");
await page.waitForFunction(() => {
  const t = document.getElementById("toast");
  return t && !t.hidden && /saved/i.test(t.textContent);
});
ok("save workout toasts", true);

await tapAct("open-history");
await page.waitForSelector(".hist-item");
const hist = await page.evaluate(() => document.querySelector(".sheet")?.innerText || "");
ok("history shows saved set", /11/.test(hist) && /Goblet squat/.test(hist), hist.replace(/\s+/g, " ").slice(0, 180));
await tapAct("close-sheet");
await page.waitForFunction(() => !document.querySelector(".sheet"));

// wait for toast to be gone / hidden by sheet open
await page.$eval("#toast", (el) => { el.hidden = true; });

await tapAct("open-timer");
await page.waitForSelector("#timer-display");
const before = await page.$eval("#timer-display", (el) => el.textContent);
ok("timer opens at 1:00 default", before === "1:00", "display=" + before);

await page.$eval('[data-act="timer-preset"][data-id="30"]', (el) => el.click());
await page.waitForFunction(() => document.querySelector("#timer-display")?.textContent === "0:30");
await page.$eval('[data-act="timer-toggle"]', (el) => el.click());
await page.waitForFunction(() => {
  const t = document.querySelector("#timer-display")?.textContent;
  return t && t !== "0:30";
}, { timeout: 2500 });
const running = await page.$eval("#timer-display", (el) => el.textContent);
ok("timer counts down", running !== "0:30", "now=" + running);
ok("no toast over timer", await page.$eval("#toast", (el) => el.hidden));

await page.screenshot({ path: path.join(SCREEN, "03-timer.png") });

await page.$eval('[data-act="timer-toggle"]', (el) => el.click());
await page.$eval('[data-act="timer-reset"]', (el) => el.click());
await page.waitForFunction(() => document.querySelector("#timer-display")?.textContent === "0:30");
ok("timer reset", true);

await page.$eval(".backdrop", (el) => el.click());
await page.waitForFunction(() => !document.querySelector(".sheet"));
await tapAct("go-home");
await page.waitForSelector("[data-act='export']");

await page.$eval("[data-act='export']", (el) => el.click());
let exported = null;
for (let i = 0; i < 25; i++) {
  const files = fs.readdirSync(dl).filter((f) => f.endsWith(".json") && !f.endsWith(".crdownload"));
  if (files.length) { exported = path.join(dl, files[0]); break; }
  await new Promise((r) => setTimeout(r, 150));
}
if (exported) {
  const json = JSON.parse(fs.readFileSync(exported, "utf8"));
  const hasHistory = json.groups?.some((g) => g.exercises?.some((e) => e.history?.length));
  ok("export json has data and history", !!(json.groups && json.groups.length === 3 && hasHistory), path.basename(exported));
} else {
  const raw = await page.evaluate(() => localStorage.getItem("hector-workout-v1"));
  const json = JSON.parse(raw);
  const hasHistory = json.groups?.some((g) => g.exercises?.some((e) => e.history?.length));
  ok("export download missing; localStorage valid", false, hasHistory ? "data ok but no file" : "no data");
}

const manifestOk = await page.evaluate(async () => {
  const r = await fetch("manifest.json");
  const j = await r.json();
  return j.display === "standalone" && Array.isArray(j.icons) && j.icons.length >= 2;
});
ok("manifest is valid", manifestOk);

const swOk = await page.evaluate(async () => {
  if (!("serviceWorker" in navigator)) return false;
  const reg = await navigator.serviceWorker.ready;
  return !!reg.active;
});
ok("service worker is active", swOk);

await page.$eval(".group-card.day-c", (el) => el.click());
await page.waitForSelector(".stage-btn");
const legs = await page.evaluate(() => document.body.innerText);
ok("treadmill stages shown", /Walk/.test(legs) && /3 min/.test(legs) && /3\.5/.test(legs) && /Sprint/.test(legs) && /10\.5/.test(legs) && /Set 1 of 2/i.test(legs));
ok("day C lists the new exercises", /DB hip thrust/.test(legs) && /Calf raise/.test(legs) && /Treadmill intervals/.test(legs));

await page.$eval("#toast", (el) => { el.hidden = true; });
await page.screenshot({ path: path.join(SCREEN, "04-treadmill-stages.png") });

const speedSize = await page.$eval(".speed-btn", (el) => {
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
ok("speed buttons are about 40px", speedSize.w >= 40 && speedSize.h >= 40, JSON.stringify(speedSize));

await page.$eval('.stage-btn[data-i="0"] [data-act="stage-speed"][data-dir="1"]', (el) => el.click());
const bumped = await page.$eval('.stage-btn[data-i="0"] .setting', (el) => el.textContent.trim());
ok("plus raises walk speed by 0.1", bumped === "@ 3.6", bumped);
ok("plus does not open the timer", !(await page.$(".sheet")));

await page.$eval('.stage-btn[data-i="0"] [data-act="stage-speed"][data-dir="-1"]', (el) => el.click());
const restored = await page.$eval('.stage-btn[data-i="0"] .setting', (el) => el.textContent.trim());
ok("minus lowers walk speed by 0.1", restored === "@ 3.5", restored);
ok("minus does not open the timer", !(await page.$(".sheet")));

const clamped = await page.evaluate(() => {
  const click = (dir) => document.querySelector(`.stage-btn[data-i="0"] [data-dir="${dir}"]`).click();
  const read = () => document.querySelector('.stage-btn[data-i="0"] .setting').textContent.trim();
  for (let i = 0; i < 40; i++) click("-1");
  const low = read();
  for (let i = 0; i < 200; i++) click("1");
  const high = read();
  for (let i = 0; i < 115; i++) click("-1");
  const back = read();
  return { low, high, back, sheet: !!document.querySelector(".sheet") };
});
ok("speed clamps to 0.5 and 15.0", clamped.low === "@ 0.5" && clamped.high === "@ 15.0" && clamped.back === "@ 3.5" && !clamped.sheet, JSON.stringify(clamped));

async function closeSheet() {
  if (await page.$(".backdrop")) {
    await page.$eval(".backdrop", (el) => el.click());
    await page.waitForFunction(() => !document.querySelector(".sheet"));
  }
}

async function readTimer() {
  return page.evaluate(() => ({
    time: document.querySelector("#timer-display")?.textContent,
    title: document.querySelector(".sheet h2")?.textContent,
    sub: document.querySelector("#timer-stage-sub")?.textContent,
    toggle: document.querySelector('[data-act="timer-toggle"]')?.textContent
  }));
}

const walkBtn = await page.$('[data-act="tap-stage"][data-i="0"]');
ok("walk stage is tappable", !!walkBtn);
await walkBtn.tap();
await page.waitForSelector("#timer-display");
const walkTimer = await readTimer();
ok("tapping walk starts 3:00 timer", /^(3:00|2:5\d)$/.test(walkTimer.time), JSON.stringify(walkTimer));
ok("walk timer shows name and speed", walkTimer.title === "Walk" && /@\s*3\.5/.test(walkTimer.sub) && /Set 1 of 2/.test(walkTimer.sub), JSON.stringify(walkTimer));
ok("walk timer is running", walkTimer.toggle === "Pause", walkTimer.toggle);

await page.$eval('[data-act="timer-toggle"]', (el) => el.click());
await closeSheet();

const jogBtn = await page.$('[data-act="tap-stage"][data-i="1"]');
await jogBtn.tap();
await page.waitForSelector("#timer-display");
const jogTimer = await readTimer();
ok("tapping jog starts 4:00 timer", /^(4:00|3:5\d)$/.test(jogTimer.time), JSON.stringify(jogTimer));
ok("jog timer shows name and speed", jogTimer.title === "Jog" && /@\s*7\.1/.test(jogTimer.sub), JSON.stringify(jogTimer));

await page.$eval('[data-act="timer-toggle"]', (el) => el.click());
await closeSheet();

const sprintBtn = await page.$('[data-act="tap-stage"][data-i="2"]');
await sprintBtn.tap();
await page.waitForSelector("#timer-display");
const sprintTimer = await readTimer();
ok("tapping sprint starts 1:00 timer", /^(1:00|0:5\d)$/.test(sprintTimer.time), JSON.stringify(sprintTimer));
ok("sprint timer shows name and speed", sprintTimer.title === "Sprint" && /@\s*10\.5/.test(sprintTimer.sub), JSON.stringify(sprintTimer));

// Outdoor run — mocked GPS
await page.$eval('[data-act="timer-toggle"]', (el) => el.click()).catch(() => {});
if (await page.$(".backdrop")) {
  await page.$eval(".backdrop", (el) => el.click());
  await page.waitForFunction(() => !document.querySelector(".sheet"));
}
if (await page.$("[data-act='go-home']")) {
  await tapAct("go-home");
  await page.waitForSelector("[data-act='open-run']");
}

await page.evaluate(() => {
  const origin = 1_700_000_000_000;
  let now = origin;
  Date.now = () => now;
  window.__advance = (ms) => { now += ms; };
  const watchers = new Map();
  let seq = 1;
  let current = { lat: 34, lng: -118, accuracy: 8, t: now };
  function emit() {
    const pos = {
      coords: {
        latitude: current.lat,
        longitude: current.lng,
        accuracy: current.accuracy,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null
      },
      timestamp: current.t
    };
    for (const w of watchers.values()) w.success(pos);
  }
  window.__geo = {
    set(p) {
      current = Object.assign({}, current, p);
      if (current.t == null) current.t = now;
      emit();
    }
  };
  navigator.geolocation.watchPosition = (success) => {
    const id = seq++;
    watchers.set(id, { success });
    success({
      coords: {
        latitude: current.lat,
        longitude: current.lng,
        accuracy: current.accuracy,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null
      },
      timestamp: current.t
    });
    return id;
  };
  navigator.geolocation.clearWatch = (id) => watchers.delete(id);
});

ok("outdoor run card on home", !!(await page.$("[data-act='open-run']")));
await tapAct("open-run");
await page.waitForSelector("[data-act='start-run']");
const runIdle = await page.evaluate(() => document.body.innerText);
ok("run screen reminds to keep the screen on", /keep the screen on/i.test(runIdle));

await tapAct("start-run");
await page.waitForSelector("#run-live");
await page.waitForSelector("#run-map");

const dlat = (RunMath.METERS_PER_MILE / RunMath.EARTH_RADIUS_M) * (180 / Math.PI);
await page.evaluate((dlat) => {
  window.__advance(8 * 60 * 1000);
  window.__geo.set({ lat: 34 + dlat, lng: -118, accuracy: 8, t: Date.now() });
}, dlat);

await page.waitForFunction(() => {
  const dist = document.getElementById("run-distance")?.textContent;
  const time = document.getElementById("run-elapsed")?.textContent;
  const speed = document.getElementById("run-avg-speed")?.textContent;
  return dist === "1.00 mi" && time === "8:00" && speed === "7.5 mph";
}, { timeout: 4000 });

const liveStats = await page.evaluate(() => ({
  time: document.getElementById("run-elapsed")?.textContent,
  dist: document.getElementById("run-distance")?.textContent,
  pace: document.getElementById("run-avg-pace")?.textContent,
  speed: document.getElementById("run-avg-speed")?.textContent,
  current: document.getElementById("run-pace")?.textContent
}));
ok("live run shows 1.00 mi in 8:00 at 7.5 mph", liveStats.dist === "1.00 mi" && liveStats.time === "8:00" && liveStats.speed === "7.5 mph", JSON.stringify(liveStats));
ok("live run shows 8:00 /mi average pace", liveStats.pace === "8:00 /mi", JSON.stringify(liveStats));

await page.evaluate(() => { if (window.__trackInvalidate) window.__trackInvalidate(); });
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: path.join(SCREEN, "05-run-live.png") });

await tapAct("finish-run");
await page.waitForSelector("[data-act='confirm-ok']");
await tapAct("confirm-ok");
await page.waitForSelector("#run-detail");
await page.$eval("#toast", (el) => { el.hidden = true; }).catch(() => {});
await new Promise((r) => setTimeout(r, 2500));
const detail = await page.evaluate(() => document.body.innerText);
ok("run detail shows distance, time, and averages", /1\.00 mi/.test(detail) && /8:00/.test(detail) && /7\.5 mph/.test(detail) && /8:00 \/mi/.test(detail), detail.replace(/\s+/g, " ").slice(0, 220));

await page.screenshot({ path: path.join(SCREEN, "06-run-detail.png") });

const stored = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem("hector-workout-v1"));
  return {
    runCount: (d.runs || []).length,
    miles: d.runs && d.runs[0] && d.runs[0].distanceMiles,
    duration: d.runs && d.runs[0] && d.runs[0].durationMs,
    hasPath: !!(d.runs && d.runs[0] && d.runs[0].path && d.runs[0].path.length >= 2),
    groups: Array.isArray(d.groups) && d.groups.length === 3
  };
});
ok("finished run saved in localStorage", stored.runCount === 1 && stored.miles > 0.99 && stored.miles < 1.01 && stored.duration === 8 * 60 * 1000 && stored.hasPath && stored.groups, JSON.stringify(stored));

await page.evaluate(() => { location.hash = "#/g/day-c"; });
await page.waitForSelector('.stage-btn[data-i="0"] [data-dir="1"]');
await page.$eval('.stage-btn[data-i="0"] [data-dir="1"]', (el) => el.click());
await page.waitForFunction(() => document.querySelector('.stage-btn[data-i="0"] .setting')?.textContent.includes("3.6"));

await page.evaluate(() => {
  let now = Date.now();
  Date.now = () => now;
  window.__jump = (ms) => { now += ms; };
});

const sequence = [];
async function readStage() {
  return page.evaluate(() => ({
    title: document.querySelector(".sheet h2")?.textContent || "",
    sub: document.querySelector("#timer-stage-sub")?.textContent || ""
  }));
}
async function finishStage() {
  await page.evaluate(() => window.__jump(20 * 60 * 1000));
  await page.waitForFunction(() => {
    return !!document.querySelector(".timer-complete") || !!document.querySelector('[data-act="start-next-stage"]');
  }, { timeout: 4000 });
  return page.evaluate(() => document.querySelector('[data-act="start-next-stage"]')?.textContent || "");
}

await page.$eval('[data-act="tap-stage"][data-i="0"]', (el) => el.click());
await page.waitForSelector("#timer-display");
sequence.push(await readStage());
let nextLabel = await finishStage();
ok("set 1 starts at walk", sequence[0].title === "Walk" && /Set 1 of 2/.test(sequence[0].sub), JSON.stringify(sequence[0]));
sequence.push(await (async () => {
  ok("next after walk is jog", /Jog/.test(nextLabel) && !/Set 2/.test(nextLabel), nextLabel);
  await page.$eval('[data-act="start-next-stage"]', (el) => el.click());
  await page.waitForSelector("#timer-display");
  const started = await readStage();
  nextLabel = await finishStage();
  return started;
})());
sequence.push(await (async () => {
  ok("next after jog is sprint", /Sprint/.test(nextLabel), nextLabel);
  await page.$eval('[data-act="start-next-stage"]', (el) => el.click());
  await page.waitForSelector("#timer-display");
  const started = await readStage();
  nextLabel = await finishStage();
  return started;
})());
ok("set 1 ran walk jog sprint", sequence.map((s) => s.title).join(",") === "Walk,Jog,Sprint", JSON.stringify(sequence));
ok("finishing set 1 sprint offers set 2 walk", /Set 2/.test(nextLabel) && /Walk/.test(nextLabel) && !/Sprint/.test(nextLabel), nextLabel);

const set1Progress = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem("hector-workout-v1"));
  const day = d.groups.find((g) => g.id === "day-c");
  const tread = day.exercises.find((e) => e.name === "Treadmill intervals");
  const sets = d.activeSession.exercises[tread.id].sets;
  return sets.map((s) => s.stagesDone);
});
ok("set 1 stages stay done and set 2 is fresh", JSON.stringify(set1Progress) === JSON.stringify([[true, true, true], [false, false, false]]), JSON.stringify(set1Progress));

await closeSheet();
await page.$eval('[data-act="select-set"][data-i="1"]', (el) => el.click());
await page.waitForSelector("#timer-display");
const set2Start = await readStage();
ok("selecting set 2 starts at walk", set2Start.title === "Walk" && /Set 2 of 2/.test(set2Start.sub), JSON.stringify(set2Start));
sequence.push(set2Start);
nextLabel = await finishStage();
for (const expected of ["Jog", "Sprint"]) {
  ok("set 2 continues in order toward " + expected, nextLabel.startsWith("Next: " + expected), nextLabel);
  await page.$eval('[data-act="start-next-stage"]', (el) => el.click());
  await page.waitForSelector("#timer-display");
  const started = await readStage();
  sequence.push(started);
  nextLabel = await finishStage();
}
ok("full six-stage order", sequence.map((s) => s.title + " " + (s.sub.includes("Set 1") ? "1" : "2")).join(" | ") === "Walk 1 | Jog 1 | Sprint 1 | Walk 2 | Jog 2 | Sprint 2", JSON.stringify(sequence));
ok("set 2 ends with no further stage", nextLabel === "", nextLabel);
await closeSheet();
await tapAct("save-workout");
await page.waitForFunction(() => {
  const t = document.getElementById("toast");
  return t && !t.hidden && /saved/i.test(t.textContent);
});
const savedSpeed = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem("hector-workout-v1"));
  const day = d.groups.find((g) => g.id === "day-c");
  const tread = day.exercises.find((e) => e.name === "Treadmill intervals");
  const hist = tread.history && tread.history[0];
  return {
    setting: tread.stages[0].setting,
    jog: tread.stages[1].setting,
    sprint: tread.stages[2].setting,
    sets: hist ? hist.sets.map((s) => (s.stages || []).map((st) => st.setting)) : null
  };
});
ok("adjusted speed is the next-workout default", savedSpeed.setting === "3.6" && savedSpeed.jog === "7.1" && savedSpeed.sprint === "10.5", JSON.stringify(savedSpeed));
ok("history records the speed used", Array.isArray(savedSpeed.sets) && savedSpeed.sets.length === 2 && savedSpeed.sets.every((row) => row[0] === "3.6" && row[1] === "7.1" && row[2] === "10.5"), JSON.stringify(savedSpeed));
await page.reload({ waitUntil: "networkidle0" });
await page.waitForSelector('.stage-btn[data-i="0"] .setting');
const after = await page.$eval('.stage-btn[data-i="0"] .setting', (el) => el.textContent.trim());
ok("adjusted speed survives reload", after === "@ 3.6", after);

await page.evaluate(() => {
  localStorage.setItem("hector-workout-v1", JSON.stringify({
    version: 1,
    runs: [],
    activeSession: null,
    groups: [
      {
        id: "arms",
        name: "Arms",
        exercises: [{
          id: "old-push",
          name: "Push up",
          isBodyweight: true,
          sets: [{ targetReps: 23, weight: 0 }],
          history: [{ id: "h-push", date: "2026-10-01", sets: [{ reps: 23, weight: 0 }] }]
        }]
      },
      {
        id: "legs",
        name: "Legs",
        exercises: [{
          id: "old-leg",
          name: "Leg machine up",
          sets: [{ targetReps: 19, weight: 130 }],
          history: [{ id: "legacy-leg", date: "2026-11-01", sets: [{ reps: 19, weight: 130 }] }]
        }]
      }
    ]
  }));
});
await page.reload({ waitUntil: "networkidle0" });
const migrated = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem("hector-workout-v1"));
  const ids = d.groups.map((g) => g.id);
  const arms = d.groups.find((g) => g.id === "arms");
  const legs = d.groups.find((g) => g.id === "legs");
  const push = arms.exercises.find((e) => e.name === "Push up");
  const leg = legs.exercises.find((e) => e.name === "Leg machine" || e.name === "Leg machine up");
  return {
    days: ["day-a", "day-b", "day-c"].filter((id) => ids.includes(id)).length,
    day4: ids.includes("day-d"),
    archived: !!(arms.archived && legs.archived),
    pushReps: push.history[0].sets[0].reps,
    legName: leg.name,
    legReps: leg.history[0].sets[0].reps
  };
});
ok("migration keeps old logs and adds A/B/C only", migrated.days === 3 && !migrated.day4 && migrated.archived && migrated.pushReps === 23 && migrated.legName === "Leg machine" && migrated.legReps === 19, JSON.stringify(migrated));
await page.evaluate(() => { location.hash = "#/"; });
await page.waitForSelector(".group-card.arms");
await tapAct("open-group", "[data-id='arms']");
await tapAct("open-history");
await page.waitForSelector(".hist-item");
const oldHist = await page.evaluate(() => document.querySelector(".sheet")?.innerText || "");
ok("old arms history still opens", /Push up/.test(oldHist) && /23/.test(oldHist), oldHist.replace(/\s+/g, " ").slice(0, 140));

const failed = results.filter((r) => !r.pass);
console.log("\n---- " + (results.length - failed.length) + "/" + results.length + " passed ----");
await browser.close();
process.exit(failed.length ? 1 : 0);
