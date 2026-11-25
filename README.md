# Workout

Live site: https://hectorioregel.github.io/workout-app/

Mobile-first, offline-capable workout tracker (PWA). No backend; everything is stored in the browser with JSON export/import for backup.

## Use
Open the site on your phone. Tap Day A, Day B, or Day C, then tap a set to mark it done. Use +/− to change reps or weight; those values become the next-session defaults when you save. Plank and treadmill stages start their own countdown when you tap them. Export and Import are on the home screen.

## Add to Home Screen
- iPhone (Safari): Share → Add to Home Screen
- Android (Chrome): menu → Add to Home Screen or Install app

## Local development
Serve this folder over HTTP (required for the service worker):

    python3 -m http.server 8765
