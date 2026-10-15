/**
 * SKYFIGHTER — Cross-Platform UAV Ground Control Station Engine (v1.1)
 * Supports Web PWA, Mobile Browsers (iOS Safari / Android Chrome), and Desktop Wrappers.
 */

import {
  PROTOCOL_VERSION,
  parseIncomingPacket,
  sanitizeManualInput,
  RateLimiter,
  SequenceValidator,
  ControlLeaseManager,
  evaluateCompositeHazard
} from './protocol.js';

// ========================================================
// APPLICATION STATE
// ========================================================
const state = {
  activeScreen: 'dashboard',
  isSimulation: true,
  isConnected: true,
  isArmed: false,
  isAudioMuted: false,
  telemetryAgeMs: 0,
  lastTelemetryTimestamp: Date.now(),
  commandSequence: 1,
  clientId: 'SKYFIGHTER-GCS-01',
  activeScenario: 'fire_smoke',
  showAiBoxes: true,
  aiConfidenceThreshold: 0.75,
  thermalPalette: 'ironbow',
  thermalMaxTriggerC: 85,
  
  // Pilot Flight Sticks
  sticks: {
    roll: 0.0,
    pitch: 0.0,
    yaw: 0.0,
    throttle: 0.0
  },
  
  // Telemetry Snapshot
  telemetry: {
    version: 1,
    type: 'telemetry',
    sequence: 1,
    timestamp_ms: Date.now(),
    connection: 'simulated',
    flight: {
      mode: 'disarmed',
      armed: false,
      capabilities: {
        manual_control: false,
        autonomous_navigation: false,
        return_to_home: false,
        thermal_camera: true,
        rgb_camera: true,
        buzzer: true,
        simulation_mode: true
      }
    },
    sensors: {
      temperature_c: 28.4,
      humidity_pct: 46.5,
      mq2_adc: 412,
      flame_detected: false,
      mpu_connected: true,
      mpu_temperature_c: 31.4
    },
    gps: {
      valid: true,
      latitude: 12.971600,
      longitude: 77.594600,
      satellites: 9,
      altitude_m: 24.5
    },
    battery: {
      voltage_v: null, // Honest: unwired in hardware
      percentage: null
    },
    alerts: [],
    ai_detections: []
  },
  
  // Incident queue
  incidents: [
    {
      id: 'INC-101',
      timestamp_ms: Date.now() - 32000,
      timeStr: new Date(Date.now() - 32000).toLocaleTimeString(),
      severity: 'warning',
      source: 'MQ-2 Smoke Sensor',
      type: 'Smoke Plume Detected',
      coords: '12.972100, 77.595200',
      status: 'potential',
      maxTempC: 68.4
    }
  ],
  
  // Event history log
  eventLog: []
};

// Global managers
const rateLimiter = new RateLimiter(20);
const sequenceValidator = new SequenceValidator();
const leaseManager = new ControlLeaseManager(5000);
leaseManager.claimLease(state.clientId);

// Web Audio API context fallback
let audioCtx = null;
let webSocket = null;

// ========================================================
// INITIALIZATION
// ========================================================
document.addEventListener('DOMContentLoaded', () => {
  initServiceWorker();
  initNavigation();
  initTelemetryLoop();
  initSimulatedCanvases();
  initFlightControls();
  initAudio();
  initSettings();
  logEvent('SYSTEM', 'SKYFIGHTER GCS v1.1 initialized in Simulation Mode.');
});

// Register Progressive Web App Service Worker
function initServiceWorker() {
  if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      console.log('[PWA] Service Worker registered successfully:', reg.scope);
    }).catch((err) => {
      console.warn('[PWA] Service Worker registration skipped or failed:', err);
    });
  }
}

// ========================================================
// NAVIGATION MANAGEMENT (10 SCREENS)
// ========================================================
function initNavigation() {
  const sidebarItems = document.querySelectorAll('.nav-item');
  const tabBtns = document.querySelectorAll('.tab-btn');

  function switchScreen(screenId) {
    state.activeScreen = screenId;

    // Update screen views
    document.querySelectorAll('.screen-view').forEach(view => {
      view.classList.toggle('active', view.id === `screen-${screenId}`);
    });

    // Update sidebar
    sidebarItems.forEach(item => {
      item.classList.toggle('active', item.dataset.screen === screenId);
    });

    // Update mobile tabs
    tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.screen === screenId);
    });

    logEvent('SYSTEM', `Switched view to ${screenId.toUpperCase()}`);
  }

  sidebarItems.forEach(item => {
    item.addEventListener('click', () => switchScreen(item.dataset.screen));
  });

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchScreen(btn.dataset.screen));
  });

  // Header and Dashboard quick actions
  const btnDashViewAll = document.getElementById('btn-dash-view-all');
  if (btnDashViewAll) {
    btnDashViewAll.addEventListener('click', () => switchScreen('alerts'));
  }
}

