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
  isSimulation: false, // Default FALSE: wait until real drone connects via Wi-Fi
  isConnected: false,  // Default FALSE: wait for live telemetry packets
  isArmed: false,
  isAudioMuted: false,
  telemetryAgeMs: 0,
  lastTelemetryTimestamp: 0,
  commandSequence: 1,
  clientId: 'SKYFIGHTER-GCS-01',
  activeScenario: 'clear_forest',
  showAiBoxes: true,
  aiConfidenceThreshold: 0.65,
  thermalPalette: 'ironbow',
  thermalMaxTriggerC: 85,
  
  // Camera & Edge AI Vision State
  cameraActive: false,
  cameraSource: 'webcam', // 'webcam', 'python_gcs', 'simulation'
  cameraStream: null,
  waterPumpSprayActive: false,
  waterPumpCountdown: 0.0,
  waterPumpCooldown: 0.0,
  targetFireLocked: false,
  
  // Pilot Flight Sticks
  sticks: {
    roll: 0.0,
    pitch: 0.0,
    yaw: 0.0,
    throttle: 0.0
  },
  
  // Telemetry Snapshot (Standby: no fake observations)
  telemetry: {
    version: 1,
    type: 'telemetry',
    sequence: 0,
    timestamp_ms: 0,
    connection: 'waiting',
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
        simulation_mode: false
      }
    },
    sensors: {
      temperature_c: null,
      humidity_pct: null,
      mq2_adc: null,
      flame_detected: null,
      mpu_connected: false,
      mpu_temperature_c: null
    },
    gps: {
      valid: false,
      latitude: null,
      longitude: null,
      satellites: 0,
      altitude_m: null
    },
    battery: {
      voltage_v: null, // Unwired in physical hardware
      percentage: null
    },
    alerts: [],
    ai_detections: []
  },
  
  // Incident queue: empty on startup (no fake fires)
  incidents: [],
  
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
let reconnectTimer = null;

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
  initSerialConnection();
  initAutoConnect();
  renderTelemetryUI();
  logEvent('SYSTEM', 'SKYFIGHTER GCS v1.1 initialized. Standby mode active — waiting for drone connection.');
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

  // Quick triage button in hazard banner -> Connection screen
  const btnQuickTriage = document.getElementById('btn-quick-triage');
  if (btnQuickTriage) {
    btnQuickTriage.addEventListener('click', () => switchScreen('connection'));
  }

  // Header Demo / Simulation Toggle Button
  const btnSimToggle = document.getElementById('btn-sim-toggle');
  if (btnSimToggle) {
    btnSimToggle.addEventListener('click', () => {
      state.isSimulation = !state.isSimulation;
      const selMode = document.getElementById('conn-mode-select');
      if (selMode) {
        selMode.value = state.isSimulation ? 'simulation' : 'websocket';
      }
      if (state.isSimulation) {
        logEvent('SYSTEM', 'Demo Simulation Mode manually ENABLED by pilot.');
      } else {
        logEvent('SYSTEM', 'Demo Simulation Mode DISABLED. Awaiting live drone Wi-Fi telemetry.');
        if (!state.isConnected) {
          state.telemetry.sensors = {
            temperature_c: null,
            humidity_pct: null,
            mq2_adc: null,
            flame_detected: null,
            mpu_connected: false,
            mpu_temperature_c: null
          };
          state.telemetry.gps = {
            valid: false,
            latitude: null,
            longitude: null,
            satellites: 0,
            altitude_m: null
          };
        }
      }
      renderTelemetryUI();
    });
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
  // Only record incidents if connected to live drone or simulation is manually enabled
  if (!state.isConnected && !state.isSimulation) return;
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

  const isLive = state.isConnected;
  const isSim = state.isSimulation;

  const connPill = document.getElementById('conn-pill');
  const connLabel = document.getElementById('conn-label');
  const armedPill = document.getElementById('armed-pill');
  const armedLabel = document.getElementById('armed-label');
  const gpsPill = document.getElementById('gps-pill');
  const gpsLabel = document.getElementById('gps-label');
  const simBadge = document.getElementById('sim-badge');
  const simToggleBtn = document.getElementById('btn-sim-toggle');
  const simToggleLabel = document.getElementById('sim-toggle-label');
  const latencyEl = document.getElementById('latency-text');

  // Update sim toggle button text & style
  if (simToggleLabel) {
    simToggleLabel.textContent = isSim ? 'Demo: ON' : 'Demo: OFF';
  }
  if (simToggleBtn) {
    simToggleBtn.classList.toggle('active', isSim);
  }

  if (!isLive && !isSim) {
    // ----------------------------------------------------
    // STANDBY DISCONNECTED STATE (Drone not connected)
    // ----------------------------------------------------
    if (connPill && connLabel) {
      connPill.className = 'status-pill status-disconnected';
      connLabel.textContent = 'NOT CONNECTED';
    }
    if (armedPill && armedLabel) {
      armedPill.className = 'status-pill status-disarmed';
      armedLabel.textContent = 'DISCONNECTED';
    }
    if (gpsPill && gpsLabel) {
      gpsPill.className = 'status-pill status-disarmed';
      gpsLabel.textContent = 'GPS: OFFLINE';
    }
    if (simBadge) {
      simBadge.textContent = 'DRONE NOT CONNECTED';
      simBadge.className = 'sim-pill disconnected';
    }
    if (latencyEl) {
      latencyEl.textContent = 'LINK: DISCONNECTED (192.168.4.1)';
    }

    // Dashboard values: disconnected placeholders
    setElemText('val-temp', '-- °C');
    setElemStyle('bar-temp', 'width', '0%');
    setElemText('sub-temp', 'Drone not connected');

    setElemText('val-humidity', '-- %');
    setElemStyle('bar-humidity', 'width', '0%');
    setElemText('sub-humidity', 'Drone not connected');

    setElemText('val-smoke', '-- ADC');
    setElemStyle('bar-smoke', 'width', '0%');
    setElemText('sub-smoke', 'Drone not connected');

    const valFlame = document.getElementById('val-flame');
    if (valFlame) {
      valFlame.textContent = 'NOT CONNECTED';
      valFlame.className = 'metric-value text-dim';
    }
    setElemText('sub-flame', 'Sensor offline');

    setElemText('val-attitude', 'NOT CONNECTED');
    setElemText('sub-mpu', 'IMU offline');

    setElemText('val-coords', 'NOT CONNECTED');
    setElemText('sub-gps', 'GPS offline');

    // Standby Hazard Banner
    const banner = document.getElementById('dashboard-hazard-banner');
    const hTitle = document.getElementById('hazard-title');
    const hDesc = document.getElementById('hazard-desc');
    const hIcon = document.getElementById('hazard-icon');
    if (banner && hTitle && hDesc && hIcon) {
      banner.className = 'hazard-banner banner-disconnected';
      hTitle.textContent = 'DRONE NOT CONNECTED';
      hDesc.textContent = 'No live telemetry stream detected. Connect device to drone Wi-Fi (SKYFIGHTER_GATEWAY) or connect via USB. Real sensor data will appear once connected.';
      hIcon.textContent = '📡';
    }

    // Map Standby Readouts
    setElemText('map-lat', '--');
    setElemText('map-lon', '--');
    setElemText('map-alt', '--');
    setElemText('map-sats', 'GPS Offline');
    setElemText('map-drone-pos', 'DRONE: NOT CONNECTED');

    // Diagnostics Standby Readouts
    setElemText('diag-accel', '-- / -- / --');
    setElemText('diag-gyro', '-- / -- / --');
    setElemText('diag-mpu-temp', '-- °C');
    setElemText('diag-mpu-ack', 'Drone not connected');
    setElemClass('badge-mpu', 'diag-badge-warn');
    setElemText('badge-mpu', 'OFFLINE');

    setElemText('diag-dht-temp', '-- °C');
    setElemText('diag-dht-humidity', '-- %');
    setElemText('diag-dht-valid', 'Drone not connected');
    setElemClass('badge-dht', 'diag-badge-warn');
    setElemText('badge-dht', 'OFFLINE');

    setElemText('diag-mq2-raw', '-- / 4095');
    setElemText('diag-mq2-base', '--');
    setElemText('diag-mq2-delta', 'Drone not connected');
    setElemClass('badge-mq2', 'diag-badge-warn');
    setElemText('badge-mq2', 'OFFLINE');

    setElemText('diag-flame-pin', 'Offline');
    setElemText('diag-flame-status', 'NOT CONNECTED');
    setElemClass('badge-flame', 'diag-badge-warn');
    setElemText('badge-flame', 'OFFLINE');

    setElemText('diag-gps-sats', '--');
    setElemText('diag-gps-age', '--');
    setElemClass('badge-gps', 'diag-badge-warn');
    setElemText('badge-gps', 'OFFLINE');

    // Clear any fake incidents when disconnected
    state.incidents = [];
    updateAlertCounter();
    renderIncidentsTable();
    return;
  }

  // ----------------------------------------------------
  // ACTIVE STATE (Connected to Drone or Demo Simulation)
  // ----------------------------------------------------
  if (connPill && connLabel) {
    if (isLive) {
      connPill.className = 'status-pill status-connected';
      connLabel.textContent = 'CONNECTED (ESP32)';
    } else {
      connPill.className = 'status-pill status-simulated';
      connLabel.textContent = 'SIMULATION ACTIVE';
    }
  }

  if (simBadge) {
    simBadge.textContent = isSim ? 'DEMO SIMULATION' : 'LIVE DRONE LINK';
    simBadge.className = isSim ? 'sim-pill active' : 'sim-pill';
  }

  if (armedPill && armedLabel) {
    armedPill.className = `status-pill ${f.armed ? 'status-armed' : 'status-disarmed'}`;
    armedLabel.textContent = f.armed ? (isSim ? 'ARMED (SIM)' : 'ARMED') : 'DISARMED';
  }

  // Temperature
  if (s && s.temperature_c !== null) {
    setElemText('val-temp', `${s.temperature_c} °C`);
    const tPct = Math.min(100, Math.max(0, (s.temperature_c / 60) * 100));
    setElemStyle('bar-temp', 'width', `${tPct}%`);
    setElemText('sub-temp', s.temperature_c > 45 ? 'Elevated ambient heat' : 'Nominal canopy temperature');
  } else {
    setElemText('val-temp', '-- °C');
    setElemStyle('bar-temp', 'width', '0%');
  }

  // Humidity
  if (s && s.humidity_pct !== null) {
    setElemText('val-humidity', `${s.humidity_pct} %`);
    const hPct = Math.min(100, Math.max(0, s.humidity_pct));
    setElemStyle('bar-humidity', 'width', `${hPct}%`);
    setElemText('sub-humidity', s.humidity_pct < 30 ? 'Dry fuel condition (<30%)' : 'Nominal relative humidity');
  } else {
    setElemText('val-humidity', '-- %');
    setElemStyle('bar-humidity', 'width', '0%');
  }

  // Smoke / MQ-2
  if (s && s.mq2_adc !== null) {
    setElemText('val-smoke', `${s.mq2_adc} ADC`);
    const sPct = Math.min(100, Math.max(0, (s.mq2_adc / 4095) * 100));
    setElemStyle('bar-smoke', 'width', `${sPct}%`);
    setElemText('sub-smoke', s.mq2_adc > 900 ? 'High combustion gas level!' : 'Clean air baseline');
  } else {
    setElemText('val-smoke', '-- ADC');
    setElemStyle('bar-smoke', 'width', '0%');
  }

  // Flame
  const valFlame = document.getElementById('val-flame');
  if (valFlame) {
    if (s && s.flame_detected === true) {
      valFlame.textContent = 'ACTIVE FLAME!';
      valFlame.className = 'metric-value flame-alert';
      setElemText('sub-flame', 'Optical IR wavelength triggered');
    } else if (s && s.flame_detected === false) {
      valFlame.textContent = 'CLEAR';
      valFlame.className = 'metric-value flame-safe';
      setElemText('sub-flame', 'No optical flame detected');
    } else {
      valFlame.textContent = 'WAITING';
      valFlame.className = 'metric-value text-dim';
      setElemText('sub-flame', 'Awaiting optical sensor packet...');
    }
  }

  // IMU Attitude
  setElemText('val-attitude', s && s.mpu_connected ? 'CALIBRATED' : 'OFFLINE');
  setElemText('sub-mpu', s && s.mpu_connected ? `Chip Temp: ${s.mpu_temperature_c ? s.mpu_temperature_c.toFixed(1) : 31.4}°C` : 'Check I2C 0x68 bus');

  // GPS
  if (g && g.valid && g.latitude !== null && g.longitude !== null) {
    setElemText('val-coords', `${g.latitude.toFixed(6)}, ${g.longitude.toFixed(6)}`);
    setElemText('sub-gps', `Alt: ${g.altitude_m}m | Sats: ${g.satellites}`);
    setElemText('map-lat', `${g.latitude.toFixed(6)}°`);
    setElemText('map-lon', `${g.longitude.toFixed(6)}°`);
    setElemText('map-alt', `${g.altitude_m} m`);
    setElemText('map-sats', `${g.satellites} Locked (3D Fix)`);
    setElemText('map-drone-pos', `DRONE: ${g.latitude.toFixed(6)} N, ${g.longitude.toFixed(6)} E`);
    if (gpsPill && gpsLabel) {
      gpsPill.className = 'status-pill status-armed';
      gpsLabel.textContent = `GPS: 3D FIX (${g.satellites})`;
    }
  } else {
    setElemText('val-coords', 'NO GPS FIX');
    setElemText('sub-gps', 'Antenna outdoors required');
    if (gpsPill && gpsLabel) {
      gpsPill.className = 'status-pill status-disarmed';
      gpsLabel.textContent = 'GPS: NO FIX';
    }
  }

  // Hazard banner evaluation
  const hazard = evaluateCompositeHazard(s, isLive || isSim, false);
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

  // Diagnostics screen updates
  setElemText('diag-accel', s && s.mpu_connected ? '0.01g / 0.02g / 0.98g' : '-- / -- / --');
  setElemText('diag-gyro', s && s.mpu_connected ? '0.12°/s / -0.05°/s / 0.00°/s' : '-- / -- / --');
  setElemText('diag-mpu-temp', s && s.mpu_temperature_c !== null ? `${s.mpu_temperature_c.toFixed(1)} °C` : '-- °C');
  setElemText('diag-mpu-ack', s && s.mpu_connected ? '0x00 SUCCESS' : 'BUS ERROR');
  setElemClass('badge-mpu', s && s.mpu_connected ? 'diag-badge-ok' : 'diag-badge-warn');
  setElemText('badge-mpu', s && s.mpu_connected ? 'HEALTHY' : 'OFFLINE');

  setElemText('diag-dht-temp', s && s.temperature_c !== null ? `${s.temperature_c} °C` : 'READ ERROR');
  setElemText('diag-dht-humidity', s && s.humidity_pct !== null ? `${s.humidity_pct} %` : 'READ ERROR');
  setElemText('diag-dht-valid', s && s.temperature_c !== null ? 'VALID' : 'CRC ERROR');
  setElemClass('badge-dht', s && s.temperature_c !== null ? 'diag-badge-ok' : 'diag-badge-warn');
  setElemText('badge-dht', s && s.temperature_c !== null ? 'HEALTHY' : 'OFFLINE');

  setElemText('diag-mq2-raw', s && s.mq2_adc !== null ? `${s.mq2_adc} / 4095` : 'OFFLINE');
  setElemText('diag-mq2-base', s && s.mq2_adc !== null ? '350' : '--');
  setElemText('diag-mq2-delta', s && s.mq2_adc !== null ? `+${Math.max(0, s.mq2_adc - 350)} ADC` : '--');
  setElemClass('badge-mq2', s && s.mq2_adc !== null ? 'diag-badge-ok' : 'diag-badge-warn');
  setElemText('badge-mq2', s && s.mq2_adc !== null ? 'CALIBRATED' : 'OFFLINE');

  setElemText('diag-flame-pin', s && s.flame_detected !== null ? (s.flame_detected ? 'LOW (TRIGGERED)' : 'HIGH (Inactive)') : 'OFFLINE');
  setElemText('diag-flame-status', s && s.flame_detected ? 'FLAME DETECTED' : 'NO FLAME DETECTED');
  setElemClass('badge-flame', s && s.flame_detected !== null ? 'diag-badge-ok' : 'diag-badge-warn');
  setElemText('badge-flame', s && s.flame_detected !== null ? 'MONITORING' : 'OFFLINE');

  setElemText('diag-gps-sats', g && g.satellites ? `${g.satellites}` : '0');
  setElemText('diag-gps-age', g && g.valid ? '420 ms' : 'NO FIX');
  setElemClass('badge-gps', g && g.valid ? 'diag-badge-ok' : 'diag-badge-warn');
  setElemText('badge-gps', g && g.valid ? '3D FIX' : 'NO FIX');

  renderIncidentsTable();
}

