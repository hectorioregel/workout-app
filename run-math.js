(() => {
  const METERS_PER_MILE = 1609.344;
  const MAX_ACCURACY_M = 40;
  const MAX_SPEED_MPS = 12.5;
  const MIN_MOVE_M = 4;
  const MIN_DT_MS = 400;
  const EARTH_RADIUS_M = 6371000;

  function haversineMeters(a, b) {
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function metersToMiles(m) {
    return m / METERS_PER_MILE;
  }

  function mpsToMph(mps) {
    return mps * 2.2369362920544;
  }

  function filterPoint(prev, point, opts) {
    const maxAcc = (opts && opts.maxAccuracyM) != null ? opts.maxAccuracyM : MAX_ACCURACY_M;
    const maxSpeed = (opts && opts.maxSpeedMps) != null ? opts.maxSpeedMps : MAX_SPEED_MPS;
    const minMove = (opts && opts.minMoveM) != null ? opts.minMoveM : MIN_MOVE_M;
    const minDt = (opts && opts.minDtMs) != null ? opts.minDtMs : MIN_DT_MS;
    if (!point || !isFinite(point.lat) || !isFinite(point.lng)) {
      return { accept: false, reason: "invalid", deltaM: 0 };
    }
    if (point.accuracy != null && isFinite(point.accuracy) && point.accuracy > maxAcc) {
      return { accept: false, reason: "accuracy", deltaM: 0 };
    }
    if (!prev) return { accept: true, reason: "first", deltaM: 0 };
    const dt = point.t - prev.t;
    if (!(dt >= minDt)) return { accept: false, reason: "too-soon", deltaM: 0 };
    const deltaM = haversineMeters(prev, point);
    if (deltaM < minMove) return { accept: false, reason: "jitter", deltaM };
    const speed = deltaM / (dt / 1000);
    if (speed > maxSpeed) return { accept: false, reason: "speed", deltaM };
    return { accept: true, reason: "ok", deltaM };
  }

  function pathDistanceMeters(points) {
    if (!points || points.length < 2) return 0;
    let d = 0;
    for (let i = 1; i < points.length; i++) d += haversineMeters(points[i - 1], points[i]);
    return d;
  }

  function currentPaceSecPerMile(points, windowMs) {
    const win = windowMs || 25000;
    if (!points || points.length < 2) return 0;
    const lastT = points[points.length - 1].t;
    let i = points.length - 1;
    while (i > 0 && lastT - points[i - 1].t <= win) i -= 1;
    const slice = points.slice(i);
    if (slice.length < 2) return 0;
    const meters = pathDistanceMeters(slice);
    const ms = slice[slice.length - 1].t - slice[0].t;
    const miles = metersToMiles(meters);
    if (miles <= 0 || ms <= 0) return 0;
    return (ms / 1000) / miles;
  }

  function computeStats(points, elapsedMs) {
    const meters = pathDistanceMeters(points);
    const miles = metersToMiles(meters);
    const hours = elapsedMs / 3600000;
    const avgSpeedMph = hours > 0 && miles > 0 ? miles / hours : 0;
    const avgPaceSecPerMile = miles > 0 && elapsedMs > 0 ? (elapsedMs / 1000) / miles : 0;
    return {
      meters,
      miles,
      avgSpeedMph,
      avgPaceSecPerMile,
      currentPaceSecPerMile: currentPaceSecPerMile(points)
    };
  }

  function formatPace(secPerMile) {
    if (!secPerMile || !isFinite(secPerMile) || secPerMile <= 0 || secPerMile > 3600) return "—";
    const total = Math.round(secPerMile);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ":" + String(s).padStart(2, "0") + " /mi";
  }

  function formatMiles(miles) {
    const n = !isFinite(miles) || miles < 0 ? 0 : miles;
    return (Math.round(n * 100) / 100).toFixed(2) + " mi";
  }

  function formatMph(mph) {
    const n = !isFinite(mph) || mph < 0 ? 0 : mph;
    return (Math.round(n * 10) / 10).toFixed(1) + " mph";
  }

  function formatElapsed(ms) {
    const total = Math.max(0, Math.floor((ms || 0) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    return m + ":" + String(s).padStart(2, "0");
  }

  const api = {
    METERS_PER_MILE,
    MAX_ACCURACY_M,
    MAX_SPEED_MPS,
    MIN_MOVE_M,
    MIN_DT_MS,
    EARTH_RADIUS_M,
    haversineMeters,
    metersToMiles,
    mpsToMph,
    filterPoint,
    pathDistanceMeters,
    currentPaceSecPerMile,
    computeStats,
    formatPace,
    formatMiles,
    formatMph,
    formatElapsed
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.RunMath = api;
})();