// ========================================================
// TELEMETRY & SIMULATION ENGINE
// ========================================================
function initTelemetryLoop() {
  // Update at 2 Hz (500 ms) matching hardware telemetry rate
  setInterval(() => {
    if (state.isSimulation) {
      updateSimulatedTelemetry();
    }
    renderTelemetryUI();
  }, 500);

  // Monitor latency & telemetry freshness every 1 second
  setInterval(() => {
    const age = Date.now() - state.lastTelemetryTimestamp;
    state.telemetryAgeMs = age;
    const latencyEl = document.getElementById('latency-text');
    if (latencyEl) {
      latencyEl.textContent = state.isSimulation ? 'LATENCY: 12ms (SIM)' : `AGE: ${age}ms`;
    }
  }, 1000);
}

function updateSimulatedTelemetry() {
  const now = Date.now();
  state.lastTelemetryTimestamp = now;

  // Add subtle sensor jitter
  const tJitter = (Math.random() - 0.5) * 0.4;
  const hJitter = (Math.random() - 0.5) * 0.6;
  const mJitter = Math.floor((Math.random() - 0.5) * 12);

  let temp = 28.4 + tJitter;
  let humidity = 46.5 + hJitter;
  let mq2 = 412 + mJitter;
  let flame = false;

  // Apply scenario overrides
  if (state.activeScenario === 'fire_smoke') {
    temp = 62.4 + (Math.random() * 8.0);
    humidity = 24.0 + (Math.random() * 4.0);
    mq2 = 1450 + Math.floor(Math.random() * 300);
    flame = true; // Optical trigger
  } else if (state.activeScenario === 'smoke_plume') {
    temp = 34.2 + (Math.random() * 3.0);
    mq2 = 1120 + Math.floor(Math.random() * 200);
    flame = false;
  } else if (state.activeScenario === 'high_heat') {
    temp = 54.0 + (Math.random() * 4.0);
    mq2 = 480 + mJitter;
    flame = false;
  }

  // GPS Slow Drift Simulation
  let lat = state.telemetry.gps.latitude;
  let lon = state.telemetry.gps.longitude;
  if (state.isArmed) {
    lat += (Math.random() - 0.5) * 0.00004;
    lon += (Math.random() - 0.5) * 0.00004;
  }

  state.telemetry = {
    version: 1,
    type: 'telemetry',
    sequence: ++state.commandSequence,
    timestamp_ms: now,
    connection: state.isSimulation ? 'simulated' : (state.isConnected ? 'connected' : 'disconnected'),
    flight: {
      mode: state.isArmed ? 'manual' : 'disarmed',
      armed: state.isArmed,
      capabilities: {
        manual_control: false, // Locked in software
        autonomous_navigation: false,
        return_to_home: false,
        thermal_camera: true,
        rgb_camera: true,
        buzzer: true,
        simulation_mode: state.isSimulation
      }
    },
    sensors: {
      temperature_c: parseFloat(temp.toFixed(1)),
      humidity_pct: parseFloat(humidity.toFixed(1)),
      mq2_adc: mq2,
      flame_detected: flame,
      mpu_connected: true,
      mpu_temperature_c: 31.4 + tJitter
    },
    gps: {
      valid: true,
      latitude: parseFloat(lat.toFixed(6)),
      longitude: parseFloat(lon.toFixed(6)),
      satellites: 9,
      altitude_m: state.isArmed ? 32.5 : 24.5
    },
    battery: {
      voltage_v: null, // Always null to reflect unwired physical sensor
      percentage: null
    },
    alerts: [],
    ai_detections: []
  };

  // Evaluate hazard
  const hazard = evaluateCompositeHazard(state.telemetry.sensors, state.isConnected, false);
  if (hazard.state !== 'NORMAL' && flame) {
    maybeRecordIncident(hazard, lat, lon, temp);
  }
}