function setElemText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setElemStyle(id, prop, val) {
  const el = document.getElementById(id);
  if (el) el.style[prop] = val;
}

function setElemClass(id, className) {
  const el = document.getElementById(id);
  if (el) el.className = className;
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

    const isLive = state.isConnected;
    const isSim = state.isSimulation;

    // Helper: draw tactical standby HUD
    function drawStandbyHUD(ctx, w, h, title, subtitle, info) {
      ctx.fillStyle = '#070a12';
      ctx.fillRect(0, 0, w, h);

      // Subtle tactical grid
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.05)';
      ctx.lineWidth = 1;
      const step = 32;
      for (let x = 0; x < w; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      const cx = w / 2;
      const cy = h / 2 - 20;
      const sweepR = 40;
      const pulse = Math.sin(tick * 2) * 3;

      // Outer sweep ring
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, sweepR + pulse, 0, Math.PI * 2);
      ctx.stroke();

      // Inner sweep ring
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.12)';
      ctx.beginPath();
      ctx.arc(cx, cy, sweepR * 0.5, 0, Math.PI * 2);
      ctx.stroke();

      // Rotating radar sweep
      const angle = tick * 1.8;
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * (sweepR + pulse), cy + Math.sin(angle) * (sweepR + pulse));
      ctx.stroke();

      // Crosshairs
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - sweepR - 12, cy); ctx.lineTo(cx - sweepR - 2, cy);
      ctx.moveTo(cx + sweepR + 2, cy); ctx.lineTo(cx + sweepR + 12, cy);
      ctx.moveTo(cx, cy - sweepR - 12); ctx.lineTo(cx, cy - sweepR - 2);
      ctx.moveTo(cx, cy + sweepR + 2); ctx.lineTo(cx, cy + sweepR + 12);
      ctx.stroke();

      // Text labels
      ctx.textAlign = 'center';
      ctx.fillStyle = '#00d4ff';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(title, cx, cy + sweepR + 30);

      ctx.fillStyle = '#8a96aa';
      ctx.font = '11px sans-serif';
      ctx.fillText(subtitle, cx, cy + sweepR + 48);

      ctx.fillStyle = 'rgba(255, 183, 3, 0.9)';
      ctx.font = '10px monospace';
      ctx.fillText(info, cx, cy + sweepR + 68);
      ctx.textAlign = 'left';
    }

    // Optical Fire & Smoke Analyzer Function
    let frameCheckTick = 0;
    let detectedFireBoxes = [];
    let firePersistenceCounter = 0;

    function analyzeFrameForFire(ctx, w, h) {
      frameCheckTick++;
      if (frameCheckTick % 4 === 0) {
        try {
          const step = 8;
          const imgData = ctx.getImageData(0, 0, w, h).data;
          let minX = w, maxX = 0, minY = h, maxY = 0;
          let firePixelCount = 0;

          for (let y = 0; y < h; y += step) {
            for (let x = 0; x < w; x += step) {
              const idx = (y * w + x) * 4;
              const r = imgData[idx];
              const g = imgData[idx + 1];
              const b = imgData[idx + 2];

              // Optical flame chromaticity signature
              if (r > 190 && g > 75 && b < 100 && r > (g + 35) && g > b) {
                firePixelCount++;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }

          if (firePixelCount >= 8 && (maxX - minX) > 20 && (maxY - minY) > 20) {
            firePersistenceCounter = Math.min(firePersistenceCounter + 1, 10);
            detectedFireBoxes = [{
              x: Math.max(0, minX - 15),
              y: Math.max(0, minY - 15),
              w: Math.min(w, maxX - minX + 30),
              h: Math.min(h, maxY - minY + 30),
              conf: Math.min(0.96, 0.70 + (firePixelCount * 0.005))
            }];
          } else {
            firePersistenceCounter = Math.max(firePersistenceCounter - 1, 0);
            if (firePersistenceCounter === 0) detectedFireBoxes = [];
          }
        } catch (e) {}
      }

      if (state.showAiBoxes) {
        for (const b of detectedFireBoxes) {
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 3;
          ctx.strokeRect(b.x, b.y, b.w, b.h);

          ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
          ctx.fillRect(b.x, Math.max(0, b.y - 24), 140, 22);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 12px monospace';
          ctx.fillText(`FIRE: ${b.conf.toFixed(2)} (AI)`, b.x + 5, Math.max(16, b.y - 8));
        }
      }

      const detectionTag = document.getElementById('ai-detection-tag');
      const classTags = document.getElementById('ai-class-tags');
      const sprayBtn = document.getElementById('btn-water-spray');

      if (firePersistenceCounter >= 3) {
        state.targetFireLocked = true;
        if (detectionTag) {
          detectionTag.className = 'detection-pill alert';
          detectionTag.textContent = `! FIRE ALERT: LOCKED (${firePersistenceCounter}/3) !`;
          detectionTag.style.background = '#ef4444';
          detectionTag.style.color = '#fff';
        }
        if (classTags) classTags.textContent = 'FIRE: 1 | SMOKE: 0 | HUMAN: 0 | ANIMAL: 0';
        if (sprayBtn && !state.waterPumpSprayActive) {
          sprayBtn.disabled = !state.isArmed;
          sprayBtn.textContent = state.isArmed ? 'ACTIVATE WATER SPRAY (3s)' : 'SPRAY (REQUIRES PILOT ARM)';
          sprayBtn.style.color = state.isArmed ? '#ffffff' : '#ef4444';
          sprayBtn.style.background = state.isArmed ? '#ef4444' : 'transparent';
        }
      } else {
        state.targetFireLocked = false;
        if (detectionTag) {
          detectionTag.className = 'detection-pill';
          detectionTag.textContent = firePersistenceCounter > 0 ? `VERIFYING TARGET: [${firePersistenceCounter}/3]` : 'AI INFERENCE: PATROL (NORMAL)';
          detectionTag.style.background = firePersistenceCounter > 0 ? '#f59e0b' : 'rgba(0, 212, 255, 0.2)';
          detectionTag.style.color = firePersistenceCounter > 0 ? '#000' : '#00d4ff';
        }
        if (classTags) classTags.textContent = 'TARGETS: 0';
        if (sprayBtn && !state.waterPumpSprayActive) {
          sprayBtn.disabled = true;
          sprayBtn.textContent = 'Water Spray (DISARMED)';
          sprayBtn.style.background = 'transparent';
          sprayBtn.style.color = '#ef4444';
        }
      }
    }

    // 1. Render RGB Aerial Canopy View
    if (canvasRgb) {
      const ctx = canvasRgb.getContext('2d', { willReadFrequently: true });
      const w = canvasRgb.width;
      const h = canvasRgb.height;

      if (state.cameraActive && state.cameraSource === 'webcam') {
        const videoEl = document.getElementById('webcam-video');
        if (videoEl && videoEl.readyState >= 2) {
          ctx.drawImage(videoEl, 0, 0, w, h);
          analyzeFrameForFire(ctx, w, h);
        } else {
          drawStandbyHUD(ctx, w, h, 'CONNECTING TO DEVICE CAMERA...', 'Authorizing video media stream from browser', 'DEVICE: LAPTOP WEBCAM / USB CAPTURE');
        }
      } else if (state.cameraActive && state.cameraSource === 'python_gcs') {
        const imgEl = document.getElementById('py-stream-img');
        if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
          ctx.drawImage(imgEl, 0, 0, w, h);
        } else {
          drawStandbyHUD(ctx, w, h, 'PYTHON YOLO GCS FEED — STANDBY', 'Waiting for http://localhost:5050/video_feed', 'RUN: python3 ai_pipeline/dashboard/app.py');
        }
      } else if (!isLive && !isSim && !state.cameraActive) {
        drawStandbyHUD(ctx, w, h, 'AERIAL RGB CAMERA — STANDBY', 'Click "Start Live Camera" or select Python GCS stream', 'SSID: SKYFIGHTER_GATEWAY | ws://192.168.4.1:8080');
      } else {
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

      // Render Water Spray Effect overlay if triggered
      if (state.waterPumpSprayActive) {
        state.waterPumpCountdown -= 0.03;
        if (state.waterPumpCountdown <= 0) {
          state.waterPumpSprayActive = false;
          state.waterPumpCountdown = 0;
          state.waterPumpCooldown = 5.0;
          logEvent('SYSTEM', 'Water spray sequence completed (3s). Cooling down.');
        }

        // Draw animated blue water droplets
        ctx.fillStyle = 'rgba(6, 182, 212, 0.7)';
        for (let p = 0; p < 25; p++) {
          const sx = w * 0.5 + (Math.sin(tick * 5 + p) * 120);
          const sy = h * 0.3 + ((tick * 15 + p * 20) % (h * 0.6));
          ctx.beginPath();
          ctx.arc(sx, sy, 4 + (p % 4), 0, Math.PI * 2);
          ctx.fill();
        }

        // Tactical HUD Banner
        ctx.fillStyle = 'rgba(6, 182, 212, 0.9)';
        ctx.fillRect(w / 2 - 160, h - 55, 320, 32);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`>>> WATER PUMP ACTIVE (${state.waterPumpCountdown.toFixed(1)}s) <<<`, w / 2, h - 34);
        ctx.textAlign = 'left';
      }
      if (state.waterPumpCooldown > 0) {
        state.waterPumpCooldown = Math.max(0, state.waterPumpCooldown - 0.03);
      }
    }
        }
      }
    }

    // 2. Render Thermal Radiometric Canvas (False-Color Ironbow)
    if (canvasThermal) {
      const tCtx = canvasThermal.getContext('2d');
      const tw = canvasThermal.width;
      const th = canvasThermal.height;

      if (!isLive && !isSim) {
        drawStandbyHUD(tCtx, tw, th, 'THERMAL PYROMETRY — STANDBY', 'Dual-Band Radiometric IR Sensor Offline', 'Awaiting real temperature observations...');
      } else {
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
    }

    // 3. Render Tactical Vector Map Canvas
    if (canvasMap) {
      const mCtx = canvasMap.getContext('2d');
      const mw = canvasMap.width;
      const mh = canvasMap.height;

      if (!isLive && !isSim) {
        drawStandbyHUD(mCtx, mw, mh, 'TACTICAL VECTOR MAP — STANDBY', 'Waiting for GPS telemetry from drone Wi-Fi', 'Antenna outdoors required for 3D fix');
      } else {
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
    }

    requestAnimationFrame(renderFrame);
  }

  requestAnimationFrame(renderFrame);

  // Wire scenario, camera and AI controls
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

  // Camera Setup and Toggle Handling
  const btnToggleCamera = document.getElementById('btn-toggle-camera');
  const selCamSource = document.getElementById('select-cam-source');
  const simGroup = document.getElementById('sim-scenario-group');
  const btnWaterSpray = document.getElementById('btn-water-spray');
  const videoEl = document.getElementById('webcam-video');
  const pyImg = document.getElementById('py-stream-img');

  async function startCamera() {
    if (state.cameraSource === 'webcam') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        state.cameraStream = stream;
        if (videoEl) {
          videoEl.srcObject = stream;
          videoEl.play();
        }
        state.cameraActive = true;
        if (btnToggleCamera) {
          btnToggleCamera.textContent = '⏹ Stop Camera';
          btnToggleCamera.style.background = '#ef4444';
        }
        logEvent('SYSTEM', 'Laptop video camera connected.');
      } catch (err) {
        console.error('Camera access error:', err);
        alert('Could not access camera: ' + err.message + '\nPlease check camera permissions in your browser or macOS settings.');
        state.cameraActive = false;
      }
    } else if (state.cameraSource === 'python_gcs') {
      if (pyImg) {
        pyImg.src = 'http://localhost:5050/video_feed?' + Date.now();
      }
      state.cameraActive = true;
      if (btnToggleCamera) {
        btnToggleCamera.textContent = '⏹ Disconnect GCS';
        btnToggleCamera.style.background = '#ef4444';
      }
      logEvent('SYSTEM', 'Connecting to Python YOLO GCS on http://localhost:5050/video_feed');
    } else {
      state.cameraActive = true;
      if (btnToggleCamera) {
        btnToggleCamera.textContent = '⏹ Stop Sim';
        btnToggleCamera.style.background = '#ef4444';
      }
    }
  }

  function stopCamera() {
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach(track => track.stop());
      state.cameraStream = null;
    }
    if (videoEl) videoEl.srcObject = null;
    if (pyImg) pyImg.src = '';
    state.cameraActive = false;
    if (btnToggleCamera) {
      btnToggleCamera.textContent = '▶ Start Live Camera';
      btnToggleCamera.style.background = '#2563eb';
    }
    logEvent('SYSTEM', 'Camera stream disconnected.');
  }

  if (btnToggleCamera) {
    btnToggleCamera.addEventListener('click', () => {
      if (state.cameraActive) {
        stopCamera();
      } else {
        startCamera();
      }
    });
  }

  if (selCamSource) {
    selCamSource.addEventListener('change', (e) => {
      stopCamera();
      state.cameraSource = e.target.value;
      if (simGroup) {
        simGroup.style.display = state.cameraSource === 'simulation' ? 'flex' : 'none';
      }
      logEvent('SYSTEM', `Camera source switched to: ${state.cameraSource}`);
    });
  }

  if (btnWaterSpray) {
    btnWaterSpray.addEventListener('click', () => {
      if (!state.isArmed) {
        alert('SAFETY INTERLOCK: Pilot must ARM the drone before activating water spray!');
        return;
      }
      if (state.waterPumpCooldown > 0) {
        alert(`PUMP COOLDOWN: Please wait ${state.waterPumpCooldown.toFixed(1)}s before next spray.`);
        return;
      }
      state.waterPumpSprayActive = true;
      state.waterPumpCountdown = 3.0;
      logEvent('ALERT', 'WATER SPRAY ACTIVATED for 3 seconds on confirmed fire.');

      // Also notify Python backend if running
      fetch('http://localhost:5050/api/trigger_pump', { method: 'POST' })
        .catch(() => fetch('http://localhost:5000/api/trigger_pump', { method: 'POST' }).catch(() => {}));
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

function connectWebSocket(url) {
  const wsStatus = document.getElementById('ws-status-msg');
  const connPill = document.getElementById('conn-pill');
  const connLabel = document.getElementById('conn-label');

  try {
    if (webSocket) {
      webSocket.onopen = null;
      webSocket.onmessage = null;
      webSocket.onerror = null;
      webSocket.onclose = null;
      try { webSocket.close(); } catch (_) {}
      webSocket = null;
    }

    if (wsStatus && (!webSocket || webSocket.readyState !== WebSocket.OPEN)) {
      wsStatus.textContent = `Connecting to ${url}...`;
    }

    webSocket = new WebSocket(url);

    webSocket.onopen = () => {
      state.isConnected = true;
      state.isSimulation = false;
      if (wsStatus) wsStatus.textContent = `CONNECTED to ESP32 Gateway (${url})`;
      if (connPill) connPill.className = 'status-pill status-connected';
      if (connLabel) connLabel.textContent = 'CONNECTED (ESP32)';
      logEvent('SYSTEM', `WebSocket link established with drone: ${url}`);
      renderTelemetryUI();
    };

    webSocket.onmessage = (event) => {
      try {
        const parsed = parseIncomingPacket(event.data);
        if (parsed && parsed.type === 'telemetry') {
          state.telemetry = parsed;
          state.lastTelemetryTimestamp = Date.now();
          renderTelemetryUI();
        }
      } catch (err) {
        console.warn('Failed to parse incoming telemetry packet:', err);
      }
    };

    webSocket.onerror = () => {
      // Handled silently during periodic auto-reconnect
      if (wsStatus && !state.isConnected) {
        wsStatus.textContent = `Awaiting drone Wi-Fi link at ${url}...`;
      }
    };

    webSocket.onclose = () => {
      if (state.isConnected) {
        state.isConnected = false;
        if (wsStatus) wsStatus.textContent = 'WebSocket disconnected. Awaiting drone Wi-Fi link...';
        if (connPill) connPill.className = 'status-pill status-waiting';
        if (connLabel) connLabel.textContent = 'WAITING FOR DRONE...';
        logEvent('SYSTEM', 'WebSocket connection closed. Standby mode resumed.');
        renderTelemetryUI();
      }
    };
  } catch (err) {
    if (wsStatus) wsStatus.textContent = `Connection error: ${err.message}`;
  }
}

function initAutoConnect() {
  const inputUrl = document.getElementById('input-ws-url');

  function tryAutoConnect() {
    // Only attempt if not already connected and not in demo simulation mode
    if (state.isConnected || state.isSimulation) return;
    const url = inputUrl ? inputUrl.value.trim() : 'ws://192.168.4.1:8080/telemetry';
    connectWebSocket(url);
  }

  // Poll for drone gateway every 3.5 seconds
  if (reconnectTimer) clearInterval(reconnectTimer);
  reconnectTimer = setInterval(tryAutoConnect, 3500);

  // Initial attempt after brief startup
  setTimeout(tryAutoConnect, 800);
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

  if (selMode) {
    selMode.addEventListener('change', (e) => {
      state.isSimulation = e.target.value === 'simulation';
      if (!state.isSimulation && !state.isConnected) {
        // Reset to standby
        state.telemetry.sensors = {
          temperature_c: null,
          humidity_pct: null,
          mq2_adc: null,
          flame_detected: null,
          mpu_connected: false,
          mpu_temperature_c: null
        };
        state.telemetry.gps = {
          valid: false,
          latitude: null,
          longitude: null,
          satellites: 0,
          altitude_m: null
        };
      }
      logEvent('SYSTEM', `Operation mode switched to: ${e.target.value}`);
      renderTelemetryUI();
    });
  }

  if (btnConnect && inputUrl) {
    btnConnect.addEventListener('click', () => {
      const url = inputUrl.value.trim();
      logEvent('SYSTEM', `Manual connection attempt to ${url}...`);
      connectWebSocket(url);
    });
  }

  if (btnDisconnect) {
    btnDisconnect.addEventListener('click', () => {
      if (webSocket) {
        webSocket.close();
        webSocket = null;
      }
      state.isConnected = false;
      state.isSimulation = false;
      state.telemetry.sensors = {
        temperature_c: null,
        humidity_pct: null,
        mq2_adc: null,
        flame_detected: null,
        mpu_connected: false,
        mpu_temperature_c: null
      };
      state.telemetry.gps = {
        valid: false,
        latitude: null,
        longitude: null,
        satellites: 0,
        altitude_m: null
      };
      if (wsStatus) wsStatus.textContent = 'Disconnected. Standby mode active (Awaiting drone Wi-Fi).';
      logEvent('SYSTEM', 'Manually disconnected from gateway.');
      renderTelemetryUI();
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

// ========================================================
// DIRECT USB (WEB SERIAL) CONNECTION
// ========================================================
let serialPort = null;
let serialReader = null;
let serialKeepReading = false;

function initSerialConnection() {
  const btnConnect = document.getElementById('btn-serial-connect');
  const btnDisconnect = document.getElementById('btn-serial-disconnect');

  if (btnConnect) {
    btnConnect.addEventListener('click', connectSerial);
  }
  if (btnDisconnect) {
    btnDisconnect.addEventListener('click', disconnectSerial);
  }
}

async function connectSerial() {
  const wsStatus = document.getElementById('ws-status-msg');
  const btnConnect = document.getElementById('btn-serial-connect');
  const btnDisconnect = document.getElementById('btn-serial-disconnect');

  if (!('serial' in navigator)) {
    alert('Web Serial API is not supported in this browser.\nPlease use Google Chrome, Brave, Edge, or Opera on Mac/Windows/Linux, or use the Wi-Fi connection.');
    return;
  }

  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 115200 });

    state.isConnected = true;
    state.isSimulation = false;
    serialKeepReading = true;

    if (btnConnect) btnConnect.style.display = 'none';
    if (btnDisconnect) btnDisconnect.style.display = 'inline-block';
    if (wsStatus) wsStatus.textContent = 'CONNECTED via Direct USB Cable (115200 Baud)';

    logEvent('SYSTEM', 'USB Serial link connected at 115200 baud.');
    renderTelemetryUI();

    readSerialStream();
  } catch (err) {
    console.error('USB Serial connection error:', err);
    if (wsStatus) wsStatus.textContent = `USB Serial error: ${err.message}`;
    logEvent('SYSTEM', `USB Serial link failed: ${err.message}`);
  }
}

async function disconnectSerial() {
  serialKeepReading = false;
  if (serialReader) {
    try {
      await serialReader.cancel();
      serialReader.releaseLock();
    } catch (_) {}
    serialReader = null;
  }
  if (serialPort) {
    try {
      await serialPort.close();
    } catch (_) {}
    serialPort = null;
  }

  const btnConnect = document.getElementById('btn-serial-connect');
  const btnDisconnect = document.getElementById('btn-serial-disconnect');
  const wsStatus = document.getElementById('ws-status-msg');

  if (btnConnect) btnConnect.style.display = 'inline-block';
  if (btnDisconnect) btnDisconnect.style.display = 'none';

  state.isConnected = false;
  state.isSimulation = false;
  state.telemetry.sensors = {
    temperature_c: null,
    humidity_pct: null,
    mq2_adc: null,
    flame_detected: null,
    mpu_connected: false,
    mpu_temperature_c: null
  };
  state.telemetry.gps = {
    valid: false,
    latitude: null,
    longitude: null,
    satellites: 0,
    altitude_m: null
  };
  if (wsStatus) wsStatus.textContent = 'USB Serial disconnected. Standby mode active.';
  logEvent('SYSTEM', 'USB Serial link disconnected.');
  renderTelemetryUI();
}

async function readSerialStream() {
  const textDecoder = new TextDecoderStream();
  serialPort.readable.pipeTo(textDecoder.writable).catch(() => {});
  const reader = textDecoder.readable.getReader();
  serialReader = reader;

  let buffer = '';

  try {
    while (serialKeepReading) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          handleIncomingSerialLine(line.trim());
        }
      }
    }
  } catch (err) {
    if (serialKeepReading) {
      console.warn('Serial read error:', err);
    }
  } finally {
    try { reader.releaseLock(); } catch (_) {}
  }
}

function handleIncomingSerialLine(line) {
  if (!line) return;

  // 1. Structured JSON telemetry
  if (line.startsWith('{') && line.endsWith('}')) {
    try {
      const parsed = parseIncomingPacket(line);
      if (parsed && parsed.type === 'telemetry') {
        state.telemetry = parsed;
        state.isConnected = true;
        state.isSimulation = false;
        state.lastTelemetryTimestamp = Date.now();
        renderTelemetryUI();
        return;
      }
    } catch (_) {}
  }

  // 2. Parse text reports from sketch.ino
  let updated = false;

  if (line.includes('MQ-2 raw reading:')) {
    const val = parseInt(line.split(':')[1]);
    if (!isNaN(val)) {
      state.telemetry.sensors.mq2_adc = val;
      updated = true;
    }
  } else if (line.includes('Flame sensor DO:')) {
    const val = line.split(':')[1].trim();
    state.telemetry.sensors.flame_detected = (val === 'LOW');
    updated = true;
  } else if (line.includes('Flame warning:')) {
    const val = line.split(':')[1].trim();
    state.telemetry.sensors.flame_detected = (val === 'YES');
    updated = true;
  } else if (line.includes('Ambient temperature:')) {
    if (line.includes('READ ERROR') || line.includes('NAN')) {
      state.telemetry.sensors.temperature_c = null;
    } else {
      const num = parseFloat(line.split(':')[1]);
      if (!isNaN(num)) state.telemetry.sensors.temperature_c = num;
    }
    updated = true;
  } else if (line.includes('Humidity:')) {
    if (line.includes('READ ERROR') || line.includes('NAN')) {
      state.telemetry.sensors.humidity_pct = null;
    } else {
      const num = parseFloat(line.split(':')[1]);
      if (!isNaN(num)) state.telemetry.sensors.humidity_pct = num;
    }
    updated = true;
  } else if (line.includes('Latitude:')) {
    const num = parseFloat(line.split(':')[1]);
    if (!isNaN(num) && num !== 0) {
      state.telemetry.gps.latitude = num;
      state.telemetry.gps.valid = true;
      updated = true;
    }
  } else if (line.includes('Longitude:')) {
    const num = parseFloat(line.split(':')[1]);
    if (!isNaN(num) && num !== 0) {
      state.telemetry.gps.longitude = num;
      updated = true;
    }
  } else if (line.includes('MPU6050: DETECTED')) {
    state.telemetry.sensors.mpu_connected = true;
    updated = true;
  } else if (line.includes('MPU6050 chip temperature:')) {
    const num = parseFloat(line.split(':')[1]);
    if (!isNaN(num)) state.telemetry.sensors.mpu_temperature_c = num;
    updated = true;
  }

  if (updated) {
    state.isConnected = true;
    state.isSimulation = false;
    state.lastTelemetryTimestamp = Date.now();
    renderTelemetryUI();
  }
}
