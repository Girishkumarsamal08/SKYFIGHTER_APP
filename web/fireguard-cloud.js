// FIRE GUARDIAN: shows real ESP32 readings from /api/sensor in the existing interface.
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
  const css = (id, prop, v) => { const e = $(id); if (e) e.style[prop] = v; };
  const cls = (id, v) => { const e = $(id); if (e) e.className = v; };
  const badge = (id, label, bg, color) => {
    text(id, label); css(id, 'background', bg); css(id, 'color', color || '#000');
  };
  const when = (ms) => new Date(ms).toLocaleString();
  const mapUrl = (p) => `https://www.google.com/maps?q=${p.latitude},${p.longitude}`;
  const coords = (p) => `${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}`;
  const cause = (a) => (a.flame && a.smoke ? 'FLAME AND SMOKE' : a.flame ? 'FLAME' : 'SMOKE');

  function isOnline() {
    return !!data && !!data.latest && data.ageMs + (Date.now() - fetchedAt) <= 15000;
  }

  // ---------- red alert box ----------
  function buildAlertBox() {
    const style = document.createElement('style');
    style.textContent = `
      #fg-overlay{position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.65)}
      #fg-box{width:100%;max-width:440px;max-height:90vh;overflow:auto;background:#b91c1c;color:#fff;border:3px solid #fecaca;border-radius:14px;padding:20px;text-align:center;box-shadow:0 0 40px rgba(239,68,68,.8)}
      #fg-box h2{margin:0 0 6px;font-size:24px}
      #fg-box p{margin:8px 0;font-size:14px}
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
    text('fg-cause', `${online ? 'Detected' : 'Last reported'}: ${cause(r)} (MQ-2: ${r.smokeValue})`);

    const fix = r.gpsValid ? r : data.lastFix;
    if (fix) {
      text('fg-gps-label', r.gpsValid && online ? 'Drone location' : `No current GPS fix. Last known location from ${when(data.lastFix.at)}`);
      text('fg-coords', coords(fix));
      $('fg-map').href = mapUrl(fix);
    } else {
      text('fg-gps-label', 'Location unavailable: waiting for a GPS fix');
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
    text('hazard-title', !online ? 'DEVICE OFFLINE' : r.danger ? `FIRE EMERGENCY: ${cause(r)} DETECTED` : 'SYSTEM NORMAL');
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
    text('sub-smoke', online ? (r.smoke ? 'DETECTED' : 'NORMAL') : 'No recent data');
    text('status-smoke', na(r.smoke ? 'DETECTED' : 'NORMAL'));
    cls('status-smoke', `badge-sensor-status ${!online ? 'badge-warn' : r.smoke ? 'badge-alert' : 'badge-ok'}`);
    badge('status-smoke-badge', na(r.smoke ? 'DETECTED' : 'NORMAL'), !online ? GREY : r.smoke ? RED : GREEN, r.smoke ? '#fff' : '#000');

    // Flame
    text('val-flame', na(r.flame ? 'DETECTED' : 'NORMAL'));
    cls('val-flame', `metric-value ${!online ? 'text-dim' : r.flame ? 'flame-alert' : 'flame-safe'}`);
    text('sub-flame', online ? 'GPIO 27' : 'No recent data');
    text('status-flame', na(r.flame ? 'DETECTED' : 'NORMAL'));
    cls('status-flame', `badge-sensor-status ${!online ? 'badge-warn' : r.flame ? 'badge-alert' : 'badge-ok'}`);
    badge('status-flame-badge', na(r.flame ? 'DETECTED' : 'NORMAL'), !online ? GREY : r.flame ? RED : GREEN, r.flame ? '#fff' : '#000');
    text('flame-sensor-state-text', na(r.flame ? '🔥 FLAME DETECTED!' : 'NORMAL'));
    css('flame-sensor-state-text', 'color', online && r.flame ? RED : '');
    css('flame-sensor-icon', 'filter', online && r.flame ? 'none' : 'grayscale(1)');
    css('flame-sensor-icon', 'opacity', online && r.flame ? '1' : '0.4');
    text('val-flame-pin-level', na(r.flame ? 'LOW (flame)' : 'HIGH (no flame)'));

    // Buzzer follows the same danger value as the ESP32
    text('status-buzzer-badge', na(r.danger ? 'ON' : 'OFF'));
    text('val-buzzer-state-text', online ? `BUZZER: ${r.danger ? 'ON' : 'OFF (SILENT)'}` : 'BUZZER: UNKNOWN');

    // GPS: never show coordinates as current without a current fix
    const fix = online && r.gpsValid;
    text('gps-label', fix ? 'GPS: FIX' : online ? 'GPS: NO FIX' : 'GPS: OFFLINE');
    text('val-coords', fix ? coords(r) : 'NO FIX');
    text('sub-gps', fix ? 'Current position' : data.lastFix ? `Last fix: ${coords(data.lastFix)}` : 'No fix received yet');
    text('status-gps', fix ? 'FIX' : 'NO FIX');
    text('map-lat', fix ? r.latitude.toFixed(6) : '--');
    text('map-lon', fix ? r.longitude.toFixed(6) : '--');
    text('map-alt', '--');
    text('map-sats', fix ? 'GPS Fix' : 'No GPS Fix');
    text('map-drone-pos', fix ? `DRONE: ${coords(r)}` : 'DRONE: NO GPS FIX');
    text('diag-gps-lat', fix ? r.latitude.toFixed(6) : '--');
    text('diag-gps-lon', fix ? r.longitude.toFixed(6) : '--');
    text('diag-gps-sat-count', '--');
    text('diag-gps-fix-type', fix ? 'Valid fix' : 'No fix');
    badge('status-gps-diag-badge', fix ? 'FIX' : 'NO FIX', fix ? GREEN : AMBER);

    badge('esp32-hw-conn-badge', online ? 'ESP32: ONLINE (CLOUD)' : 'ESP32: OFFLINE', online ? GREEN : RED, online ? '#000' : '#fff');
    text('badge-system-link', online ? 'ONLINE' : 'OFFLINE');
    text('diag-esp-link-state', online ? 'CONNECTED' : 'DISCONNECTED');
    text('diag-sensor-last-ts', updated);
    text('diag-telemetry-status', online ? 'Receiving' : 'No recent packets');
    text('lcd-line-1', 'NO LCD FITTED');
    text('lcd-line-2', '');
  }

  // ---------- alert history in the Alert Center ----------
  function renderHistory() {
    const screen = $('screen-alerts');
    if (!screen) return;
    let box = $('fg-history');
    if (!box) {
      box = document.createElement('div');
      box.id = 'fg-history';
      box.style.cssText = 'margin-top:16px;padding:14px;border:1px solid rgba(255,255,255,.12);border-radius:10px;font-size:13px';
      screen.appendChild(box);
    }
    const all = (data.activeAlert ? [data.activeAlert] : []).concat(data.history);
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
        row.append('no GPS fix');
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
