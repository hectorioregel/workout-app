# Workout

Live site: https://hectorioregel.github.io/workout-app/

Mobile-first, offline-capable workout tracker (PWA). No backend; everything is stored in the browser with JSON export/import for backup.

## Use
Open the site on your phone. Tap Arms, Abs, or Legs, then tap a set to mark it done. Use +/− to change reps or weight; those values become the next-session defaults when you save. The clock icon opens a countdown timer (30s, 60s, 90s, 2m, 3m, or custom). On treadmill-style exercises, tap Walk, Jog, or Sprint to start that stage's timer. When it ends, the stage is marked done and you can start the next one (or the next set). Export and Import are on the home screen. Outdoor Run tracks a walk or run with GPS (keep the screen on), a live map, distance, pace, and speed, and saves finished runs to history.

## Add to Home Screen
- iPhone (Safari): Share → Add to Home Screen
- Android (Chrome): menu → Add to Home Screen or Install app

## Local development
Serve this folder over HTTP (required for the service worker):

    python3 -m http.server 8765