function maybeRecordIncident(hazard, lat, lon, temp) {
  const lastInc = state.incidents[0];
  const now = Date.now();
  if (!lastInc || (now - lastInc.timestamp_ms) > 15000) {
    const newInc = {
      id: `INC-${Math.floor(100 + Math.random() * 900)}`,
      timestamp_ms: now,
      timeStr: new Date(now).toLocaleTimeString(),
      severity: hazard.severity,
      source: 'Multi-Sensor (Flame + MQ-2)',
      type: 'Confirmed Forest Fire Hotspot',
      coords: `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
      status: 'repeated',
      maxTempC: parseFloat(temp.toFixed(1))
    };
    state.incidents.unshift(newInc);
    if (state.incidents.length > 50) state.incidents.pop();
    
    logEvent('ALERT', `NEW INCIDENT ${newInc.id}: ${newInc.type} at ${newInc.coords}`);
    playBuzzer();
    updateAlertCounter();
  }
}

function renderTelemetryUI() {
  const t = state.telemetry;
  const s = t.sensors;
  const g = t.gps;
  const f = t.flight;

  // Header status pills
  const armedPill = document.getElementById('armed-pill');
  const armedLabel = document.getElementById('armed-label');
  if (armedPill && armedLabel) {
    armedPill.className = `status-pill ${f.armed ? 'status-armed' : 'status-disarmed'}`;
    armedLabel.textContent = f.armed ? 'ARMED (SIM)' : 'DISARMED';
  }

  // Dashboard values
  setElemText('val-temp', s.temperature_c !== null ? `${s.temperature_c} ` : 'UNAVAILABLE');
  setElemText('val-humidity', s.humidity_pct !== null ? `${s.humidity_pct} ` : 'UNAVAILABLE');
  setElemText('val-smoke', s.mq2_adc !== null ? `${s.mq2_adc} ` : 'UNAVAILABLE');
  
  const valFlame = document.getElementById('val-flame');
  if (valFlame) {
    if (s.flame_detected === true) {
      valFlame.textContent = 'ACTIVE FLAME!';
      valFlame.className = 'metric-value flame-alert';
    } else if (s.flame_detected === false) {
      valFlame.textContent = 'CLEAR';
      valFlame.className = 'metric-value flame-safe';
    } else {
      valFlame.textContent = 'UNAVAILABLE';
      valFlame.className = 'metric-value';
    }
  }

  if (g.valid && g.latitude !== null && g.longitude !== null) {
    setElemText('val-coords', `${g.latitude.toFixed(6)}, ${g.longitude.toFixed(6)}`);
    setElemText('sub-gps', `Alt: ${g.altitude_m}m | Sats: ${g.satellites}`);
    setElemText('map-lat', `${g.latitude.toFixed(6)}°`);
    setElemText('map-lon', `${g.longitude.toFixed(6)}°`);
    setElemText('map-alt', `${g.altitude_m} m`);
    setElemText('map-sats', `${g.satellites} Locked (3D Fix)`);
    setElemText('map-drone-pos', `DRONE: ${g.latitude.toFixed(6)} N, ${g.longitude.toFixed(6)} E`);
  } else {
    setElemText('val-coords', 'NO GPS FIX');
    setElemText('sub-gps', 'Antenna outdoors required');
  }

  // Hazard banner
  const hazard = evaluateCompositeHazard(s, state.isConnected, false);
  const banner = document.getElementById('dashboard-hazard-banner');
  const hTitle = document.getElementById('hazard-title');
  const hDesc = document.getElementById('hazard-desc');
  const hIcon = document.getElementById('hazard-icon');
  
  if (banner && hTitle && hDesc && hIcon) {
    banner.className = `hazard-banner banner-${hazard.severity === 'critical' ? 'critical' : (hazard.severity === 'warning' ? 'warning' : 'normal')}`;
    hTitle.textContent = hazard.state.replace(/_/g, ' ');
    hDesc.textContent = hazard.message;
    hIcon.textContent = hazard.severity === 'critical' ? '🔥' : (hazard.severity === 'warning' ? '⚠️' : '🛡️');
  }

  // Diagnostics page updates
  setElemText('diag-dht-temp', s.temperature_c !== null ? `${s.temperature_c} °C` : 'READ ERROR');
  setElemText('diag-dht-humidity', s.humidity_pct !== null ? `${s.humidity_pct} %` : 'READ ERROR');
  setElemText('diag-mq2-raw', s.mq2_adc !== null ? `${s.mq2_adc} / 4095` : 'OFFLINE');
  setElemText('diag-flame-pin', s.flame_detected ? 'LOW (TRIGGERED)' : 'HIGH (Inactive)');

  renderIncidentsTable();
}

function setElemText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function updateAlertCounter() {
  const badge = document.getElementById('alert-counter-badge');
  if (badge) {
    badge.textContent = state.incidents.length;
    badge.classList.toggle('hidden', state.incidents.length === 0);
  }
}

function renderIncidentsTable() {
  const tbody = document.getElementById('incidents-table-body');
  if (!tbody) return;

  tbody.innerHTML = state.incidents.map((inc) => `
    <tr>
      <td>${inc.timeStr}</td>
      <td><span class="badge-severity badge-${inc.severity}">${inc.severity.toUpperCase()}</span></td>
      <td>${inc.source}</td>
      <td><strong>${inc.type}</strong> (${inc.maxTempC}°C)</td>
      <td><code>${inc.coords}</code></td>
      <td><span class="guide-badge">${inc.status.toUpperCase()}</span></td>
      <td>
        <button class="btn-action-sm" onclick="window.skyVerifyIncident('${inc.id}')">Verify</button>
      </td>
    </tr>
  `).join('');
}

window.skyVerifyIncident = function(id) {
  const inc = state.incidents.find(i => i.id === id);
  if (inc) {
    inc.status = 'human_verified';
    renderIncidentsTable();
    logEvent('ALERT', `Incident ${id} marked HUMAN VERIFIED by pilot.`);
  }
};

// ========================================================
// REALISTIC CAMERA & MAP SIMULATION CANVASES
// ========================================================
function initSimulatedCanvases() {
  const canvasRgb = document.getElementById('canvas-rgb');
  const canvasThermal = document.getElementById('canvas-thermal');
  const canvasMap = document.getElementById('canvas-tactical-map');

  let tick = 0;

  function renderFrame() {
    tick += 0.05;

    // 1. Render RGB Aerial Canopy View
    if (canvasRgb) {
      const ctx = canvasRgb.getContext('2d');
      const w = canvasRgb.width;
      const h = canvasRgb.height;

      // Dark lush forest gradient
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, '#0c1a12');
      bg.addColorStop(1, '#08120d');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Draw stylized pine canopy textures
      ctx.fillStyle = '#162e20';
      for (let i = 0; i < 40; i++) {
        const x = (Math.sin(i * 13 + tick * 0.05) * 0.5 + 0.5) * w;
        const y = (Math.cos(i * 7 + tick * 0.05) * 0.5 + 0.5) * h;
        ctx.beginPath();
        ctx.arc(x, y, 16 + (i % 10), 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw wildfire smoke & flame if scenario active
      if (state.activeScenario === 'fire_smoke' || state.activeScenario === 'smoke_plume') {
        const fireX = w * 0.62;
        const fireY = h * 0.45;

        // Animated smoke plume
        for (let j = 0; j < 12; j++) {
          const plumeAge = (tick * 1.5 + j * 0.4) % 8;
          const py = fireY - plumeAge * 28;
          const px = fireX + Math.sin(plumeAge * 1.5) * 22;
          const r = 20 + plumeAge * 14;

          ctx.fillStyle = `rgba(180, 180, 180, ${Math.max(0, 0.4 - plumeAge * 0.05)})`;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
        }

        // Active flame glow
        if (state.activeScenario === 'fire_smoke') {
          const flameGlow = ctx.createRadialGradient(fireX, fireY, 5, fireX, fireY, 65);
          flameGlow.addColorStop(0, '#ffffff');
          flameGlow.addColorStop(0.3, '#ffaa00');
          flameGlow.addColorStop(0.7, '#ff3b30');
          flameGlow.addColorStop(1, 'rgba(255, 59, 48, 0)');
          ctx.fillStyle = flameGlow;
          ctx.beginPath();
          ctx.arc(fireX, fireY, 65, 0, Math.PI * 2);
          ctx.fill();
        }

        // Render Edge AI Bounding Boxes matching diagram flow
        if (state.showAiBoxes) {
          // Fire Bounding Box
          if (state.activeScenario === 'fire_smoke') {
            ctx.strokeStyle = '#ff3b30';
            ctx.lineWidth = 2;
            ctx.strokeRect(fireX - 45, fireY - 45, 90, 90);

            ctx.fillStyle = 'rgba(255, 59, 48, 0.85)';
            ctx.fillRect(fireX - 45, fireY - 70, 120, 22);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px monospace';
            ctx.fillText('FIRE: 0.94 (HIGH)', fireX - 40, fireY - 55);
          }

          // Smoke Bounding Box
          ctx.strokeStyle = '#ffaa00';
          ctx.lineWidth = 2;
          ctx.strokeRect(fireX - 80, fireY - 140, 140, 100);

          ctx.fillStyle = 'rgba(255, 170, 0, 0.85)';
          ctx.fillRect(fireX - 80, fireY - 165, 130, 22);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 11px monospace';
          ctx.fillText('SMOKE: 0.88 (PLUME)', fireX - 75, fireY - 150);
        }
      }
    }

    // 2. Render Thermal Radiometric Canvas (False-Color Ironbow)
    if (canvasThermal) {
      const tCtx = canvasThermal.getContext('2d');
      const tw = canvasThermal.width;
      const th = canvasThermal.height;

      // Base cold ambient gradient
      const tGrad = tCtx.createRadialGradient(tw / 2, th / 2, 50, tw / 2, th / 2, tw / 2);
      tGrad.addColorStop(0, '#0a0a2e');
      tGrad.addColorStop(1, '#020208');
      tCtx.fillStyle = tGrad;
      tCtx.fillRect(0, 0, tw, th);

      // Render thermal hotspot
      if (state.activeScenario === 'fire_smoke' || state.activeScenario === 'high_heat') {
        const hx = tw * 0.62;
        const hy = th * 0.45;
        const hRadius = state.activeScenario === 'fire_smoke' ? 90 : 50;

        const hotspotGrad = tCtx.createRadialGradient(hx, hy, 4, hx, hy, hRadius);
        hotspotGrad.addColorStop(0, '#ffffff'); // >350°C
        hotspotGrad.addColorStop(0.2, '#ffff00'); // ~280°C
        hotspotGrad.addColorStop(0.4, '#ff3b30'); // ~200°C
        hotspotGrad.addColorStop(0.7, '#9d4edd'); // ~100°C
        hotspotGrad.addColorStop(1, 'rgba(10, 10, 46, 0)');

        tCtx.fillStyle = hotspotGrad;
        tCtx.beginPath();
        tCtx.arc(hx, hy, hRadius, 0, Math.PI * 2);
        tCtx.fill();

        // Radiometric Spot Meter crosshair
        tCtx.strokeStyle = '#ffffff';
        tCtx.lineWidth = 1;
        tCtx.strokeRect(hx - 20, hy - 20, 40, 40);
        tCtx.fillStyle = '#ffffff';
        tCtx.font = 'bold 12px monospace';
        tCtx.fillText('HOTSPOT: 348.6°C', hx - 40, hy - 28);
      }
    }

    // 3. Render Tactical Vector Map Canvas
    if (canvasMap) {
      const mCtx = canvasMap.getContext('2d');
      const mw = canvasMap.width;
      const mh = canvasMap.height;

      // Dark tactical map background with grid
      mCtx.fillStyle = '#0a0f18';
      mCtx.fillRect(0, 0, mw, mh);

      mCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      mCtx.lineWidth = 1;
      const gridSize = 40;
      for (let x = 0; x < mw; x += gridSize) {
        mCtx.beginPath();
        mCtx.moveTo(x, 0);
        mCtx.lineTo(x, mh);
        mCtx.stroke();
      }
      for (let y = 0; y < mh; y += gridSize) {
        mCtx.beginPath();
        mCtx.moveTo(0, y);
        mCtx.lineTo(mw, y);
        mCtx.stroke();
      }

      // Home base coordinates marker
      const homeX = mw * 0.3;
      const homeY = mh * 0.7;
      mCtx.fillStyle = '#00f076';
      mCtx.beginPath();
      mCtx.arc(homeX, homeY, 6, 0, Math.PI * 2);
      mCtx.fill();
      mCtx.fillStyle = '#8a96aa';
      mCtx.font = '10px monospace';
      mCtx.fillText('HOME BASE (PILOT)', homeX + 10, homeY + 4);

      // Drone Position & Heading Cone
      const droneX = mw * 0.52 + Math.sin(tick * 0.2) * 20;
      const droneY = mh * 0.48 + Math.cos(tick * 0.2) * 15;

      // Heading cone
      mCtx.fillStyle = 'rgba(0, 229, 255, 0.15)';
      mCtx.beginPath();
      mCtx.moveTo(droneX, droneY);
      mCtx.arc(droneX, droneY, 60, -0.6, 0.6);
      mCtx.closePath();
      mCtx.fill();

      // Drone icon
      mCtx.fillStyle = '#00e5ff';
      mCtx.beginPath();
      mCtx.moveTo(droneX, droneY - 10);
      mCtx.lineTo(droneX + 8, droneY + 8);
      mCtx.lineTo(droneX, droneY + 4);
      mCtx.lineTo(droneX - 8, droneY + 8);
      mCtx.closePath();
      mCtx.fill();

      // Pulsing Fire Incident Marker
      if (state.activeScenario === 'fire_smoke') {
        const fireMapX = mw * 0.7;
        const fireMapY = mh * 0.35;
        const pulseR = 12 + Math.sin(tick * 3) * 6;

        mCtx.strokeStyle = 'rgba(255, 59, 48, 0.8)';
        mCtx.lineWidth = 2;
        mCtx.beginPath();
        mCtx.arc(fireMapX, fireMapY, pulseR, 0, Math.PI * 2);
        mCtx.stroke();

        mCtx.fillStyle = '#ff3b30';
        mCtx.beginPath();
        mCtx.arc(fireMapX, fireMapY, 6, 0, Math.PI * 2);
        mCtx.fill();

        mCtx.fillStyle = '#ff6b00';
        mCtx.font = 'bold 11px monospace';
        mCtx.fillText('INCIDENT #101 [348°C]', fireMapX + 14, fireMapY + 4);
      }
    }

    requestAnimationFrame(renderFrame);
  }

  requestAnimationFrame(renderFrame);

  // Wire scenario and AI controls
  const selScenario = document.getElementById('select-cam-scenario');
  if (selScenario) {
    selScenario.addEventListener('change', (e) => {
      state.activeScenario = e.target.value;
      logEvent('SYSTEM', `Camera simulation scenario set to: ${state.activeScenario}`);
    });
  }

  const btnToggleAi = document.getElementById('btn-toggle-ai-boxes');
  if (btnToggleAi) {
    btnToggleAi.addEventListener('click', () => {
      state.showAiBoxes = !state.showAiBoxes;
      btnToggleAi.textContent = `AI Bounding Boxes: ${state.showAiBoxes ? 'ON' : 'OFF'}`;
      btnToggleAi.classList.toggle('active', state.showAiBoxes);
    });
  }
}

// ========================================================
// FLIGHT CONTROLS & SAFETY INTERLOCKS
// ========================================================
function initFlightControls() {
  const arena = document.getElementById('joystick-arena');
  const thumb = document.getElementById('joystick-thumb');
  const sliderThrottle = document.getElementById('slider-throttle');
  const throttlePct = document.getElementById('throttle-pct-label');
  const throttleState = document.getElementById('throttle-armed-state');
  const rollVal = document.getElementById('stick-roll-val');
  const pitchVal = document.getElementById('stick-pitch-val');

  // Virtual Joystick Drag Handling
  if (arena && thumb) {
    let isDragging = false;
    const maxRadius = 80;

    function handleStickMove(clientX, clientY) {
      const rect = arena.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      let dx = clientX - centerX;
      let dy = clientY - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }

      thumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

      // Normalize to [-1.0, 1.0]
      const normRoll = dx / maxRadius;
      const normPitch = -dy / maxRadius; // Up is positive forward pitch

      const sanitized = sanitizeManualInput({
        roll: normRoll,
        pitch: normPitch,
        yaw: state.sticks.yaw,
        throttle: state.sticks.throttle,
        isArmed: state.isArmed
      });

      state.sticks.roll = sanitized.roll;
      state.sticks.pitch = sanitized.pitch;

      if (rollVal) rollVal.textContent = sanitized.roll.toFixed(2);
      if (pitchVal) pitchVal.textContent = sanitized.pitch.toFixed(2);

      updateAttitudeGauges(sanitized.roll, sanitized.pitch);
    }

    function resetStick() {
      isDragging = false;
      thumb.style.transform = 'translate(-50%, -50%)';
      state.sticks.roll = 0.0;
      state.sticks.pitch = 0.0;
      if (rollVal) rollVal.textContent = '0.00';
      if (pitchVal) pitchVal.textContent = '0.00';
      updateAttitudeGauges(0, 0);
    }

    arena.addEventListener('pointerdown', (e) => {
      isDragging = true;
      arena.setPointerCapture(e.pointerId);
      handleStickMove(e.clientX, e.clientY);
    });

    arena.addEventListener('pointermove', (e) => {
      if (isDragging) handleStickMove(e.clientX, e.clientY);
    });

    arena.addEventListener('pointerup', resetStick);
    arena.addEventListener('pointercancel', resetStick);
  }

  // Throttle Safety Slider
  if (sliderThrottle && throttlePct) {
    sliderThrottle.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (!state.isArmed) {
        // Enforce zero throttle when disarmed
        sliderThrottle.value = 0;
        throttlePct.textContent = '0%';
        if (throttleState) throttleState.textContent = 'DISARMED LOCKED';
        return;
      }

      state.sticks.throttle = val / 100.0;
      throttlePct.textContent = `${val}%`;
      if (throttleState) throttleState.textContent = 'ARMED ACTIVE';
    });
  }

  // Yaw step buttons
  const btnYawLeft = document.getElementById('btn-yaw-left');
  const btnYawCenter = document.getElementById('btn-yaw-center');
  const btnYawRight = document.getElementById('btn-yaw-right');
  if (btnYawLeft && btnYawRight && btnYawCenter) {
    btnYawLeft.addEventListener('click', () => { state.sticks.yaw = -0.5; logEvent('COMMAND', 'Yaw Left step commanded'); });
    btnYawCenter.addEventListener('click', () => { state.sticks.yaw = 0.0; logEvent('COMMAND', 'Yaw centered'); });
    btnYawRight.addEventListener('click', () => { state.sticks.yaw = 0.5; logEvent('COMMAND', 'Yaw Right step commanded'); });
  }

  // Arming Modal & Slide to Arm Flow
  const btnOpenArm = document.getElementById('btn-open-arming');
  const modalArm = document.getElementById('modal-arming');
  const btnCloseArm = document.getElementById('btn-close-arming-modal');
  const slideThumb = document.getElementById('slide-thumb');
  const slideTrack = document.getElementById('slide-track');

  if (btnOpenArm && modalArm) {
    btnOpenArm.addEventListener('click', () => {
      if (state.isArmed) {
        // Disarm directly
        disarmDrone();
      } else {
        modalArm.classList.remove('hidden');
      }
    });

    if (btnCloseArm) {
      btnCloseArm.addEventListener('click', () => modalArm.classList.add('hidden'));
    }

    // Slide to Arm gesture
    if (slideThumb && slideTrack) {
      let slideDragging = false;
      slideThumb.addEventListener('pointerdown', (e) => {
        slideDragging = true;
        slideThumb.setPointerCapture(e.pointerId);
      });

      slideThumb.addEventListener('pointermove', (e) => {
        if (!slideDragging) return;
        const trackRect = slideTrack.getBoundingClientRect();
        const maxSlide = trackRect.width - 52;
        let offset = e.clientX - trackRect.left - 23;
        offset = Math.max(3, Math.min(maxSlide, offset));
        slideThumb.style.left = `${offset}px`;

        if (offset >= maxSlide - 6) {
          // Trigger arming
          slideDragging = false;
          armDrone();
          modalArm.classList.add('hidden');
          slideThumb.style.left = '3px';
        }
      });

      slideThumb.addEventListener('pointerup', () => {
        slideDragging = false;
        slideThumb.style.left = '3px';
      });
    }
  }

  // Emergency Stop Buttons (Header + Flight Screen)
  const btnEstopHeader = document.getElementById('btn-emergency-header');
  const btnFlightEstop = document.getElementById('btn-flight-estop');
  [btnEstopHeader, btnFlightEstop].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', triggerEmergencyStop);
    }
  });
}

function armDrone() {
  state.isArmed = true;
  state.telemetry.flight.armed = true;
  state.telemetry.flight.mode = 'manual';

  const btnOpenArm = document.getElementById('btn-open-arming');
  if (btnOpenArm) btnOpenArm.textContent = 'DISARM DRONE (Simulated)';

  logEvent('COMMAND', 'Drone ARMED with confirmation token PILOT-CONFIRM-SAFE');
  renderTelemetryUI();
}

function disarmDrone() {
  state.isArmed = false;
  state.sticks.throttle = 0.0;
  state.telemetry.flight.armed = false;
  state.telemetry.flight.mode = 'disarmed';

  const sliderThrottle = document.getElementById('slider-throttle');
  const throttlePct = document.getElementById('throttle-pct-label');
  if (sliderThrottle) sliderThrottle.value = 0;
  if (throttlePct) throttlePct.textContent = '0%';

  const btnOpenArm = document.getElementById('btn-open-arming');
  if (btnOpenArm) btnOpenArm.textContent = 'ARM DRONE (Simulated)';

  logEvent('COMMAND', 'Drone DISARMED. Throttle reset to 0%');
  renderTelemetryUI();
}

function triggerEmergencyStop() {
  disarmDrone();
  logEvent('COMMAND', 'EMERGENCY MOTOR CUT TRIGGERED! All outputs commanded to 0.');
  alert('EMERGENCY STOP EXECUTED: Throttle cut to 0.0. Flight mode set to DISARMED.');
}

function updateAttitudeGauges(roll, pitch) {
  const dialRoll = document.getElementById('dial-roll');
  const dialPitch = document.getElementById('dial-pitch');
  if (dialRoll) dialRoll.style.transform = `rotate(${roll * 30}deg)`;
  if (dialPitch) dialPitch.style.transform = `rotate(${pitch * 30}deg)`;

  const valAttitude = document.getElementById('val-attitude');
  if (valAttitude) {
    valAttitude.textContent = `R: ${(roll * 25).toFixed(1)}° | P: ${(pitch * 25).toFixed(1)}°`;
  }
}

// ========================================================
// AUDIO ALERTS & SOUND SYNTHESIZER
// ========================================================
function initAudio() {
  const btnMute = document.getElementById('btn-audio-mute');
  const iconMute = document.getElementById('mute-icon');
  const btnTest = document.getElementById('btn-test-siren');

  if (btnMute && iconMute) {
    btnMute.addEventListener('click', () => {
      state.isAudioMuted = !state.isAudioMuted;
      iconMute.textContent = state.isAudioMuted ? '🔕' : '🔔';
      logEvent('SYSTEM', `Tactical buzzer alarm ${state.isAudioMuted ? 'MUTED' : 'UNMUTED'}`);
    });
  }

  if (btnTest) {
    btnTest.addEventListener('click', () => {
      logEvent('SYSTEM', 'Testing onboard piezo alert buzzer...');
      playBuzzer(true);
    });
  }
}

function playBuzzer(force = false) {
  if (state.isAudioMuted && !force) return;
  synthesizeBuzzerBeep();
}

function synthesizeBuzzerBeep() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    // High-frequency dual-chirp electronic buzzer pulse (2400 Hz -> 2800 Hz)
    const now = audioCtx.currentTime;

    // Chirp 1
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'square';
    osc1.frequency.setValueAtTime(2400, now);
    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.12);

    // Chirp 2
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(2800, now + 0.16);
    gain2.gain.setValueAtTime(0.2, now + 0.16);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.28);
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.start(now + 0.16);
    osc2.stop(now + 0.28);
  } catch (e) {
    // Audio context not allowed or blocked by policy
  }
}

// ========================================================
// SETTINGS & WEBSOCKET GATEWAY CONNECTION
// ========================================================
function initSettings() {
  const selMode = document.getElementById('conn-mode-select');
  const btnConnect = document.getElementById('btn-ws-connect');
  const btnDisconnect = document.getElementById('btn-ws-disconnect');
  const inputUrl = document.getElementById('input-ws-url');
  const wsStatus = document.getElementById('ws-status-msg');
  const connPill = document.getElementById('conn-pill');
  const connLabel = document.getElementById('conn-label');

  if (selMode) {
    selMode.addEventListener('change', (e) => {
      state.isSimulation = e.target.value === 'simulation';
      const simPill = document.getElementById('sim-badge');
      if (simPill) simPill.classList.toggle('active', state.isSimulation);
      logEvent('SYSTEM', `Operation mode switched to: ${e.target.value}`);
    });
  }

  if (btnConnect && inputUrl) {
    btnConnect.addEventListener('click', () => {
      const url = inputUrl.value.trim();
      logEvent('SYSTEM', `Attempting WebSocket connection to ${url}...`);
      if (wsStatus) wsStatus.textContent = `Connecting to ${url}...`;

      try {
        if (webSocket) webSocket.close();
        webSocket = new WebSocket(url);

        webSocket.onopen = () => {
          state.isConnected = true;
          state.isSimulation = false;
          if (wsStatus) wsStatus.textContent = 'CONNECTED to ESP32 Gateway WebSocket.';
          if (connPill) connPill.className = 'status-pill status-armed';
          if (connLabel) connLabel.textContent = 'CONNECTED';
          logEvent('SYSTEM', `WebSocket link established with ${url}`);
        };

        webSocket.onmessage = (event) => {
          try {
            const parsed = parseIncomingPacket(event.data);
            if (parsed.type === 'telemetry') {
              state.telemetry = parsed;
              state.lastTelemetryTimestamp = Date.now();
              renderTelemetryUI();
            }
          } catch (err) {
            console.error('Failed to parse incoming telemetry packet:', err);
          }
        };

        webSocket.onerror = (err) => {
          if (wsStatus) wsStatus.textContent = 'WebSocket connection error. Check Wi-Fi SoftAP connection.';
          logEvent('SYSTEM', `WebSocket error connecting to ${url}`);
        };

        webSocket.onclose = () => {
          state.isConnected = false;
          if (wsStatus) wsStatus.textContent = 'WebSocket disconnected.';
          if (connPill) connPill.className = 'status-pill status-disarmed';
          if (connLabel) connLabel.textContent = 'DISCONNECTED';
          logEvent('SYSTEM', 'WebSocket connection closed.');
        };
      } catch (err) {
        if (wsStatus) wsStatus.textContent = `Connection failed: ${err.message}`;
      }
    });
  }

  if (btnDisconnect) {
    btnDisconnect.addEventListener('click', () => {
      if (webSocket) {
        webSocket.close();
        webSocket = null;
      }
      state.isSimulation = true;
      if (wsStatus) wsStatus.textContent = 'Disconnected. Returned to Simulation Mode.';
      logEvent('SYSTEM', 'Manually disconnected from gateway.');
    });
  }
}

// ========================================================
// LOGGING & EXPORT UTILITIES
// ========================================================
function logEvent(tag, message) {
  const entry = {
    timestamp: new Date().toLocaleTimeString(),
    tag,
    message
  };
  state.eventLog.unshift(entry);
  if (state.eventLog.length > 200) state.eventLog.pop();

  const viewer = document.getElementById('log-viewer');
  if (viewer) {
    const line = document.createElement('div');
    line.className = 'log-line';
    const tagClass = tag === 'ALERT' ? 'tag-alert' : (tag === 'COMMAND' ? 'tag-command' : 'tag-system');
    line.innerHTML = `
      <span class="log-ts">[${entry.timestamp}]</span>
      <span class="log-tag ${tagClass}">${entry.tag}</span>
      <span class="log-msg">${escapeHtml(entry.message)}</span>
    `;
    viewer.prepend(line);
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Export incident report JSON
const btnExportIncidents = document.getElementById('btn-export-incidents');
if (btnExportIncidents) {
  btnExportIncidents.addEventListener('click', () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(state.incidents, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `skyfighter_incidents_${Date.now()}.json`);
    dlAnchor.click();
    logEvent('SYSTEM', 'Exported incidents report JSON');
  });
}

// Export event history CSV
const btnExportLog = document.getElementById('btn-export-log');
if (btnExportLog) {
  btnExportLog.addEventListener('click', () => {
    let csv = 'Timestamp,Category,Message\n';
    state.eventLog.forEach(row => {
      csv += `"${row.timestamp}","${row.tag}","${row.message.replace(/"/g, '""')}"\n`;
    });
    const dataStr = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `skyfighter_log_${Date.now()}.csv`);
    dlAnchor.click();
    logEvent('SYSTEM', 'Exported event log CSV');
  });
}
