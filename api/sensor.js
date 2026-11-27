// FIRE GUARDIAN: receives ESP32 readings & AI vision events (POST) and serves them to the website (GET).
// Storage: Upstash Redis over REST (no npm packages needed).
const crypto = require('crypto');

const DEVICE = 'FIRE-GUARDIAN-DRONE';
const OFFLINE_MS = 15000;      // no data for this long = device offline
const GAP_MS = 60000;          // a longer silence ends the previous alert
const MAX_ALERTS = 50;
const MAX_ANIMALS = 50;

const K_STATE = 'fireguard:state';      // latest reading, last GPS fix, open alert
const K_ALERTS = 'fireguard:alerts';    // finished alerts, newest first
const K_ANIMALS = 'fireguard:animals';  // animal detection history, newest first

async function redis(commands) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Storage environment variables are missing');
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Storage returned HTTP ${res.status}`);
  const out = await res.json();
  const failed = out.find((r) => r.error);
  if (failed) throw new Error(failed.error);
  return out.map((r) => r.result);
}

function keyMatches(given) {
  const expected = process.env.DEVICE_KEY || '';
  if (expected.length < 12 || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Returns a clean reading, or a string explaining what is wrong.
function validate(d) {
  if (!d || typeof d !== 'object') return 'Body must be a JSON object';
  if (d.device !== DEVICE) return 'Unknown device';
  for (const f of ['flame', 'smoke', 'danger', 'gpsValid']) {
    if (typeof d[f] !== 'boolean') return `${f} must be true or false`;
  }
  const aiFire = Boolean(d.aiFire);
  const aiSmoke = Boolean(d.aiSmoke);
  const expectedDanger = Boolean(d.flame || d.smoke || aiFire || aiSmoke);
  if (d.danger !== expectedDanger) return 'danger does not match flame/smoke/ai sources';

  if (!Number.isInteger(d.smokeValue) || d.smokeValue < 0 || d.smokeValue > 4095) {
    return 'smokeValue must be an integer from 0 to 4095';
  }
  if (d.gpsValid) {
    const okLat = Number.isFinite(d.latitude) && Math.abs(d.latitude) <= 90;
    const okLng = Number.isFinite(d.longitude) && Math.abs(d.longitude) <= 180;
    if (!okLat || !okLng) return 'Invalid GPS coordinates';
  }

  // Sanitize optional animal detections
  let animalDetections = [];
  if (Array.isArray(d.aiDetections)) {
    animalDetections = d.aiDetections.slice(0, 10).map((a) => ({
      species: typeof a.species === 'string' ? a.species.slice(0, 50) : 'Animal',
      confidence: Number.isFinite(a.confidence) ? Math.min(100, Math.max(0, Math.round(a.confidence))) : 0,
      threatCategory: typeof a.threatCategory === 'string' ? a.threatCategory : 'LOW',
      threatReason: typeof a.threatReason === 'string' ? a.threatReason : 'Routine observation',
      action: typeof a.action === 'string' ? a.action : 'Monitor from distance',
      bbox: Array.isArray(a.bbox) ? a.bbox.slice(0, 4) : [],
    }));
  }

  return {
    flame: d.flame,
    smoke: d.smoke,
    aiFire: aiFire,
    aiSmoke: aiSmoke,
    danger: d.danger,
    smokeValue: d.smokeValue,
    gpsValid: d.gpsValid,
    latitude: d.gpsValid ? d.latitude : null,
    longitude: d.gpsValid ? d.longitude : null,
    animalDetections: animalDetections,
  };
}

// Consolidates physical and AI detection sources into active and historic alerts.
function update(prev, reading, now) {
  let active = prev.active || null;
  const finished = [];
  const silent = prev.latest && now - prev.latest.receivedAt > GAP_MS;

  if (active && (silent || !reading.danger)) {
    finished.push({
      ...active,
      endedAt: silent ? prev.latest.receivedAt : now,
      endReason: silent ? 'SIGNAL_LOST' : 'CLEARED',
    });
    active = null;
  }

  const lastFix = reading.gpsValid
    ? { latitude: reading.latitude, longitude: reading.longitude, at: now }
    : prev.lastFix || null;

  if (reading.danger) {
    if (!active) {
      active = {
        id: `A-${now}`,
        startedAt: now,
        flame: false,
        smoke: false,
        aiFire: false,
        aiSmoke: false,
        sources: [],
        location: null,
      };
    }
    active.flame = active.flame || reading.flame;
    active.smoke = active.smoke || reading.smoke;
    active.aiFire = active.aiFire || reading.aiFire;
    active.aiSmoke = active.aiSmoke || reading.aiSmoke;

    const sourcesSet = new Set(active.sources || []);
    if (reading.flame) sourcesSet.add('PHYSICAL_FLAME');
    if (reading.smoke) sourcesSet.add('PHYSICAL_SMOKE');
    if (reading.aiFire) sourcesSet.add('AI_VISION_FIRE');
    if (reading.aiSmoke) sourcesSet.add('AI_VISION_SMOKE');
    active.sources = Array.from(sourcesSet);

    if (reading.gpsValid) active.location = lastFix;
  }

  return { state: { latest: { ...reading, receivedAt: now }, lastFix, active }, finished };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const [raw, list, animals] = await redis([
        ['GET', K_STATE],
        ['LRANGE', K_ALERTS, 0, 19],
        ['LRANGE', K_ANIMALS, 0, 29],
      ]);
      const s = raw ? JSON.parse(raw) : {};
      const age = s.latest ? Date.now() - s.latest.receivedAt : null;
      return res.status(200).json({
        online: age !== null && age <= OFFLINE_MS,
        ageMs: age,
        latest: s.latest || null,
        lastFix: s.lastFix || null,
        activeAlert: s.active || null,
        history: (list || []).map((x) => JSON.parse(x)),
        animalHistory: (animals || []).map((x) => JSON.parse(x)),
      });
    }

    if (req.method === 'POST') {
      if (!keyMatches(req.headers['x-device-key'])) {
        return res.status(401).json({ error: 'Wrong or missing device key' });
      }
      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON' });
      }
      const reading = validate(body);
      if (typeof reading === 'string') return res.status(400).json({ error: reading });

      const [raw] = await redis([['GET', K_STATE]]);
      const now = Date.now();
      const { state, finished } = update(raw ? JSON.parse(raw) : {}, reading, now);
      const commands = [['SET', K_STATE, JSON.stringify(state)]];
      for (const a of finished) commands.push(['LPUSH', K_ALERTS, JSON.stringify(a)]);
      if (finished.length) commands.push(['LTRIM', K_ALERTS, 0, MAX_ALERTS - 1]);

      // Push any animal detections to K_ANIMALS
      if (reading.animalDetections && reading.animalDetections.length > 0) {
        for (const animal of reading.animalDetections) {
          const entry = {
            id: `ANM-${now}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: now,
            species: animal.species,
            confidence: animal.confidence,
            threatCategory: animal.threatCategory,
            threatReason: animal.threatReason,
            action: animal.action,
            bbox: animal.bbox,
            latitude: reading.gpsValid ? reading.latitude : (state.lastFix ? state.lastFix.latitude : null),
            longitude: reading.gpsValid ? reading.longitude : (state.lastFix ? state.lastFix.longitude : null),
            gpsValid: reading.gpsValid,
          };
          commands.push(['LPUSH', K_ANIMALS, JSON.stringify(entry)]);
        }
        commands.push(['LTRIM', K_ANIMALS, 0, MAX_ANIMALS - 1]);
      }

      await redis(commands);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[sensor]', e.message);
    return res.status(500).json({ error: 'Server error. Check the Vercel function logs.' });
  }
};
