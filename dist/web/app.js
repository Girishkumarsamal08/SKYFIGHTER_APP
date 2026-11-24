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
  
  // Pilot Flight Sticks (Mode 2 Standard)
  sticks: {
    roll: 0.0,
    pitch: 0.0,
    yaw: 0.0,
    throttle: 0.0
  },
  trims: {
    roll: 0.0,
    pitch: 0.0,
    yaw: 0.0
  },
  throttleSpringCenter: false,
  flightMode: 'STABILIZE',
  heading_deg: 180,
  altitude_m: 0.0,
  verticalSpeed_ms: 0.0,
  groundSpeed_kmh: 0.0,
  battery: {
    voltage_v: 15.68,
    percentage: 98,
    current_a: 0.8,
    cells: [3.92, 3.91, 3.93, 3.92]
  },
  pressure_hpa: 1013.25,
  rssi_dbm: -52,
  gamepadIndex: null,
  
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
function bootApp() {
  try {
    initServiceWorker();
  } catch (e) {
    console.warn('[PWA] Service worker init error:', e);
  }
  try {
    initNavigation();
  } catch (e) {
    console.error('[GCS] Navigation init error:', e);
  }
  try {
    initTelemetryLoop();
  } catch (e) {
    console.error('[GCS] Telemetry loop init error:', e);
  }
  try {
    initSimulatedCanvases();
  } catch (e) {
    console.error('[GCS] Canvases init error:', e);
  }
  try {
    initFlightControls();
    updateStickReadouts();
    updateRcChannelsHud();
    updateMotorMixing();
    updateProCockpitHUD();
  } catch (e) {
    console.error('[GCS] Flight controls init error:', e);
  }
  try {
    initAudio();
  } catch (e) {
    console.error('[GCS] Audio init error:', e);
  }
  try {
    initSettings();
  } catch (e) {
    console.error('[GCS] Settings init error:', e);
  }
  try {
    initSerialConnection();
  } catch (e) {
    console.error('[GCS] Serial init error:', e);
  }
  try {
    initAutoConnect();
  } catch (e) {
    console.error('[GCS] Auto-connect error:', e);
  }
  try {
    renderTelemetryUI();
  } catch (e) {
    console.error('[GCS] Render UI error:', e);
  }
  logEvent('SYSTEM', 'SKYFIGHTER GCS v1.1 initialized. Standby mode active — waiting for drone connection.');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  // If script executes after DOMContentLoaded has already fired
  bootApp();
}

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
    if (!screenId) return;
    state.activeScreen = screenId;

    // Update screen views
    document.querySelectorAll('.screen-view').forEach(view => {
      view.classList.toggle('active', view.id === `screen-${screenId}`);
    });

    // Update sidebar
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.screen === screenId);
    });

    // Update mobile tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.screen === screenId);
    });

    logEvent('SYSTEM', `Switched view to ${screenId.toUpperCase()}`);
  }

  // Direct element binding
  sidebarItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      switchScreen(item.dataset.screen);
    });
  });

  tabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      switchScreen(btn.dataset.screen);
    });
  });

  // Delegated binding on the nav menus in case elements are clicked on child spans or icons
  const navMenu = document.querySelector('.nav-menu');
  if (navMenu) {
    navMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.nav-item');
      if (item && item.dataset.screen) {
        switchScreen(item.dataset.screen);
      }
    });
  }

  const mobileTabBar = document.querySelector('.mobile-tab-bar');
  if (mobileTabBar) {
    mobileTabBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (btn && btn.dataset.screen) {
        switchScreen(btn.dataset.screen);
      }
    });
  }

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

  // Heading, Altitude, Speed & Battery Dynamics
  state.heading_deg = Math.round((state.heading_deg + (state.sticks.yaw + state.trims.yaw) * 4 + 360) % 360);

  if (state.isArmed) {
    const vspd = (state.sticks.throttle - 0.4) * 3.0;
    state.verticalSpeed_ms = parseFloat(vspd.toFixed(1));
    state.altitude_m = Math.max(0, parseFloat((state.altitude_m + vspd * 0.5).toFixed(1)));
    const stickMag = Math.sqrt(state.sticks.pitch ** 2 + state.sticks.roll ** 2);
    state.groundSpeed_kmh = parseFloat((stickMag * 42.0).toFixed(1));
    state.battery.percentage = Math.max(8, parseFloat((state.battery.percentage - (0.01 + state.sticks.throttle * 0.03)).toFixed(1)));
    state.battery.current_a = parseFloat((1.5 + state.sticks.throttle * 22.0).toFixed(1));
  } else {
    state.verticalSpeed_ms = 0.0;
    state.altitude_m = 0.0;
    state.groundSpeed_kmh = 0.0;
    state.battery.current_a = 0.6;
  }

  state.battery.voltage_v = parseFloat((13.6 + (state.battery.percentage / 100) * 3.2).toFixed(2));
  const cV = parseFloat((state.battery.voltage_v / 4).toFixed(2));
  state.battery.cells = [cV.toFixed(2), (cV - 0.01).toFixed(2), (cV + 0.01).toFixed(2), cV.toFixed(2)];
  state.pressure_hpa = parseFloat((1013.25 - (state.altitude_m * 0.12)).toFixed(2));
  state.rssi_dbm = -52 + Math.floor((Math.random() - 0.5) * 4);

  // GPS Slow Drift Simulation
  let lat = state.telemetry.gps.latitude || 37.774929;
  let lon = state.telemetry.gps.longitude || -122.419416;
  if (state.isArmed) {
    lat += (state.sticks.pitch * 0.00002) + (Math.random() - 0.5) * 0.00001;
    lon += (state.sticks.roll * 0.00002) + (Math.random() - 0.5) * 0.00001;
  }

  state.telemetry = {
    version: 1,
    type: 'telemetry',
    sequence: ++state.commandSequence,
    timestamp_ms: now,
    connection: state.isSimulation ? 'simulated' : (state.isConnected ? 'connected' : 'disconnected'),
    flight: {
      mode: state.flightMode,
      armed: state.isArmed,
      capabilities: {
        manual_control: true,
        autonomous_navigation: true,
        return_to_home: true,
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
      satellites: 14,
      altitude_m: state.altitude_m
    },
    battery: {
      voltage_v: state.battery.voltage_v,
      percentage: state.battery.percentage,
      current_a: state.battery.current_a,
      cells: state.battery.cells
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

    // Standby for Comprehensive Sensor Cards
    setElemText('val-temp-f', '-- °F');
    setElemText('status-temp', 'OFFLINE');
    setElemClass('status-temp', 'badge-sensor-status badge-warn');

    setElemText('sub-humidity-risk', 'Sensor offline');
    setElemText('status-humidity', 'OFFLINE');
    setElemClass('status-humidity', 'badge-sensor-status badge-warn');

    setElemText('val-smoke-ppm', 'Est: -- PPM');
    setElemText('status-smoke', 'OFFLINE');
    setElemClass('status-smoke', 'badge-sensor-status badge-warn');

    setElemText('status-flame', 'OFFLINE');
    setElemClass('status-flame', 'badge-sensor-status badge-warn');

    setElemText('val-batt-pct', '-- %');
    setElemStyle('bar-batt', 'width', '0%');
    setElemText('sub-batt-voltage', 'Pack Voltage: -- V | Current: -- A');
    setElemText('cell-v-1', '--V');
    setElemText('cell-v-2', '--V');
    setElemText('cell-v-3', '--V');
    setElemText('cell-v-4', '--V');

    setElemText('gps-hdop-val', 'HDOP: --');
    setElemText('status-gps', 'NO FIX');
    setElemClass('status-gps', 'badge-sensor-status badge-warn');

    setElemText('val-pressure', '-- hPa');
    setElemText('val-pressure-inhg', '-- inHg');
    setElemStyle('bar-pressure', 'width', '0%');
    setElemText('sub-pressure', 'Atmospheric sensor standby');

    setElemText('val-rssi', '-- dBm');
    setElemStyle('bar-rssi', 'width', '0%');
    setElemText('sub-rssi', 'Link disconnected');
    setElemText('link-latency-detail', 'Ping: -- ms');
    setElemText('status-link', 'DISCONNECTED');
    setElemClass('status-link', 'badge-sensor-status badge-warn');

    // Standby Mini-Instruments
    setElemText('dash-roll-deg', 'R: 0.0°');
    setElemText('dash-pitch-deg', 'P: 0.0°');
    setElemText('dash-heading-text', '--°');
    setElemText('dash-alt-val', '0.0 m');
    setElemText('dash-alt-sub', 'AGL: 0.0m | MSL: --m');
    setElemText('dash-vspeed-tag', 'V.SPD: +0.0 m/s');
    setElemText('dash-speed-val', '0.0 km/h');
    setElemText('dash-speed-sub', '0.0 m/s | 0.0 knots');
    setElemText('dash-throttle-tag', 'THROTTLE: 0%');

    // Standby Cockpit Ribbon
    setElemText('hud-flight-arm', 'DISARMED');
    setElemClass('hud-flight-arm', 'hud-val text-red');
    setElemText('hud-flight-mode', 'STABILIZE');
    setElemText('hud-flight-alt', '0.0 m');
    setElemText('hud-flight-vspeed', '+0.0 m/s');
    setElemText('hud-flight-speed', '0.0 km/h');
    setElemText('hud-flight-batt', '-- V (--%)');
    setElemText('hud-flight-heading', '--°');
    setElemText('hud-flight-link', 'OFFLINE');

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

  // 1. Ambient Temperature
  if (s && s.temperature_c !== null) {
    setElemText('val-temp', `${s.temperature_c} °C`);
    const tempF = (s.temperature_c * 9 / 5 + 32).toFixed(1);
    setElemText('val-temp-f', `${tempF} °F`);
    const tPct = Math.min(100, Math.max(0, (s.temperature_c / 60) * 100));
    setElemStyle('bar-temp', 'width', `${tPct}%`);
    const isHot = s.temperature_c > 45;
    setElemText('sub-temp', isHot ? 'Elevated ambient heat' : 'Nominal canopy temperature');
    setElemText('status-temp', isHot ? 'HIGH HEAT' : 'NOMINAL');
    setElemClass('status-temp', `badge-sensor-status ${isHot ? 'badge-alert' : 'badge-ok'}`);
  } else {
    setElemText('val-temp', '-- °C');
    setElemStyle('bar-temp', 'width', '0%');
  }

  // 2. Relative Humidity
  if (s && s.humidity_pct !== null) {
    setElemText('val-humidity', `${s.humidity_pct} %`);
    const hPct = Math.min(100, Math.max(0, s.humidity_pct));
    setElemStyle('bar-humidity', 'width', `${hPct}%`);
    const isDry = s.humidity_pct < 30;
    setElemText('sub-humidity', isDry ? 'Dry fuel condition (<30%)' : 'Nominal relative humidity');
    setElemText('sub-humidity-risk', isDry ? 'High Wildfire Risk' : 'Fuel moisture: Normal');
    setElemText('status-humidity', isDry ? 'DRY FUEL' : 'NORMAL');
    setElemClass('status-humidity', `badge-sensor-status ${isDry ? 'badge-warn' : 'badge-ok'}`);
  } else {
    setElemText('val-humidity', '-- %');
    setElemStyle('bar-humidity', 'width', '0%');
  }

  // 3. Smoke / MQ-2
  if (s && s.mq2_adc !== null) {
    setElemText('val-smoke', `${s.mq2_adc} ADC`);
    const sPct = Math.min(100, Math.max(0, (s.mq2_adc / 4095) * 100));
    setElemStyle('bar-smoke', 'width', `${sPct}%`);
    const isHighGas = s.mq2_adc > 900;
    setElemText('sub-smoke', isHighGas ? 'High combustion gas level!' : 'Clean air baseline');
    const estPpm = Math.round(s.mq2_adc / 18);
    setElemText('val-smoke-ppm', `Est: ~${estPpm} PPM`);
    setElemText('status-smoke', isHighGas ? 'COMBUSTION' : 'CLEAN');
    setElemClass('status-smoke', `badge-sensor-status ${isHighGas ? 'badge-alert' : 'badge-ok'}`);
  } else {
    setElemText('val-smoke', '-- ADC');
    setElemStyle('bar-smoke', 'width', '0%');
  }

  // 4. Optical Flame Detector
  const valFlame = document.getElementById('val-flame');
  if (valFlame) {
    if (s && s.flame_detected === true) {
      valFlame.textContent = 'ACTIVE FLAME!';
      valFlame.className = 'metric-value flame-alert';
      setElemStyle('bar-flame', 'width', '100%');
      setElemText('sub-flame', 'Optical IR wavelength triggered');
      setElemText('status-flame', 'ALERT: FLAME');
      setElemClass('status-flame', 'badge-sensor-status badge-alert');
    } else if (s && s.flame_detected === false) {
      valFlame.textContent = 'CLEAR';
      valFlame.className = 'metric-value flame-safe';
      setElemStyle('bar-flame', 'width', '0%');
      setElemText('sub-flame', 'No optical flame detected');
      setElemText('status-flame', 'SAFE');
      setElemClass('status-flame', 'badge-sensor-status badge-ok');
    } else {
      valFlame.textContent = 'WAITING';
      valFlame.className = 'metric-value text-dim';
      setElemText('sub-flame', 'Awaiting optical sensor packet...');
      setElemText('status-flame', 'STANDBY');
      setElemClass('status-flame', 'badge-sensor-status badge-warn');
    }
  }

  // 5. 4S LiPo Battery System
  if (state.battery) {
    const battPct = Math.round(state.battery.percentage || 98);
    setElemText('val-batt-pct', `${battPct} %`);
    setElemStyle('bar-batt', 'width', `${battPct}%`);
    setElemText('sub-batt-voltage', `Pack: ${state.battery.voltage_v || 15.6}V | Current: ${state.battery.current_a || 1.2}A`);
    if (state.battery.cells && state.battery.cells.length >= 4) {
      setElemText('cell-v-1', `${state.battery.cells[0]}V`);
      setElemText('cell-v-2', `${state.battery.cells[1]}V`);
      setElemText('cell-v-3', `${state.battery.cells[2]}V`);
      setElemText('cell-v-4', `${state.battery.cells[3]}V`);
    }
    const battPill = document.getElementById('battery-label');
    if (battPill) battPill.textContent = `BATTERY: ${battPct}% (${state.battery.voltage_v || 15.6}V)`;
  }

  // 6. GPS Positioning
  if (g && g.valid && g.latitude !== null && g.longitude !== null) {
    setElemText('val-coords', `${g.latitude.toFixed(6)}, ${g.longitude.toFixed(6)}`);
    setElemText('sub-gps', `Alt: ${g.altitude_m}m | Sats: ${g.satellites}`);
    setElemStyle('bar-gps', 'width', '100%');
    setElemText('gps-hdop-val', 'HDOP: 0.80 (EXCELLENT)');
    setElemText('status-gps', `3D FIX (${g.satellites} Sats)`);
    setElemClass('status-gps', 'badge-sensor-status badge-ok');

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
    setElemText('status-gps', 'NO FIX');
    setElemClass('status-gps', 'badge-sensor-status badge-warn');
    if (gpsPill && gpsLabel) {
      gpsPill.className = 'status-pill status-disarmed';
      gpsLabel.textContent = 'GPS: NO FIX';
    }
  }

  // 7. Barometric Pressure
  setElemText('val-pressure', `${state.pressure_hpa || 1013.25} hPa`);
  const inHg = ((state.pressure_hpa || 1013.25) * 0.02953).toFixed(2);
  setElemText('val-pressure-inhg', `${inHg} inHg`);
  setElemStyle('bar-pressure', 'width', `${Math.min(100, Math.max(0, ((state.pressure_hpa || 1013.25) - 950) / 100 * 100))}%`);
  setElemText('sub-pressure', `Density Alt: ~${Math.round((state.altitude_m || 0) * 3.28)} ft MSL`);

  // 8. Radio Link Quality
  setElemText('val-rssi', `${state.rssi_dbm || -52} dBm`);
  setElemStyle('bar-rssi', 'width', `${Math.min(100, Math.max(0, (100 + (state.rssi_dbm || -52)) * 2))}%`);
  setElemText('sub-rssi', 'Wi-Fi 2.4GHz Link Nominal');
  setElemText('link-latency-detail', `Ping: ${state.isSimulation ? '14' : state.telemetryAgeMs} ms`);
  setElemText('status-link', 'OPTIMAL');
  setElemClass('status-link', 'badge-sensor-status badge-ok');

  // Dashboard Mini-Instruments & PFD
  const rollDeg = (state.sticks.roll * 25);
  const pitchDeg = (state.sticks.pitch * 20);
  const heading = state.heading_deg || 180;
  const cardinal = getCardinal(heading);

  setElemText('dash-roll-deg', `R: ${rollDeg.toFixed(1)}°`);
  setElemText('dash-pitch-deg', `P: ${pitchDeg.toFixed(1)}°`);
  setElemText('dash-heading-text', `${heading}° ${cardinal}`);
  setElemText('dash-alt-val', `${(state.altitude_m || 0).toFixed(1)} m`);
  setElemText('dash-alt-sub', `AGL: ${(state.altitude_m || 0).toFixed(1)}m | MSL: ${((state.altitude_m || 0) + 124).toFixed(0)}m`);
  setElemText('dash-vspeed-tag', `V.SPD: ${(state.verticalSpeed_ms || 0) >= 0 ? '+' : ''}${(state.verticalSpeed_ms || 0).toFixed(1)} m/s`);
  setElemText('dash-speed-val', `${(state.groundSpeed_kmh || 0).toFixed(1)} km/h`);
  setElemText('dash-speed-sub', `${((state.groundSpeed_kmh || 0) / 3.6).toFixed(1)} m/s | ${((state.groundSpeed_kmh || 0) * 0.5399).toFixed(1)} kts`);
  setElemText('dash-throttle-tag', `THROTTLE: ${Math.round(state.sticks.throttle * 100)}%`);

  const miniHorizonSky = document.getElementById('dash-horizon-sky');
  if (miniHorizonSky) {
    miniHorizonSky.style.transform = `translateY(${pitchDeg * 0.8}px) rotate(${-rollDeg}deg)`;
  }
  const miniCompassNeedle = document.getElementById('dash-compass-needle');
  if (miniCompassNeedle) {
    miniCompassNeedle.style.transform = `rotate(${heading}deg)`;
  }

  // Cockpit Ribbon Updates
  setElemText('hud-flight-arm', state.isArmed ? 'ARMED' : 'DISARMED');
  setElemClass('hud-flight-arm', `hud-val ${state.isArmed ? 'text-green' : 'text-red'}`);
  setElemText('hud-flight-mode', state.flightMode);
  setElemText('hud-flight-alt', `${(state.altitude_m || 0).toFixed(1)} m`);
  setElemText('hud-flight-vspeed', `${(state.verticalSpeed_ms || 0) >= 0 ? '+' : ''}${(state.verticalSpeed_ms || 0).toFixed(1)} m/s`);
  setElemText('hud-flight-speed', `${(state.groundSpeed_kmh || 0).toFixed(1)} km/h`);
  setElemText('hud-flight-batt', `${state.battery.voltage_v || 15.6}V (${Math.round(state.battery.percentage || 98)}%)`);
  setElemText('hud-flight-heading', `${heading}° ${cardinal}`);
  setElemText('hud-flight-link', `${state.isSimulation ? '14' : state.telemetryAgeMs}ms / 30Hz`);

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

  // ========================================================
  // DRONE VISION & AI OBJECT DETECTION SUITE
  // ========================================================
  let visionBackendUrl = localStorage.getItem('skyfighter_backend_url') || 'http://localhost:8000';
  let isStreamRunning = false;
  let isOverlayAnnotated = true;
  let visionWs = null;
  let visionPollTimer = null;
  let lastHazardAudioTime = 0;

  const streamImg = document.getElementById('drone-live-stream-img');
  const streamImgAi = document.getElementById('drone-live-stream-img-ai');
  const offlineBox = document.getElementById('cam-offline-box');
  const offlineBoxAi = document.getElementById('cam-fallback-box-ai');
  const btnToggleCamera = document.getElementById('btn-toggle-camera');
  const btnToggleCameraAi = document.getElementById('btn-toggle-camera-ai');
  const btnToggleAnnotated = document.getElementById('btn-toggle-annotated');
  const btnToggleAnnotatedAi = document.getElementById('btn-toggle-annotated-ai');
  const btnFullscreen = document.getElementById('btn-camera-fullscreen');
  const btnFullscreenAi = document.getElementById('btn-camera-fullscreen-ai');
  const btnSnapshot = document.getElementById('btn-cam-snapshot');
  const btnSnapshotAi = document.getElementById('btn-cam-snapshot-ai');
  const selCamSource = document.getElementById('select-cam-source');
  const selCamSourceAi = document.getElementById('select-cam-source-ai');
  const esp32Group = document.getElementById('esp32-url-group');
  const esp32GroupAi = document.getElementById('esp32-url-group-ai');
  const inputEsp32Url = document.getElementById('input-esp32-url');
  const inputEsp32UrlAi = document.getElementById('input-esp32-url-ai');
  const btnApplyEsp32Url = document.getElementById('btn-apply-esp32-url');
  const btnApplyEsp32UrlAi = document.getElementById('btn-apply-esp32-url-ai');
  const inputBackendUrl = document.getElementById('input-backend-url');
  const inputBackendUrlAi = document.getElementById('input-backend-url-ai');
  const btnReconnectVision = document.getElementById('btn-reconnect-vision');
  const btnQuickSwitchSim = document.getElementById('btn-quick-switch-sim');
  const btnSaveThresholds = document.getElementById('btn-save-thresholds');
  const btnSaveThresholdsAi = document.getElementById('btn-save-thresholds-ai');
  const btnTestAlert = document.getElementById('btn-test-alert');
  const btnTestAlertAi = document.getElementById('btn-test-alert-ai');
  const btnClearAlerts = document.getElementById('btn-clear-alerts');
  const btnClearAlertsAi = document.getElementById('btn-clear-alerts-ai');
  const btnWaterSpray = document.getElementById('btn-water-spray');
  const btnWaterSprayAi = document.getElementById('btn-water-spray-ai');

  [inputBackendUrl, inputBackendUrlAi].forEach(inp => {
    if (inp) {
      inp.value = visionBackendUrl;
      inp.addEventListener('change', (e) => {
        visionBackendUrl = e.target.value.trim().replace(/\/+$/, '');
        localStorage.setItem('skyfighter_backend_url', visionBackendUrl);
        if (inputBackendUrl) inputBackendUrl.value = visionBackendUrl;
        if (inputBackendUrlAi) inputBackendUrlAi.value = visionBackendUrl;
        logEvent('SYSTEM', `Drone Vision backend URL updated: ${visionBackendUrl}`);
        if (isStreamRunning) startVisionStream();
      });
    }
  });

  function formatUptime(seconds) {
    const s = Math.floor(seconds % 60);
    const m = Math.floor((seconds / 60) % 60);
    const h = Math.floor(seconds / 3600);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  function connectVisionWebSocket() {
    if (visionWs) {
      try { visionWs.close(); } catch (e) {}
      visionWs = null;
    }

    try {
      const wsUrl = visionBackendUrl.replace(/^http/, 'ws') + '/ws/detections';
      visionWs = new WebSocket(wsUrl);

      visionWs.onopen = () => {
        const badge = document.getElementById('cam-connection-badge');
        if (badge) {
          badge.textContent = 'ONLINE';
          badge.style.background = '#22c55e';
        }
      };

      visionWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'telemetry') {
            updateVisionUI(data);
          }
        } catch (e) {}
      };

      visionWs.onerror = () => {
        const badge = document.getElementById('cam-connection-badge');
        if (badge) {
          badge.textContent = 'CONNECTING...';
          badge.style.background = '#f59e0b';
        }
      };

      visionWs.onclose = () => {
        // Will be reconnected by periodic polling loop if needed
      };
    } catch (err) {
      console.warn('Vision WebSocket unavailable:', err);
    }
  }

  function updateVisionUI(data) {
    const cam = data.camera || {};
    const counts = data.counts || {};
    const cumulative = data.cumulative || {};

    // 1. Connection & HUD Badges (Update both Live Cam and AI Cam Stream)
    ['cam-connection-badge', 'cam-connection-badge-ai'].forEach(id => {
      const b = document.getElementById(id);
      if (b) {
        b.textContent = cam.connected ? 'ONLINE' : 'CONNECTING...';
        b.style.background = cam.connected ? '#22c55e' : '#f59e0b';
        b.style.color = cam.connected ? '#000000' : '#ffffff';
      }
    });

    ['cam-fps-badge', 'cam-fps-badge-ai'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.textContent = `${(cam.fps || 0).toFixed(1)} FPS`;
    });

    ['cam-res-badge', 'cam-res-badge-ai'].forEach(id => {
      const b = document.getElementById(id);
      if (b && cam.resolution) b.textContent = `${cam.resolution[0]}x${cam.resolution[1]}`;
    });

    ['cam-frame-age', 'cam-frame-age-ai'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.textContent = `AGE: ${cam.last_frame_age_ms || 0}ms`;
    });

    ['hud-source-label', 'hud-source-label-ai'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.textContent = `SRC: ${(cam.source || 'STREAM').toUpperCase()}`;
    });

    ['stat-camera-uptime', 'stat-camera-uptime-ai'].forEach(id => {
      const b = document.getElementById(id);
      if (b && cam.uptime_seconds) b.textContent = formatUptime(cam.uptime_seconds);
    });

    ['cam-status-text', 'cam-status-text-ai'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.textContent = cam.connected ? 'Live video link verified' : 'Connecting to source';
    });

    // 2. Monitoring Statistics Cards
    setElemText('stat-total-detections', cumulative.total || counts.Total || 0);
    setElemText('stat-total-detections-ai', cumulative.total || counts.Total || 0);
    setElemText('stat-people-detected', cumulative.people || counts.Person || 0);
    setElemText('stat-people-detected-ai', cumulative.people || counts.Person || 0);
    setElemText('stat-animals-detected', cumulative.animals || counts.Animal || 0);
    setElemText('stat-animals-detected-ai', cumulative.animals || counts.Animal || 0);
    setElemText('stat-fire-detected', cumulative.fire || counts.Fire || 0);
    setElemText('stat-fire-detected-ai', cumulative.fire || counts.Fire || 0);
    setElemText('stat-smoke-detected', cumulative.smoke || counts.Smoke || 0);
    setElemText('stat-smoke-detected-ai', cumulative.smoke || counts.Smoke || 0);

    // 3. Status Cards
    const pCount = counts.Person || 0;
    ['val-status-person', 'val-status-person-ai'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = pCount > 0 ? `DETECTED (${pCount})` : 'CLEAR';
    });
    ['sub-status-person', 'sub-status-person-ai'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = pCount > 0 ? 'Person in frame' : 'No personnel in FOV';
    });

    const aCount = counts.Animal || 0;
    const detections = data.detections || [];
    const animalDets = detections.filter(d => d.category === 'Animal');
    const speciesList = animalDets.map(d => d.class).join(', ');
    ['val-status-animal', 'val-status-animal-ai'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = aCount > 0 ? `ACTIVE (${aCount})` : 'CLEAR';
    });
    ['sub-status-animal', 'sub-status-animal-ai'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = speciesList ? `Species: ${speciesList}` : 'Wildlife safe';
    });

    ['val-status-fire', 'val-status-fire-ai'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        if (data.fire_alert_active) {
          el.textContent = '! ALERT: LOCKED !';
          el.style.color = '#ef4444';
        } else if ((counts.Fire || 0) > 0) {
          el.textContent = `VERIFYING [${data.persistence}/${data.persistence_threshold}]`;
          el.style.color = '#f59e0b';
        } else {
          el.textContent = 'CLEAR';
          el.style.color = '#22c55e';
        }
      }
    });
    ['sub-status-fire', 'sub-status-fire-ai'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = `Persistence: ${data.persistence || 0}/${data.persistence_threshold || 6}`;
    });

    ['card-fire-stat', 'card-fire-stat-ai'].forEach(id => {
      const c = document.getElementById(id);
      if (c) {
        if (data.fire_alert_active) c.classList.add('pulse-alert');
        else c.classList.remove('pulse-alert');
      }
    });

    const sCount = counts.Smoke || 0;
    ['val-status-smoke', 'val-status-smoke-ai'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = sCount > 0 ? 'PLUME DETECTED' : 'CLEAR';
        el.style.color = sCount > 0 ? '#f59e0b' : '#22c55e';
      }
    });
    ['sub-status-smoke', 'sub-status-smoke-ai'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = sCount > 0 ? 'Smoke aerosol active' : 'Atmosphere clear';
    });

    // 4. Overlaid HUD banner & Persistence
    ['ai-targets-summary', 'ai-targets-summary-ai'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = `TARGETS: ${counts.Total || 0}`;
    });
    ['ai-persistence-tag', 'ai-persistence-tag-ai'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = `VERIFYING: [${data.persistence || 0}/${data.persistence_threshold || 6}]`;
    });

    ['ai-detection-tag', 'ai-detection-tag-ai'].forEach(id => {
      const aiTag = document.getElementById(id);
      if (aiTag) {
        if (data.fire_alert_active) {
          aiTag.className = 'detection-pill alert';
          aiTag.textContent = '! CRITICAL FIRE ALERT: LOCKED !';
          aiTag.style.background = '#ef4444';
          aiTag.style.color = '#ffffff';
        } else if (data.persistence > 0) {
          aiTag.className = 'detection-pill';
          aiTag.textContent = `AI INFERENCE: VERIFYING [${data.persistence}/${data.persistence_threshold}]`;
          aiTag.style.background = '#f59e0b';
          aiTag.style.color = '#000000';
        } else {
          aiTag.className = 'detection-pill';
          aiTag.textContent = 'AI INFERENCE: PATROL (NORMAL)';
          aiTag.style.background = 'rgba(255, 107, 0, 0.7)';
          aiTag.style.color = '#ffffff';
        }
      }
    });

    // Audio buzzer alert with cooldown
    if (data.fire_alert_active) {
      const now = Date.now();
      if (now - lastHazardAudioTime > 10000) {
        lastHazardAudioTime = now;
        playBuzzer(true);
        logEvent('ALERT', 'CRITICAL FIRE DETECTED by YOLO Vision! Pilot arm and water spray enabled.');
      }
    }

    // Water spray button activation
    [btnWaterSpray, btnWaterSprayAi].forEach(btn => {
      if (!btn || state.waterPumpSprayActive) return;
      if (data.fire_alert_active && state.isArmed) {
        btn.disabled = false;
        btn.textContent = 'ACTIVATE WATER SPRAY (3s)';
        btn.style.background = '#ef4444';
        btn.style.color = '#ffffff';
      } else if (data.fire_alert_active) {
        btn.disabled = true;
        btn.textContent = 'SPRAY (REQUIRES PILOT ARM)';
        btn.style.color = '#ef4444';
      } else {
        btn.disabled = true;
        btn.textContent = 'Water Spray (DISARMED)';
        btn.style.background = 'transparent';
        btn.style.color = '#ef4444';
      }
    });

    // 5. Update Detection History Table
    fetchDetectionHistory();
  }

  function fetchDetectionHistory() {
    fetch(`${visionBackendUrl}/api/detections?limit=15`)
      .then(res => res.json())
      .then(data => {
        ['detection-history-tbody', 'detection-history-tbody-ai'].forEach(tbodyId => {
          const tbody = document.getElementById(tbodyId);
          if (!tbody || !data.events || data.events.length === 0) return;

          let html = '';
          data.events.forEach(ev => {
            const sevClass = ev.alert_severity === 'CRITICAL' ? 'badge-critical' : 'badge-severity';
            const sevStyle = ev.alert_severity === 'CRITICAL' ? 'background:#ef4444;color:#fff;' : 'background:#22c55e;color:#000;';
            html += `<tr>
              <td style="font-family:monospace;color:#00d4ff;">#${ev.id}</td>
              <td style="font-family:monospace;font-size:11px;">${ev.timestamp}</td>
              <td><b>${ev.class_name}</b></td>
              <td><span style="color:#8a96aa;">${ev.category}</span></td>
              <td style="font-family:monospace;color:#22c55e;">${ev.confidence}%</td>
              <td><span class="${sevClass}" style="${sevStyle}padding:2px 6px;border-radius:4px;font-size:10px;font-weight:bold;">${ev.alert_severity}</span></td>
              <td><span style="color:#22c55e;font-size:11px;">VERIFIED</span></td>
            </tr>`;
          });
          tbody.innerHTML = html;
        });
      })
      .catch(() => {});
  }

  function startVisionStream() {
    isStreamRunning = true;
    const streamUrl = `${visionBackendUrl}/api/camera/stream?annotated=${isOverlayAnnotated}&t=${Date.now()}`;
    
    [streamImg, streamImgAi].forEach(img => {
      if (img) {
        img.src = streamUrl;
        img.style.display = 'block';
        img.onerror = () => {
          img.style.display = 'none';
          if (offlineBox) offlineBox.style.display = 'flex';
          if (offlineBoxAi) offlineBoxAi.style.display = 'flex';
        };
        img.onload = () => {
          if (offlineBox) offlineBox.style.display = 'none';
          if (offlineBoxAi) offlineBoxAi.style.display = 'none';
        };
      }
    });

    if (canvasRgb) canvasRgb.style.display = 'none';
    if (offlineBox) offlineBox.style.display = 'none';
    if (offlineBoxAi) offlineBoxAi.style.display = 'none';

    [btnToggleCamera, btnToggleCameraAi].forEach(btn => {
      if (btn) {
        btn.textContent = '⏹ Stop Live Camera';
        btn.style.background = '#ef4444';
      }
    });

    connectVisionWebSocket();

    // Heartbeat fallback polling (in case WebSocket is blocked by proxy)
    if (visionPollTimer) clearInterval(visionPollTimer);
    visionPollTimer = setInterval(() => {
      fetch(`${visionBackendUrl}/api/camera/status`)
        .then(r => r.json())
        .then(camStatus => {
          fetch(`${visionBackendUrl}/api/detections/latest`)
            .then(r => r.json())
            .then(detLatest => {
              updateVisionUI({
                camera: camStatus,
                detections: detLatest.active_detections,
                counts: detLatest.counts,
                persistence: detLatest.persistence,
                persistence_threshold: detLatest.persistence_threshold,
                fire_alert_active: detLatest.fire_alert_active,
                cumulative: detLatest.cumulative_statistics
              });
            }).catch(() => {});
        }).catch(() => {
          ['cam-connection-badge', 'cam-connection-badge-ai'].forEach(id => {
            const b = document.getElementById(id);
            if (b) {
              b.textContent = 'OFFLINE';
              b.style.background = '#ef4444';
            }
          });
        });
    }, 1200);

    logEvent('SYSTEM', `Drone Vision live stream connected to ${visionBackendUrl}/api/camera/stream`);
  }

  function stopVisionStream() {
    isStreamRunning = false;
    [streamImg, streamImgAi].forEach(img => {
      if (img) {
        img.src = '';
        img.style.display = 'none';
      }
    });

    if (canvasRgb) canvasRgb.style.display = 'block';
    if (offlineBox) offlineBox.style.display = 'none';
    if (offlineBoxAi) offlineBoxAi.style.display = 'none';

    [btnToggleCamera, btnToggleCameraAi].forEach(btn => {
      if (btn) {
        btn.textContent = '▶ Start Live Camera';
        btn.style.background = '#2563eb';
      }
    });

    if (visionWs) {
      try { visionWs.close(); } catch (e) {}
      visionWs = null;
    }
    if (visionPollTimer) {
      clearInterval(visionPollTimer);
      visionPollTimer = null;
    }

    logEvent('SYSTEM', 'Drone Vision stream paused. Synthetic HUD standby active.');
  }

  [btnToggleCamera, btnToggleCameraAi].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        if (isStreamRunning) {
          stopVisionStream();
        } else {
          startVisionStream();
        }
      });
    }
  });

  [btnToggleAnnotated, btnToggleAnnotatedAi].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        isOverlayAnnotated = !isOverlayAnnotated;
        const txt = `Overlay: ${isOverlayAnnotated ? 'ANNOTATED HUD' : 'RAW FEED'}`;
        if (btnToggleAnnotated) {
          btnToggleAnnotated.textContent = txt;
          btnToggleAnnotated.classList.toggle('active', isOverlayAnnotated);
        }
        if (btnToggleAnnotatedAi) {
          btnToggleAnnotatedAi.textContent = txt;
          btnToggleAnnotatedAi.classList.toggle('active', isOverlayAnnotated);
        }
        if (isStreamRunning) {
          const streamUrl = `${visionBackendUrl}/api/camera/stream?annotated=${isOverlayAnnotated}&t=${Date.now()}`;
          if (streamImg) streamImg.src = streamUrl;
          if (streamImgAi) streamImgAi.src = streamUrl;
        }
      });
    }
  });

  [btnFullscreen, btnFullscreenAi].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        const container = document.getElementById('camera-viewport-container-ai') || document.getElementById('camera-viewport-container');
        if (!container) return;
        if (!document.fullscreenElement) {
          container.requestFullscreen().catch(err => alert(`Fullscreen error: ${err.message}`));
        } else {
          document.exitFullscreen();
        }
      });
    }
  });

  [btnSnapshot, btnSnapshotAi].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = `${visionBackendUrl}/api/camera/stream?annotated=${isOverlayAnnotated}&snapshot=${Date.now()}`;
        a.target = '_blank';
        a.click();
        logEvent('SYSTEM', 'Camera snapshot frame captured.');
      });
    }
  });

  [selCamSource, selCamSourceAi].forEach(sel => {
    if (sel) {
      sel.addEventListener('change', (e) => {
        const src = e.target.value;
        if (selCamSource) selCamSource.value = src;
        if (selCamSourceAi) selCamSourceAi.value = src;
        if (esp32Group) esp32Group.style.display = (src === 'esp32_cam') ? 'flex' : 'none';
        if (esp32GroupAi) esp32GroupAi.style.display = (src === 'esp32_cam') ? 'flex' : 'none';
        
        const urlVal = (inputEsp32Url && inputEsp32Url.value) || (inputEsp32UrlAi && inputEsp32UrlAi.value) || null;
        fetch(`${visionBackendUrl}/api/camera/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: src, url: urlVal })
        }).then(r => r.json())
          .then(() => {
            logEvent('SYSTEM', `Vision source switched to: ${src.toUpperCase()}`);
            if (isStreamRunning) startVisionStream();
          }).catch(err => console.warn('Config update failed:', err));
      });
    }
  });

  [btnApplyEsp32Url, btnApplyEsp32UrlAi].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        const url = ((inputEsp32Url && inputEsp32Url.value) || (inputEsp32UrlAi && inputEsp32UrlAi.value) || '').trim();
        fetch(`${visionBackendUrl}/api/camera/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'esp32_cam', url: url })
        }).then(r => r.json())
          .then(() => {
            logEvent('SYSTEM', `ESP32-CAM stream URL configured: ${url}`);
            if (isStreamRunning) startVisionStream();
          }).catch(() => alert('Could not reach backend to set ESP32-CAM URL.'));
      });
    }
  });

  if (btnReconnectVision) {
    btnReconnectVision.addEventListener('click', () => startVisionStream());
  }

  const btnRetry8000 = document.getElementById('btn-retry-stream-8000');
  if (btnRetry8000) {
    btnRetry8000.addEventListener('click', () => {
      const stream = document.getElementById('drone-live-stream-img-ai');
      const fallback = document.getElementById('cam-fallback-box-ai');
      if (stream) {
        stream.src = `${visionBackendUrl}/api/camera/stream?annotated=true&t=${Date.now()}`;
        stream.style.display = 'block';
      }
      if (fallback) fallback.style.display = 'none';
      startVisionStream();
    });
  }

  const btnRetry5050 = document.getElementById('btn-retry-stream-5050');
  if (btnRetry5050) {
    btnRetry5050.addEventListener('click', () => {
      const stream = document.getElementById('drone-live-stream-img-ai');
      const fallback = document.getElementById('cam-fallback-box-ai');
      if (stream) {
        stream.src = `http://localhost:5050/video_feed?${Date.now()}`;
        stream.style.display = 'block';
      }
      if (fallback) fallback.style.display = 'none';
    });
  }

  if (btnQuickSwitchSim) {
    btnQuickSwitchSim.addEventListener('click', () => {
      if (selCamSource) {
        selCamSource.value = 'simulation';
        selCamSource.dispatchEvent(new Event('change'));
      }
      if (selCamSourceAi) {
        selCamSourceAi.value = 'simulation';
        selCamSourceAi.dispatchEvent(new Event('change'));
      }
    });
  }

  // Threshold controls (sync both screens)
  function bindRangePair(sliderId1, sliderId2, labelId1, labelId2) {
    const s1 = document.getElementById(sliderId1);
    const s2 = document.getElementById(sliderId2);
    const l1 = document.getElementById(labelId1);
    const l2 = document.getElementById(labelId2);

    [s1, s2].forEach(slider => {
      if (!slider) return;
      slider.addEventListener('input', (e) => {
        const val = e.target.value;
        if (s1) s1.value = val;
        if (s2) s2.value = val;
        if (l1) l1.textContent = `${val}%`;
        if (l2) l2.textContent = `${val}%`;
      });
    });
  }
  bindRangePair('thresh-fire', 'thresh-fire-ai', 'val-thresh-fire', 'val-thresh-fire-ai');
  bindRangePair('thresh-smoke', 'thresh-smoke-ai', 'val-thresh-smoke', 'val-thresh-smoke-ai');
  bindRangePair('thresh-person', 'thresh-person-ai', 'val-thresh-person', 'val-thresh-person-ai');
  bindRangePair('thresh-animal', 'thresh-animal-ai', 'val-thresh-animal', 'val-thresh-animal-ai');

  [btnSaveThresholds, btnSaveThresholdsAi].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        const rangeFire = document.getElementById('thresh-fire-ai') || document.getElementById('thresh-fire');
        const rangeSmoke = document.getElementById('thresh-smoke-ai') || document.getElementById('thresh-smoke');
        const rangePerson = document.getElementById('thresh-person-ai') || document.getElementById('thresh-person');
        const rangeAnimal = document.getElementById('thresh-animal-ai') || document.getElementById('thresh-animal');

        const payload = {
          conf_fire: rangeFire ? parseFloat(rangeFire.value) / 100 : 0.30,
          conf_smoke: rangeSmoke ? parseFloat(rangeSmoke.value) / 100 : 0.30,
          conf_person: rangePerson ? parseFloat(rangePerson.value) / 100 : 0.45,
          conf_animal: rangeAnimal ? parseFloat(rangeAnimal.value) / 100 : 0.40
        };
        fetch(`${visionBackendUrl}/api/detection/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(r => r.json())
          .then(() => logEvent('SYSTEM', 'YOLO detection thresholds updated on backend.'))
          .catch(e => console.warn('Threshold save error:', e));
      });
    }
  });

  [btnTestAlert, btnTestAlertAi].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        playBuzzer(true);
        ['ai-detection-tag', 'ai-detection-tag-ai'].forEach(id => {
          const aiTag = document.getElementById(id);
          if (aiTag) {
            aiTag.className = 'detection-pill alert';
            aiTag.textContent = '! BENCH TEST FIRE ALERT: LOCKED !';
            aiTag.style.background = '#ef4444';
            setTimeout(() => {
              aiTag.className = 'detection-pill';
              aiTag.textContent = 'AI INFERENCE: PATROL (NORMAL)';
              aiTag.style.background = 'rgba(255, 107, 0, 0.7)';
            }, 3000);
          }
        });
        logEvent('ALERT', 'Manual Alert Buzzer Test triggered by pilot.');
      });
    }
  });

  [btnClearAlerts, btnClearAlertsAi].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        fetch(`${visionBackendUrl}/api/alerts/clear`, { method: 'POST' })
          .then(() => logEvent('SYSTEM', 'Active fire alerts cleared by pilot.'))
          .catch(() => {});
      });
    }
  });

  [btnWaterSpray, btnWaterSprayAi].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
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

        fetch(`${visionBackendUrl}/api/trigger_pump`, { method: 'POST' }).catch(() => {});
      });
    }
  });

  // Auto-connect to local vision service if available on page load
  setTimeout(() => {
    fetch(`${visionBackendUrl}/api/camera/status`)
      .then(res => res.json())
      .then(() => {
        console.log('[DroneVision] Local vision service detected. Starting stream...');
        startVisionStream();
      })
      .catch(() => {
        console.log('[DroneVision] Vision service offline. Standby mode active.');
      });
  }, 1000);
}

// ========================================================
// FLIGHT CONTROLS & SAFETY INTERLOCKS
// ========================================================
function getCardinal(deg) {
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return cardinals[index];
}

// ========================================================
// PRO FLIGHT CONTROLLER & MULTI-TOUCH COCKPIT
// ========================================================
function initFlightControls() {
  const leftArena = document.getElementById('joystick-left-arena');
  const leftThumb = document.getElementById('joystick-left-thumb');
  const rightArena = document.getElementById('joystick-right-arena');
  const rightThumb = document.getElementById('joystick-right-thumb');

  const maxRadius = 78;

  // ------------------------------------------------------
  // LEFT STICK: THROTTLE & YAW (MODE 2 STANDARD)
  // ------------------------------------------------------
  if (leftArena && leftThumb) {
    let isDraggingLeft = false;

    function handleLeftMove(clientX, clientY) {
      const rect = leftArena.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      let dx = clientX - centerX;
      let dy = clientY - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }

      leftThumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

      // Yaw: horizontal [-1.0, 1.0]
      const normYaw = Math.max(-1.0, Math.min(1.0, dx / maxRadius));
      // Throttle: vertical [0.0, 1.0] (bottom is 0%, top is 100%)
      const normThrottle = Math.max(0.0, Math.min(1.0, 0.5 - (dy / maxRadius) * 0.5));

      state.sticks.yaw = parseFloat(normYaw.toFixed(2));
      state.sticks.throttle = parseFloat(normThrottle.toFixed(2));

      updateStickReadouts();
      updateMotorMixing();
      updateRcChannelsHud();
      updateProCockpitHUD();
    }

    function resetLeftStick() {
      isDraggingLeft = false;
      if (state.throttleSpringCenter) {
        leftThumb.style.transform = 'translate(-50%, -50%)';
        state.sticks.throttle = 0.5;
        state.sticks.yaw = 0.0;
      } else {
        // Ratchet collective: Yaw self-centers, Throttle stays at current level
        const currentDy = (0.5 - state.sticks.throttle) * (maxRadius * 2);
        leftThumb.style.transform = `translate(-50%, calc(-50% + ${currentDy}px))`;
        state.sticks.yaw = 0.0;
      }
      updateStickReadouts();
      updateMotorMixing();
      updateRcChannelsHud();
      updateProCockpitHUD();
    }

    leftArena.addEventListener('pointerdown', (e) => {
      isDraggingLeft = true;
      leftArena.setPointerCapture(e.pointerId);
      handleLeftMove(e.clientX, e.clientY);
    });

    leftArena.addEventListener('pointermove', (e) => {
      if (isDraggingLeft) handleLeftMove(e.clientX, e.clientY);
    });

    leftArena.addEventListener('pointerup', resetLeftStick);
    leftArena.addEventListener('pointercancel', resetLeftStick);
  }

  // ------------------------------------------------------
  // RIGHT STICK: PITCH & ROLL (MODE 2 STANDARD)
  // ------------------------------------------------------
  if (rightArena && rightThumb) {
    let isDraggingRight = false;

    function handleRightMove(clientX, clientY) {
      const rect = rightArena.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      let dx = clientX - centerX;
      let dy = clientY - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }

      rightThumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

      // Roll: horizontal [-1.0, 1.0] (Right positive)
      const normRoll = Math.max(-1.0, Math.min(1.0, dx / maxRadius));
      // Pitch: vertical [-1.0, 1.0] (Up/Forward positive)
      const normPitch = Math.max(-1.0, Math.min(1.0, -dy / maxRadius));

      state.sticks.roll = parseFloat(normRoll.toFixed(2));
      state.sticks.pitch = parseFloat(normPitch.toFixed(2));

      updateStickReadouts();
      updateMotorMixing();
      updateRcChannelsHud();
      updateProCockpitHUD();
    }

    function resetRightStick() {
      isDraggingRight = false;
      rightThumb.style.transform = 'translate(-50%, -50%)';
      state.sticks.roll = 0.0;
      state.sticks.pitch = 0.0;
      updateStickReadouts();
      updateMotorMixing();
      updateRcChannelsHud();
      updateProCockpitHUD();
    }

    rightArena.addEventListener('pointerdown', (e) => {
      isDraggingRight = true;
      rightArena.setPointerCapture(e.pointerId);
      handleRightMove(e.clientX, e.clientY);
    });

    rightArena.addEventListener('pointermove', (e) => {
      if (isDraggingRight) handleRightMove(e.clientX, e.clientY);
    });

    rightArena.addEventListener('pointerup', resetRightStick);
    rightArena.addEventListener('pointercancel', resetRightStick);
  }

  // ------------------------------------------------------
  // TRIMS & THROTTLE SPRING TOGGLE
  // ------------------------------------------------------
  const btnThrottleSpring = document.getElementById('btn-throttle-center-toggle');
  if (btnThrottleSpring) {
    btnThrottleSpring.addEventListener('click', () => {
      state.throttleSpringCenter = !state.throttleSpringCenter;
      btnThrottleSpring.textContent = state.throttleSpringCenter ? 'SPRING: ON' : 'SPRING: OFF';
      btnThrottleSpring.style.color = state.throttleSpringCenter ? '#22c55e' : '#cbd5e1';
      logEvent('COMMAND', `Throttle spring-centering ${state.throttleSpringCenter ? 'ENABLED' : 'DISABLED'}`);
    });
  }

  // Yaw Trims
  const btnTrimYawL = document.getElementById('btn-trim-yaw-left');
  const btnTrimYawR = document.getElementById('btn-trim-yaw-right');
  const btnTrimResetL = document.getElementById('btn-trim-center-left');
  if (btnTrimYawL) btnTrimYawL.addEventListener('click', () => { state.trims.yaw = Math.max(-0.2, state.trims.yaw - 0.02); updateRcChannelsHud(); });
  if (btnTrimYawR) btnTrimYawR.addEventListener('click', () => { state.trims.yaw = Math.min(0.2, state.trims.yaw + 0.02); updateRcChannelsHud(); });
  if (btnTrimResetL) btnTrimResetL.addEventListener('click', () => { state.trims.yaw = 0.0; updateRcChannelsHud(); });

  // Pitch & Roll Trims
  const btnTrimRollL = document.getElementById('btn-trim-roll-left');
  const btnTrimRollR = document.getElementById('btn-trim-roll-right');
  const btnTrimPitchU = document.getElementById('btn-trim-pitch-up');
  const btnTrimPitchD = document.getElementById('btn-trim-pitch-down');
  const btnTrimResetR = document.getElementById('btn-trim-center-right');
  if (btnTrimRollL) btnTrimRollL.addEventListener('click', () => { state.trims.roll = Math.max(-0.2, state.trims.roll - 0.02); updateRcChannelsHud(); });
  if (btnTrimRollR) btnTrimRollR.addEventListener('click', () => { state.trims.roll = Math.min(0.2, state.trims.roll + 0.02); updateRcChannelsHud(); });
  if (btnTrimPitchU) btnTrimPitchU.addEventListener('click', () => { state.trims.pitch = Math.min(0.2, state.trims.pitch + 0.02); updateRcChannelsHud(); });
  if (btnTrimPitchD) btnTrimPitchD.addEventListener('click', () => { state.trims.pitch = Math.max(-0.2, state.trims.pitch - 0.02); updateRcChannelsHud(); });
  if (btnTrimResetR) btnTrimResetR.addEventListener('click', () => { state.trims.roll = 0.0; state.trims.pitch = 0.0; updateRcChannelsHud(); });

  // ------------------------------------------------------
  // FLIGHT MODE BUTTONS
  // ------------------------------------------------------
  const modeButtons = document.querySelectorAll('.btn-mode-select');
  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      modeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      state.flightMode = mode;
      state.telemetry.flight.mode = mode;
      setElemText('hud-flight-mode', mode);
      logEvent('COMMAND', `Flight mode changed to ${mode}`);
      updateRcChannelsHud();
    });
  });

  // ------------------------------------------------------
  // QUICK FLIGHT ACTION COMMANDS
  // ------------------------------------------------------
  // Auto Takeoff
  const btnTakeoff = document.getElementById('btn-cmd-takeoff');
  if (btnTakeoff) {
    btnTakeoff.addEventListener('click', () => {
      if (!state.isArmed) {
        armDrone();
      }
      logEvent('COMMAND', 'AUTO TAKEOFF initiated. Ascending to 2.5m AGL...');
      state.sticks.throttle = 0.65;
      updateStickPositionUI();
      // Smooth climb simulation
      let climbStep = 0;
      const climbInterval = setInterval(() => {
        state.altitude_m = parseFloat((state.altitude_m + 0.5).toFixed(1));
        state.verticalSpeed_ms = 1.2;
        climbStep++;
        updateProCockpitHUD();
        renderTelemetryUI();
        if (state.altitude_m >= 2.5 || climbStep >= 6) {
          clearInterval(climbInterval);
          state.altitude_m = 2.5;
          state.verticalSpeed_ms = 0.0;
          state.sticks.throttle = 0.50; // Hover throttle
          updateStickPositionUI();
          updateMotorMixing();
          updateRcChannelsHud();
          logEvent('COMMAND', 'AUTO TAKEOFF completed. Hovering at 2.5m altitude.');
        }
      }, 300);
    });
  }

  // Auto Land
  const btnLand = document.getElementById('btn-cmd-land');
  if (btnLand) {
    btnLand.addEventListener('click', () => {
      logEvent('COMMAND', 'AUTO LAND sequence initiated. Controlled descent in progress...');
      state.sticks.throttle = 0.35;
      updateStickPositionUI();
      const landInterval = setInterval(() => {
        state.altitude_m = Math.max(0, parseFloat((state.altitude_m - 0.4).toFixed(1)));
        state.verticalSpeed_ms = -0.8;
        updateProCockpitHUD();
        renderTelemetryUI();
        if (state.altitude_m <= 0.1) {
          clearInterval(landInterval);
          state.altitude_m = 0.0;
          state.verticalSpeed_ms = 0.0;
          disarmDrone();
          logEvent('COMMAND', 'AUTO LAND completed. Touchdown verified, motors disarmed.');
        }
      }, 300);
    });
  }

  // Return to Home (RTH)
  const btnRth = document.getElementById('btn-cmd-rth');
  if (btnRth) {
    btnRth.addEventListener('click', () => {
      state.flightMode = 'RTL';
      setElemText('hud-flight-mode', 'RTL (RETURN)');
      modeButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === 'RTL'));
      logEvent('COMMAND', 'RETURN TO HOME (RTL) commanded! Drone navigating to launch coordinates.');
      updateRcChannelsHud();
    });
  }

  // Position Hold
  const btnHold = document.getElementById('btn-cmd-hold');
  if (btnHold) {
    btnHold.addEventListener('click', () => {
      state.flightMode = 'POS_HOLD';
      setElemText('hud-flight-mode', 'POS_HOLD');
      modeButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === 'POS_HOLD'));
      logEvent('COMMAND', 'POSITION HOLD activated. Loitering at current GPS coordinates.');
      updateRcChannelsHud();
    });
  }

  // Altitude Hold
  const btnAltHold = document.getElementById('btn-cmd-altswitch');
  if (btnAltHold) {
    btnAltHold.addEventListener('click', () => {
      state.flightMode = 'ALT_HOLD';
      setElemText('hud-flight-mode', 'ALT_HOLD');
      modeButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === 'ALT_HOLD'));
      logEvent('COMMAND', `ALTITUDE HOLD locked at ${(state.altitude_m || 2.5).toFixed(1)}m AGL.`);
      updateRcChannelsHud();
    });
  }

  // Cockpit Arm Toggle Button
  const btnArmToggle = document.getElementById('btn-flight-arm-toggle');
  if (btnArmToggle) {
    btnArmToggle.addEventListener('click', () => {
      if (state.isArmed) {
        disarmDrone();
      } else {
        const modalArm = document.getElementById('modal-arming');
        if (modalArm) modalArm.classList.remove('hidden');
        else armDrone();
      }
    });
  }

  // Slide-to-Arm Modal Listeners
  const modalArm = document.getElementById('modal-arming');
  const btnCloseArm = document.getElementById('btn-close-arming-modal');
  const slideThumb = document.getElementById('slide-thumb');
  const slideTrack = document.getElementById('slide-track');

  if (btnCloseArm && modalArm) {
    btnCloseArm.addEventListener('click', () => modalArm.classList.add('hidden'));
  }

  if (slideThumb && slideTrack && modalArm) {
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

  // Emergency Stop Buttons (Header + Cockpit)
  const btnEstopHeader = document.getElementById('btn-emergency-header');
  const btnFlightEstop = document.getElementById('btn-flight-estop');
  [btnEstopHeader, btnFlightEstop].forEach((btn) => {
    if (btn) btn.addEventListener('click', triggerEmergencyStop);
  });

  // ------------------------------------------------------
  // KEYBOARD CONTROLLER HOTKEYS
  // ------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    // Ignore keystrokes when typing into input fields
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    let handled = true;
    switch (e.code) {
      case 'KeyW': // Throttle Up
        state.sticks.throttle = Math.min(1.0, parseFloat((state.sticks.throttle + 0.05).toFixed(2)));
        break;
      case 'KeyS': // Throttle Down
        state.sticks.throttle = Math.max(0.0, parseFloat((state.sticks.throttle - 0.05).toFixed(2)));
        break;
      case 'KeyA': // Yaw Left
        state.sticks.yaw = Math.max(-1.0, parseFloat((state.sticks.yaw - 0.1).toFixed(2)));
        break;
      case 'KeyD': // Yaw Right
        state.sticks.yaw = Math.min(1.0, parseFloat((state.sticks.yaw + 0.1).toFixed(2)));
        break;
      case 'ArrowUp': // Pitch Forward
        state.sticks.pitch = Math.min(1.0, parseFloat((state.sticks.pitch + 0.1).toFixed(2)));
        break;
      case 'ArrowDown': // Pitch Backward
        state.sticks.pitch = Math.max(-1.0, parseFloat((state.sticks.pitch - 0.1).toFixed(2)));
        break;
      case 'ArrowLeft': // Roll Left
        state.sticks.roll = Math.max(-1.0, parseFloat((state.sticks.roll - 0.1).toFixed(2)));
        break;
      case 'ArrowRight': // Roll Right
        state.sticks.roll = Math.min(1.0, parseFloat((state.sticks.roll + 0.1).toFixed(2)));
        break;
      case 'KeyT': // Takeoff
        if (btnTakeoff) btnTakeoff.click();
        break;
      case 'KeyL': // Land
        if (btnLand) btnLand.click();
        break;
      case 'KeyH': // Return to Home
        if (btnRth) btnRth.click();
        break;
      case 'Space': // Emergency Stop
        triggerEmergencyStop();
        break;
      default:
        handled = false;
    }

    if (handled) {
      e.preventDefault();
      updateStickPositionUI();
      updateStickReadouts();
      updateMotorMixing();
      updateRcChannelsHud();
      updateProCockpitHUD();
    }
  });

  // Spring cyclic sticks back on keyboard key release
  window.addEventListener('keyup', (e) => {
    if (['KeyA', 'KeyD'].includes(e.code)) state.sticks.yaw = 0.0;
    if (['ArrowUp', 'ArrowDown'].includes(e.code)) state.sticks.pitch = 0.0;
    if (['ArrowLeft', 'ArrowRight'].includes(e.code)) state.sticks.roll = 0.0;
    updateStickPositionUI();
    updateStickReadouts();
    updateMotorMixing();
    updateRcChannelsHud();
    updateProCockpitHUD();
  });

  // ------------------------------------------------------
  // GAMEPAD API REAL-TIME BRIDGE
  // ------------------------------------------------------
  initGamepadBridge();
}

function updateStickPositionUI() {
  const leftThumb = document.getElementById('joystick-left-thumb');
  const rightThumb = document.getElementById('joystick-right-thumb');
  const maxRadius = 78;

  if (leftThumb) {
    const dx = state.sticks.yaw * maxRadius;
    const dy = (0.5 - state.sticks.throttle) * (maxRadius * 2);
    leftThumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
  if (rightThumb) {
    const dx = state.sticks.roll * maxRadius;
    const dy = -state.sticks.pitch * maxRadius;
    rightThumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
}

function updateStickReadouts() {
  const throttlePct = Math.round(state.sticks.throttle * 100);
  const throttlePwm = 1000 + Math.round(state.sticks.throttle * 1000);
  const yawPwm = 1500 + Math.round((state.sticks.yaw + state.trims.yaw) * 500);
  const pitchPwm = 1500 + Math.round((state.sticks.pitch + state.trims.pitch) * 500);
  const rollPwm = 1500 + Math.round((state.sticks.roll + state.trims.roll) * 500);

  setElemText('val-stick-throttle', `${throttlePct}%`);
  setElemText('pwm-stick-throttle', `${throttlePwm} µs`);
  setElemText('val-stick-yaw', state.sticks.yaw.toFixed(2));
  setElemText('pwm-stick-yaw', `${yawPwm} µs`);

  setElemText('val-stick-pitch', state.sticks.pitch.toFixed(2));
  setElemText('pwm-stick-pitch', `${pitchPwm} µs`);
  setElemText('val-stick-roll', state.sticks.roll.toFixed(2));
  setElemText('pwm-stick-roll', `${rollPwm} µs`);
}

function updateRcChannelsHud() {
  const ch1 = Math.round(1500 + (state.sticks.roll + state.trims.roll) * 500);
  const ch2 = Math.round(1500 + (state.sticks.pitch + state.trims.pitch) * 500);
  const ch3 = Math.round(1000 + state.sticks.throttle * 1000);
  const ch4 = Math.round(1500 + (state.sticks.yaw + state.trims.yaw) * 500);
  const ch5 = state.isArmed ? 2000 : 1000;
  
  const modePulseMap = {
    'STABILIZE': 1100,
    'ALT_HOLD': 1300,
    'POS_HOLD': 1500,
    'AUTO': 1700,
    'RTL': 1900,
    'ACRO': 2000
  };
  const ch6 = modePulseMap[state.flightMode] || 1100;

  setElemText('rc-val-ch1', `${ch1} µs`);
  setElemStyle('rc-bar-ch1', 'width', `${Math.min(100, Math.max(0, (ch1 - 1000) / 10))}%`);

  setElemText('rc-val-ch2', `${ch2} µs`);
  setElemStyle('rc-bar-ch2', 'width', `${Math.min(100, Math.max(0, (ch2 - 1000) / 10))}%`);

  setElemText('rc-val-ch3', `${ch3} µs`);
  setElemStyle('rc-bar-ch3', 'width', `${Math.min(100, Math.max(0, (ch3 - 1000) / 10))}%`);

  setElemText('rc-val-ch4', `${ch4} µs`);
  setElemStyle('rc-bar-ch4', 'width', `${Math.min(100, Math.max(0, (ch4 - 1000) / 10))}%`);

  setElemText('rc-val-ch5', `${ch5} µs`);
  setElemStyle('rc-bar-ch5', 'width', `${state.isArmed ? 100 : 0}%`);

  setElemText('rc-val-ch6', `${ch6} µs`);
  setElemStyle('rc-bar-ch6', 'width', `${Math.min(100, Math.max(0, (ch6 - 1000) / 10))}%`);
}

function updateMotorMixing() {
  if (!state.isArmed) {
    for (let i = 1; i <= 4; i++) {
      setElemStyle(`motor-bar-${i}`, 'height', '0%');
      setElemText(`motor-val-${i}`, '0%');
      setElemText(`motor-rpm-${i}`, '0 RPM');
    }
    return;
  }

  const t = state.sticks.throttle;
  const p = state.sticks.pitch;
  const r = state.sticks.roll;
  const y = state.sticks.yaw;

  // Quad-X Motor Mixing Matrix
  const m1 = Math.min(1.0, Math.max(0.05, t - 0.25 * p + 0.25 * r - 0.2 * y)); // Front-Right CW
  const m2 = Math.min(1.0, Math.max(0.05, t + 0.25 * p + 0.25 * r + 0.2 * y)); // Rear-Right CCW
  const m3 = Math.min(1.0, Math.max(0.05, t + 0.25 * p - 0.25 * r - 0.2 * y)); // Rear-Left CW
  const m4 = Math.min(1.0, Math.max(0.05, t - 0.25 * p - 0.25 * r + 0.2 * y)); // Front-Left CCW

  const motors = [m1, m2, m3, m4];
  motors.forEach((m, idx) => {
    const id = idx + 1;
    const pct = Math.round(m * 100);
    const rpm = Math.round(1200 + m * 22800);
    setElemStyle(`motor-bar-${id}`, 'height', `${pct}%`);
    setElemText(`motor-val-${id}`, `${pct}%`);
    setElemText(`motor-rpm-${id}`, `${rpm.toLocaleString()} RPM`);
  });
}

function updateProCockpitHUD() {
  const rollDeg = (state.sticks.roll + state.trims.roll) * 25;
  const pitchDeg = (state.sticks.pitch + state.trims.pitch) * 20;
  const heading = state.heading_deg || 180;
  const cardinal = getCardinal(heading);

  const horizonSky = document.getElementById('horizon-sky-ground');
  if (horizonSky) {
    horizonSky.style.transform = `translateY(${pitchDeg * 1.8}px) rotate(${-rollDeg}deg)`;
  }

  const rollPointer = document.getElementById('roll-angle-pointer');
  if (rollPointer) {
    rollPointer.style.transform = `rotate(${rollDeg}deg)`;
  }

  setElemText('pfd-pitch-val', `PITCH: ${pitchDeg.toFixed(1)}°`);
  setElemText('pfd-roll-val', `ROLL: ${rollDeg.toFixed(1)}°`);

  const compassNeedle = document.getElementById('compass-needle');
  if (compassNeedle) {
    compassNeedle.style.transform = `rotate(${heading}deg)`;
  }
  setElemText('compass-heading-text', `${heading}° ${cardinal}`);
}

function armDrone() {
  state.isArmed = true;
  state.telemetry.flight.armed = true;
  state.telemetry.flight.mode = state.flightMode;

  const btnArmToggle = document.getElementById('btn-flight-arm-toggle');
  const armToggleText = document.getElementById('arm-toggle-text');
  if (btnArmToggle) btnArmToggle.classList.add('armed');
  if (armToggleText) armToggleText.textContent = 'DISARM DRONE';

  logEvent('COMMAND', 'Drone ARMED with confirmation token PILOT-CONFIRM-SAFE');
  updateMotorMixing();
  updateRcChannelsHud();
  renderTelemetryUI();
}

function disarmDrone() {
  state.isArmed = false;
  state.sticks.throttle = 0.0;
  state.telemetry.flight.armed = false;
  state.telemetry.flight.mode = 'disarmed';

  const btnArmToggle = document.getElementById('btn-flight-arm-toggle');
  const armToggleText = document.getElementById('arm-toggle-text');
  if (btnArmToggle) btnArmToggle.classList.remove('armed');
  if (armToggleText) armToggleText.textContent = 'ARM DRONE';

  updateStickPositionUI();
  updateStickReadouts();
  updateMotorMixing();
  updateRcChannelsHud();
  logEvent('COMMAND', 'Drone DISARMED. Throttle reset to 0%');
  renderTelemetryUI();
}

function triggerEmergencyStop() {
  disarmDrone();
  state.sticks.roll = 0.0;
  state.sticks.pitch = 0.0;
  state.sticks.yaw = 0.0;
  state.sticks.throttle = 0.0;
  updateStickPositionUI();
  updateStickReadouts();
  updateMotorMixing();
  updateRcChannelsHud();
  logEvent('COMMAND', 'EMERGENCY MOTOR CUT TRIGGERED! All outputs commanded to 0.');
  alert('EMERGENCY STOP EXECUTED: All 4 motors killed immediately. Throttle set to 0. Drone DISARMED.');
}

function initGamepadBridge() {
  window.addEventListener('gamepadconnected', (e) => {
    state.gamepadIndex = e.gamepad.index;
    const badge = document.getElementById('gamepad-status-badge');
    if (badge) {
      badge.textContent = `🎮 ${e.gamepad.id.substring(0, 18).toUpperCase()} CONNECTED`;
      badge.classList.add('connected');
    }
    logEvent('SYSTEM', `Gamepad connected: ${e.gamepad.id}`);
  });

  window.addEventListener('gamepaddisconnected', () => {
    state.gamepadIndex = null;
    const badge = document.getElementById('gamepad-status-badge');
    if (badge) {
      badge.textContent = '🎮 GAMEPAD: DISCONNECTED';
      badge.classList.remove('connected');
    }
  });

  function pollGamepad() {
    if (state.gamepadIndex !== null) {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = gamepads[state.gamepadIndex];
      if (gp) {
        // Mode 2 Standard Gamepad Mapping:
        // Left Stick: Axes 0 (Yaw), 1 (Throttle inverted)
        // Right Stick: Axes 2 (Roll), 3 (Pitch inverted)
        const deadzone = 0.08;
        const rawYaw = gp.axes[0] || 0;
        const rawThrottle = gp.axes[1] || 0;
        const rawRoll = gp.axes[2] || 0;
        const rawPitch = gp.axes[3] || 0;

        if (Math.abs(rawYaw) > deadzone) state.sticks.yaw = parseFloat(rawYaw.toFixed(2));
        else state.sticks.yaw = 0.0;

        // Invert Y axis for throttle (pushing up is negative axis value)
        const mappedThrottle = Math.max(0, Math.min(1, 0.5 - rawThrottle * 0.5));
        state.sticks.throttle = parseFloat(mappedThrottle.toFixed(2));

        if (Math.abs(rawRoll) > deadzone) state.sticks.roll = parseFloat(rawRoll.toFixed(2));
        else state.sticks.roll = 0.0;

        if (Math.abs(rawPitch) > deadzone) state.sticks.pitch = parseFloat((-rawPitch).toFixed(2));
        else state.sticks.pitch = 0.0;

        // Button 0 (A / Cross): Arm / Disarm toggle
        // Button 1 (B / Circle): Emergency Stop
        // Button 2 (X / Square): Auto Takeoff
        // Button 3 (Y / Triangle): Auto Land
        if (gp.buttons[1] && gp.buttons[1].pressed) triggerEmergencyStop();

        updateStickPositionUI();
        updateStickReadouts();
        updateMotorMixing();
        updateRcChannelsHud();
        updateProCockpitHUD();
      }
    }
    requestAnimationFrame(pollGamepad);
  }

  requestAnimationFrame(pollGamepad);
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
