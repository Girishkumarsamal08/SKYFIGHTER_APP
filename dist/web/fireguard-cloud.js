// FIRE GUARDIAN: shows real ESP32 readings and AI detections from /api/sensor in the existing interface.
(function () {
  'use strict';
  const POLL_MS = 2000;
  const RED = '#ef4444', GREEN = '#22c55e', GREY = '#8a96aa', AMBER = '#f59e0b';

  let data = null;          // last successful API response
  let fetchedAt = 0;
  let hiddenAlert = null;   // alert id the viewer chose to hide
  let busy = false;

  const $ = (id) => document.getElementById(id);
  const text = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  const html = (id, v) => { const e = $(id); if (e) e.innerHTML = v; };
  const css = (id, prop, v) => { const e = $(id); if (e) e.style[prop] = v; };
  const cls = (id, v) => { const e = $(id); if (e) e.className = v; };
  const badge = (id, label, bg, color) => {
    text(id, label); css(id, 'background', bg); css(id, 'color', color || '#000');
  };
  const when = (ms) => new Date(ms).toLocaleString();
  const mapUrl = (p) => `https://www.google.com/maps?q=${p.latitude},${p.longitude}`;
  const coords = (p) => `${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}`;

  function cause(a) {
    if (!a) return 'UNKNOWN';
    if (a.sources && Array.isArray(a.sources) && a.sources.length) {
      return a.sources.map((s) => s.replace(/_/g, ' ')).join(' + ');
    }
    const tags = [];
    if (a.aiFire) tags.push('AI CAM FIRE');
    if (a.aiSmoke) tags.push('AI CAM SMOKE');
    if (a.flame) tags.push('PHYSICAL FLAME (GPIO 27)');
    if (a.smoke) tags.push('PHYSICAL SMOKE (GPIO 34)');
    return tags.length ? tags.join(' + ') : 'EMERGENCY HAZARD';
  }

  function isOnline() {
    return !!data && !!data.latest && data.ageMs + (Date.now() - fetchedAt) <= 15000;
  }

  // ---------- red alert box ----------
  function buildAlertBox() {
    const style = document.createElement('style');
    style.textContent = `
      #fg-overlay{position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.65)}
      #fg-box{width:100%;max-width:460px;max-height:90vh;overflow:auto;background:#b91c1c;color:#fff;border:3px solid #fecaca;border-radius:14px;padding:20px;text-align:center;box-shadow:0 0 40px rgba(239,68,68,.8)}
      #fg-box h2{margin:0 0 6px;font-size:24px}
      #fg-box p{margin:8px 0;font-size:14px}
      #fg-sources-tag{display:inline-block;background:rgba(0,0,0,.35);padding:4px 10px;border-radius:6px;font-family:monospace;font-size:12px;margin:4px 0 8px;border:1px solid rgba(255,255,255,.2)}
      #fg-coords{font-family:var(--font-mono,monospace);font-size:18px;font-weight:700}
      #fg-map,#fg-hide{display:inline-block;margin:8px 4px 0;padding:10px 16px;border-radius:8px;border:2px solid #fff;font-weight:700;font-size:13px;cursor:pointer;text-decoration:none}
      #fg-map{background:#fff;color:#991b1b}
      #fg-hide{background:transparent;color:#fff}
      #fg-bar{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:100000;display:none;background:#dc2626;color:#fff;border:2px solid #fecaca;border-radius:999px;padding:10px 18px;font-weight:700;cursor:pointer;white-space:nowrap}`;
    document.head.appendChild(style);

    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div id="fg-overlay" role="alertdialog" aria-labelledby="fg-title">
        <div id="fg-box">
          <h2 id="fg-title">🔥 FIRE EMERGENCY</h2>
          <div id="fg-sources-tag"></div>
          <p id="fg-cause"></p>
          <p id="fg-gps-label"></p>
          <p id="fg-coords"></p>
          <p id="fg-time"></p>
          <a id="fg-map" target="_blank" rel="noopener noreferrer">📍 Open in Google Maps</a>
          <button id="fg-hide" type="button">Hide</button>
        </div>
      </div>
      <button id="fg-bar" type="button">🔥 Fire alert active. View</button>`;
    document.body.append(...wrap.children);

    $('fg-hide').onclick = () => { hiddenAlert = data.activeAlert.id; renderAlertBox(); };
    $('fg-bar').onclick = () => { hiddenAlert = null; renderAlertBox(); };
  }

  function renderAlertBox() {
    const a = data && data.activeAlert;
    const show = !!a && !!data.latest && data.latest.danger;
    css('fg-overlay', 'display', show && hiddenAlert !== a.id ? 'flex' : 'none');
    css('fg-bar', 'display', show && hiddenAlert === a.id ? 'block' : 'none');
    if (!show) return;

    const r = data.latest;
    const online = isOnline();
    text('fg-title', online ? '🔥 FIRE EMERGENCY' : '⚠️ ALERT: SIGNAL LOST');
    text('fg-sources-tag', `ORIGIN: ${cause(a)}`);
    text('fg-cause', `${online ? 'Detected' : 'Last reported'}: ${cause(r)} (MQ-2: ${r.smokeValue})`);

    const fix = r.gpsValid ? r : data.lastFix;
    if (fix) {
      text('fg-gps-label', r.gpsValid && online ? 'Drone location' : `No current GPS fix. Last known location from ${when(data.lastFix.at)}`);
      text('fg-coords', coords(fix));
      $('fg-map').href = mapUrl(fix);
    } else {
      text('fg-gps-label', 'Location unavailable: GPS SIGNAL NOT AVAILABLE');
      text('fg-coords', '');
    }
    css('fg-map', 'display', fix ? 'inline-block' : 'none');
    text('fg-time', `Started ${when(a.startedAt)} · Updated ${when(r.receivedAt)}`);
  }

  // ---------- existing dashboard elements ----------
  function renderDashboard() {
    const r = data.latest;
    const online = isOnline();
    const updated = when(r.receivedAt);
    const na = (v) => (online ? v : 'OFFLINE');

    cls('conn-pill', `status-pill ${online ? 'status-connected' : 'status-disconnected'}`);
    text('conn-label', online ? 'CONNECTED (CLOUD)' : 'DEVICE OFFLINE');
    text('sim-badge', online ? 'LIVE CLOUD DATA' : 'DEVICE OFFLINE');
    cls('sim-badge', online ? 'sim-pill' : 'sim-pill disconnected');
    text('latency-text', `LAST DATA: ${updated}`);

    const level = !online ? 'banner-disconnected' : r.danger ? 'banner-critical' : 'banner-normal';
    cls('dashboard-hazard-banner', `hazard-banner ${level}`);
    text('hazard-icon', !online ? '📡' : r.danger ? '🔥' : '✅');
    text('hazard-title', !online ? 'DEVICE OFFLINE' : r.danger ? `FIRE EMERGENCY: ${cause(r)}` : 'SYSTEM NORMAL');
    text('hazard-desc', online ? `Live ESP32 data. Updated ${updated}` : `No recent data. Last reading received ${updated}`);

    text('sub-temp', 'Not sent by this device');
    text('sub-humidity', 'Not sent by this device');

    // Smoke
    text('val-smoke', na(`${r.smokeValue} ADC`));
    text('val-mq2-raw-ao', na(`${r.smokeValue} / 4095`));
    const pct = online ? `${(r.smokeValue / 4095) * 100}%` : '0%';
    css('bar-smoke', 'width', pct);
    css('bar-mq2-fill', 'width', pct);
    css('bar-mq2-fill', 'background', r.smoke ? RED : GREEN);
    text('sub-smoke', online ? (r.smoke ? 'DETECTED (THRESHOLD EXCEEDED)' : 'NORMAL') : 'No recent data');
    text('status-smoke', na(r.smoke ? 'DETECTED' : 'NORMAL'));
    cls('status-smoke', `badge-sensor-status ${!online ? 'badge-warn' : r.smoke ? 'badge-alert' : 'badge-ok'}`);
    badge('status-smoke-badge', na(r.smoke ? 'DETECTED' : 'NORMAL'), !online ? GREY : r.smoke ? RED : GREEN, r.smoke ? '#fff' : '#000');

    // Flame
    text('val-flame', na(r.flame ? 'DETECTED' : 'NORMAL'));
    cls('val-flame', `metric-value ${!online ? 'text-dim' : r.flame ? 'flame-alert' : 'flame-safe'}`);
    text('sub-flame', online ? 'GPIO 27 (Active-LOW)' : 'No recent data');
    text('status-flame', na(r.flame ? 'DETECTED' : 'NORMAL'));
    cls('status-flame', `badge-sensor-status ${!online ? 'badge-warn' : r.flame ? 'badge-alert' : 'badge-ok'}`);
    badge('status-flame-badge', na(r.flame ? 'DETECTED' : 'NORMAL'), !online ? GREY : r.flame ? RED : GREEN, r.flame ? '#fff' : '#000');
    text('flame-sensor-state-text', na(r.flame ? '🔥 FLAME DETECTED!' : 'NORMAL'));
    css('flame-sensor-state-text', 'color', online && r.flame ? RED : '');
    css('flame-sensor-icon', 'filter', online && r.flame ? 'none' : 'grayscale(1)');
    css('flame-sensor-icon', 'opacity', online && r.flame ? '1' : '0.4');
    text('val-flame-pin-level', na(r.flame ? 'LOW (flame active)' : 'HIGH (no flame)'));

    // AI Camera Fire & Smoke
    const aiFireActive = Boolean(r.aiFire);
    const aiSmokeActive = Boolean(r.aiSmoke);
    text('val-status-fire-ai', na(aiFireActive ? 'ACTIVE FLAME' : 'CLEAR'));
    css('val-status-fire-ai', 'color', online && aiFireActive ? RED : GREEN);
    text('sub-status-fire-ai', online ? (aiFireActive ? 'AI Vision Lock' : 'No optical fire') : 'Standby');

    text('val-status-smoke-ai', na(aiSmokeActive ? 'SMOKE PLUME' : 'CLEAR'));
    css('val-status-smoke-ai', 'color', online && aiSmokeActive ? AMBER : GREEN);
    text('sub-status-smoke-ai', online ? (aiSmokeActive ? 'AI Plume Lock' : 'Normal index') : 'Standby');

    // Buzzer follows the combined danger value as the ESP32 hardware
    text('status-buzzer-badge', na(r.danger ? 'ON' : 'OFF'));
    text('val-buzzer-state-text', online ? `BUZZER: ${r.danger ? 'ON (ALARM ACTIVE)' : 'OFF (SILENT)'}` : 'BUZZER: UNKNOWN');

    // GPS: never show coordinates as current without a current fix
    const fix = online && r.gpsValid && Number.isFinite(r.latitude) && Number.isFinite(r.longitude);
    text('gps-label', fix ? 'GPS: FIX' : online ? 'GPS: NO FIX' : 'GPS: OFFLINE');
    text('val-coords', fix ? coords(r) : 'GPS SIGNAL NOT AVAILABLE');
    text('sub-gps', fix ? 'Live NEO-7M Fix' : data.lastFix ? `Last fix: ${coords(data.lastFix)} (${when(data.lastFix.at)})` : 'GPS SIGNAL NOT AVAILABLE');
    text('status-gps', fix ? 'FIX' : 'NO FIX');
    text('map-lat', fix ? r.latitude.toFixed(6) : '--');
    text('map-lon', fix ? r.longitude.toFixed(6) : '--');
    text('map-alt', '--');
    text('map-sats', fix ? 'GPS Fix (Locked)' : 'No GPS Fix');
    text('map-drone-pos', fix ? `DRONE: ${coords(r)}` : (data.lastFix ? `DRONE LAST KNOWN: ${coords(data.lastFix)}` : 'DRONE: GPS SIGNAL NOT AVAILABLE'));
    text('diag-gps-lat', fix ? r.latitude.toFixed(6) : '--');
    text('diag-gps-lon', fix ? r.longitude.toFixed(6) : '--');
    text('diag-gps-sat-count', fix ? 'Locked' : '--');
    text('diag-gps-fix-type', fix ? 'Valid 3D Lock' : (data.lastFix ? 'Fix Lost (Last Known Stored)' : 'GPS SIGNAL NOT AVAILABLE'));
    badge('status-gps-diag-badge', fix ? 'FIX' : 'NO FIX', fix ? GREEN : AMBER);

    badge('esp32-hw-conn-badge', online ? 'ESP32: ONLINE (CLOUD)' : 'ESP32: OFFLINE', online ? GREEN : RED, online ? '#000' : '#fff');
    text('badge-system-link', online ? 'ONLINE' : 'OFFLINE');
    text('diag-esp-link-state', online ? 'CONNECTED' : 'DISCONNECTED');
    text('diag-sensor-last-ts', updated);
    text('diag-telemetry-status', online ? 'Receiving telemetry' : 'No recent packets');
    text('lcd-line-1', r.danger ? '! FIRE DETECTED !' : 'FG: SENSORS OK  ');
    text('lcd-line-2', `MQ:${r.smokeValue} GPS:${fix ? 'FIX ' : 'WAIT'}`);

    // Update Animal Detections Table
    renderAnimalHistory();
  }

  // ---------- animal detection history ----------
  function renderAnimalHistory() {
    const tbody = $('detection-history-tbody-ai');
    if (!tbody || !data || !Array.isArray(data.animalHistory) || !data.animalHistory.length) return;

    let rowsHtml = '';
    data.animalHistory.forEach((item, idx) => {
      const gpsText = item.gpsValid && Number.isFinite(item.latitude) && Number.isFinite(item.longitude)
        ? `<a href="${mapUrl(item)}" target="_blank" rel="noopener noreferrer" style="color:#00d4ff;text-decoration:none;font-weight:bold;">📍 ${coords(item)}</a>`
        : `<span style="color:#8a96aa;font-size:10px;">GPS SIGNAL NOT AVAILABLE</span>`;

      const sevColor = (item.threatCategory === 'CRITICAL' || item.threatCategory === 'HIGH') ? RED : GREEN;
      rowsHtml += `<tr>
        <td style="font-family:monospace;color:#00d4ff;">#${idx + 1}</td>
        <td style="font-family:monospace;font-size:11px;">${when(item.timestamp)}</td>
        <td><strong>${item.species}</strong></td>
        <td><span style="color:#8a96aa;">Wildlife</span></td>
        <td style="font-family:monospace;color:#22c55e;">${item.confidence}%</td>
        <td>${gpsText}</td>
        <td><span style="background:${sevColor};color:#000;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:bold;">${item.threatCategory || 'INFO'}</span></td>
        <td><span style="color:#22c55e;font-size:11px;">VERIFIED</span></td>
      </tr>`;
    });
    tbody.innerHTML = rowsHtml;
  }

  // ---------- alert history in the Alert Center ----------
  function renderHistory() {
    const tableBody = $('incidents-table-body');
    const all = (data.activeAlert ? [data.activeAlert] : []).concat(data.history || []);

    if (tableBody) {
      if (!all.length) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#8a96aa;padding:24px;">No hazard alerts recorded. Environmental conditions nominal.</td></tr>`;
      } else {
        tableBody.innerHTML = all.map((a) => {
          const isOngoing = !a.endedAt;
          const statusText = isOngoing ? 'ACTIVE EMERGENCY' : (a.endReason === 'SIGNAL_LOST' ? 'SIGNAL LOST' : 'CLEARED');
          const statusColor = isOngoing ? RED : (a.endReason === 'SIGNAL_LOST' ? AMBER : GREEN);
          const sourceTag = a.sources && a.sources.length ? a.sources.join(', ') : (a.flame && a.smoke ? 'PHYSICAL_FLAME, PHYSICAL_SMOKE' : (a.flame ? 'PHYSICAL_FLAME' : 'PHYSICAL_SMOKE'));

          const locText = a.location
            ? `<a href="${mapUrl(a.location)}" target="_blank" rel="noopener noreferrer" style="color:#00d4ff;text-decoration:none;">📍 ${coords(a.location)}</a>`
            : `<span style="color:#8a96aa;font-size:11px;">GPS SIGNAL NOT AVAILABLE</span>`;

          return `<tr>
            <td style="font-family:monospace;font-size:11px;">${when(a.startedAt)}</td>
            <td><span style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;font-size:10px;font-family:monospace;color:#38bdf8;">${sourceTag}</span></td>
            <td><strong>${cause(a)}</strong></td>
            <td><span style="background:${isOngoing ? RED : AMBER};color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:bold;">CRITICAL</span></td>
            <td style="font-size:11px;color:#cbd5e1;">Hardware Interlock Active</td>
            <td>${locText}</td>
            <td><span style="color:${statusColor};font-weight:bold;font-size:11px;">${statusText}</span></td>
          </tr>`;
        }).join('');
      }
    }

    // Also update fg-history container if present
    const screen = $('screen-alerts');
    if (!screen) return;
    let box = $('fg-history');
    if (!box) {
      box = document.createElement('div');
      box.id = 'fg-history';
      box.style.cssText = 'margin-top:16px;padding:14px;border:1px solid rgba(255,255,255,.12);border-radius:10px;font-size:13px';
      screen.appendChild(box);
    }
    const title = document.createElement('strong');
    title.textContent = 'Drone sensor alert history';
    const rows = all.map((a) => {
      const row = document.createElement('div');
      row.style.cssText = 'padding:8px 0;border-top:1px solid rgba(255,255,255,.08)';
      const end = !a.endedAt ? 'ongoing' : `${a.endReason === 'SIGNAL_LOST' ? 'signal lost' : 'cleared'} ${when(a.endedAt)}`;
      row.append(`${when(a.startedAt)} · ${cause(a)} · ${end} · `);
      if (a.location) {
        const link = document.createElement('a');
        link.href = mapUrl(a.location);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.color = '#00e5ff';
        link.textContent = coords(a.location);
        row.append(link);
      } else {
        row.append('GPS SIGNAL NOT AVAILABLE');
      }
      return row;
    });
    if (!rows.length) {
      const none = document.createElement('div');
      none.textContent = 'No alerts recorded.';
      rows.push(none);
    }
    box.replaceChildren(title, ...rows);
  }

  // Called by app.js. Returns true when cloud data owns the display.
  function render() {
    if (!data || !data.latest) return false;
    renderDashboard();
    return true;
  }

  async function poll() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const res = await fetch('/api/sensor', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      fetchedAt = Date.now();
      renderAlertBox();
      renderHistory();
      renderDashboard();
    } catch (e) {
      console.warn('[FIRE GUARDIAN] Could not load sensor data:', e.message);
      renderAlertBox(); // the age check turns old data into "signal lost"
    } finally {
      busy = false;
    }
  }

  window.fireGuardianCloud = { render };

  document.addEventListener('DOMContentLoaded', () => {
    buildAlertBox();
    poll();
    setInterval(poll, POLL_MS);
  });
})();
