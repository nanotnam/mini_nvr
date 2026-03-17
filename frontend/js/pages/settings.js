/* Settings page – ZLMediaKit config form */
const PageSettings = {
  components: { AppSwitch },
  template: `
    <div style="max-width:800px;margin:auto">
      <div class="card">
        <div class="card-header">Default Settings</div>
        <div class="card-body">
          <!-- Timestamp handling -->
          <div class="form-row"><label class="form-label">Timestamp handling</label><div class="form-field">
            <select class="select" v-model="form.modify_stamp">
              <option value="0">Use original timestamps</option>
              <option value="1">Use system time on receive (smoothed)</option>
              <option value="2">Use relative timestamps (corrected)</option>
            </select>
          </div></div>

          <!-- Audio processing -->
          <div class="form-row"><label class="form-label">Audio processing</label><div class="form-field">
            <select class="select" v-model="form.audio_process">
              <option value="0">No audio in output</option>
              <option value="1">Forward original audio</option>
              <option value="2">Forward muted audio</option>
            </select>
          </div></div>

          <!-- RTSP distribution -->
          <div class="form-row"><label class="form-label">RTSP distribution</label><div class="form-field inline-flex gap-16">
            <label class="inline-flex gap-8"><app-switch v-model="form.enable_rtsp" /> Enable</label>
            <label class="inline-flex gap-8"><app-switch v-model="form.rtsp_demand" /> On demand</label>
          </div></div>

          <!-- RTP transport mode -->
          <div class="form-row"><label class="form-label">RTP transport mode</label><div class="form-field">
            <select class="select" v-model="form.rtpTransportType">
              <option value="-1">Any</option>
              <option value="0">TCP</option>
              <option value="1">UDP</option>
              <option value="2">Multicast</option>
            </select>
            <div class="form-hint">Force the specified RTP transport for RTSP pull clients.</div>
          </div></div>

          <!-- RTSP direct proxy -->
          <div class="form-row"><label class="form-label">RTSP direct proxy</label><div class="form-field">
            <select class="select" v-model="form.directProxy_rtsp">
              <option value="1">Enable</option>
              <option value="0">Disable</option>
            </select>
            <div class="form-hint">Enables proxying of non-standard codecs, but may break GOP cache or WebRTC.</div>
          </div></div>

          <!-- H.264 RTP packing -->
          <div class="form-row"><label class="form-label">H.264 RTP packing mode</label><div class="form-field">
            <select class="select" v-model="form.h264_stap_a">
              <option value="1">STAP-A (better WebRTC compatibility)</option>
              <option value="0">Single NAL (better legacy RTSP compatibility)</option>
            </select>
          </div></div>

          <!-- RTMP distribution -->
          <div class="form-row"><label class="form-label">RTMP distribution</label><div class="form-field inline-flex gap-16">
            <label class="inline-flex gap-8"><app-switch v-model="form.enable_rtmp" /> Enable</label>
            <label class="inline-flex gap-8"><app-switch v-model="form.rtmp_demand" /> On demand</label>
          </div></div>

          <!-- RTMP direct proxy -->
          <div class="form-row"><label class="form-label">RTMP direct proxy</label><div class="form-field">
            <select class="select" v-model="form.directProxy_rtmp">
              <option value="1">Enable</option>
              <option value="0">Disable</option>
            </select>
            <div class="form-hint">Skips A/V parsing; supports non-standard codecs but disables GOP cache.</div>
          </div></div>

          <!-- H.265 RTMP -->
          <div class="form-row"><label class="form-label">H.265 RTMP packing standard</label><div class="form-field">
            <select class="select" v-model="form.rtmp_enhanced">
              <option value="0">Chinese extension standard (default)</option>
              <option value="1">Enhanced RTMP (ISO/IEC 14496-15)</option>
            </select>
            <div class="form-hint">Must match the push client setting.</div>
          </div></div>

          <!-- HLS distribution -->
          <div class="form-row"><label class="form-label">HLS distribution</label><div class="form-field inline-flex gap-16" style="flex-wrap:wrap">
            <label class="inline-flex gap-8"><app-switch v-model="form.enable_hls_ts" /> HLS-mpegts</label>
            <label class="inline-flex gap-8"><app-switch v-model="form.enable_hls_fmp4" /> HLS-fMP4</label>
            <label class="inline-flex gap-8"><app-switch v-model="form.hls_demand" /> On demand</label>
          </div></div>

          <!-- HLS segment duration -->
          <div class="form-row"><label class="form-label">HLS segment duration (s)</label><div class="form-field">
            <input class="input" type="number" v-model.number="form.segDur" min="1" max="10000" />
            <div class="form-hint">Duration of each .ts segment. Affects latency and number of files.</div>
          </div></div>

          <!-- HTTP-TS distribution -->
          <div class="form-row"><label class="form-label">HTTP-TS distribution</label><div class="form-field inline-flex gap-16">
            <label class="inline-flex gap-8"><app-switch v-model="form.enable_http_ts" /> Enable</label>
            <label class="inline-flex gap-8"><app-switch v-model="form.ts_demand" /> On demand</label>
          </div></div>

          <!-- HTTP-fMP4 distribution -->
          <div class="form-row"><label class="form-label">HTTP-fMP4 distribution</label><div class="form-field inline-flex gap-16">
            <label class="inline-flex gap-8"><app-switch v-model="form.enable_http_fmp4" /> Enable</label>
            <label class="inline-flex gap-8"><app-switch v-model="form.fmp4_demand" /> On demand</label>
          </div></div>

          <!-- Re-push timeout -->
          <div class="form-row"><label class="form-label">Re-push timeout</label><div class="form-field">
            <input class="input" type="number" v-model.number="form.continue_push_ms" min="0" max="60000" step="1000" placeholder="ms" />
            <div class="form-hint">If a push arrives within this period after disconnect it is treated as continuous. 0 = disabled.</div>
          </div></div>

          <!-- Paced sender -->
          <div class="form-row"><label class="form-label">Paced sender interval</label><div class="form-field">
            <input class="input" type="number" v-model.number="form.paced_sender_ms" min="0" max="100" placeholder="ms" />
            <div class="form-hint">Helps smooth out uneven forwarding. 0 = disabled.</div>
          </div></div>

          <!-- Recording file buffer -->
          <div class="form-row"><label class="form-label">Recording file buffer size</label><div class="form-field">
            <input class="input" type="number" v-model.number="form.fileBufSize" min="0" />
          </div></div>

          <!-- Recording fastStart -->
          <div class="form-row"><label class="form-label">Recording fastStart</label><div class="form-field">
            <select class="select" v-model="form.fastStart"><option value="0">No</option><option value="1">Yes</option></select>
          </div></div>

          <!-- Use fMP4 for recording -->
          <div class="form-row"><label class="form-label">Use fMP4 for recording</label><div class="form-field">
            <select class="select" v-model="form.enableFmp4"><option value="0">No</option><option value="1">Yes</option></select>
          </div></div>

          <!-- GOP cache -->
          <div class="form-row"><label class="form-label">GOP cache count</label><div class="form-field">
            <input class="input" type="number" v-model.number="form.gop_cache" min="0" placeholder="0~500" />
            <div class="form-hint">Cache N recent GOPs for instant playback. 0=off.</div>
          </div></div>

          <!-- G.711 RTP duration -->
          <div class="form-row"><label class="form-label">G.711 RTP packet duration</label><div class="form-field">
            <input class="input" type="number" v-model.number="form.rtp_g711_dur_ms" min="20" step="20" placeholder="20~180" />
            <div class="form-hint">Voice duration per G.711 RTP packet (ms, range 20-180).</div>
          </div></div>

          <!-- WebRTC external IP -->
          <div class="form-row"><label class="form-label">WebRTC external IP</label><div class="form-field inline-flex gap-8" style="flex-wrap:wrap;align-items:center">
            <input class="input" type="text" v-model="form.rtc_externIP" placeholder="Empty = auto (host only)" style="min-width:140px" />
            <button type="button" class="btn btn-secondary" @click="detectLanIp" :disabled="detecting">Detect</button>
            <div class="form-hint" style="flex-basis:100%;margin-top:4px">Required for WebRTC from other LAN devices. Leave empty if viewing only on this host.</div>
          </div></div>

          <!-- WebRTC port -->
          <div class="form-row"><label class="form-label">WebRTC port</label><div class="form-field">
            <input class="input" type="number" v-model.number="form.rtc_port" min="1" max="65535" placeholder="8000" />
            <div class="form-hint">Must match ZLM_RTC_PORT and docker port mapping (e.g. 8001:8001). Default 8000.</div>
          </div></div>
        </div>
      </div>
      <div style="display:flex;justify-content:center;padding:16px 0 32px">
        <button class="btn btn-primary" @click="applySettings" :disabled="applying">
          {{ applying ? applyStatus : 'Apply Settings (restarts ZLM)' }}
        </button>
      </div>
    </div>`,

  setup() {
    const form = reactive({
      modify_stamp: '0', audio_process: '0',
      enable_rtsp: false, rtsp_demand: false,
      rtpTransportType: '-1', directProxy_rtsp: '1', h264_stap_a: '1',
      enable_rtmp: false, rtmp_demand: false,
      directProxy_rtmp: '1', rtmp_enhanced: '0',
      enable_hls_ts: false, enable_hls_fmp4: false, hls_demand: false,
      segDur: 2,
      enable_http_ts: false, ts_demand: false,
      enable_http_fmp4: false, fmp4_demand: false,
      continue_push_ms: 0, paced_sender_ms: 0,
      fileBufSize: 0, fastStart: '0', enableFmp4: '0',
      gop_cache: 1, rtp_g711_dur_ms: 100,
      rtc_externIP: '',
    });

    const applying = ref(false);
    const applyStatus = ref('');
    const detecting = ref(false);

    async function loadConfig() {
      try {
        const res = await fetch('/api/server/config').then(r => r.json());
        if (res.code === 0 && res.data && res.data.length > 0) {
          const c = res.data[0];
          const enableAudio = Number(c['protocol.enable_audio']);
          const addMute = Number(c['protocol.add_mute_audio']);
          form.audio_process = String(enableAudio === 0 ? 0 : addMute === 0 ? 1 : 2);
          form.modify_stamp = String(Number(c['protocol.modify_stamp']));
          form.enable_rtsp = Number(c['protocol.enable_rtsp']) === 1;
          form.rtsp_demand = Number(c['protocol.rtsp_demand']) === 1;
          form.rtpTransportType = String(Number(c['rtsp.rtpTransportType']));
          form.directProxy_rtsp = String(Number(c['rtsp.directProxy']));
          form.h264_stap_a = String(Number(c['rtp.h264_stap_a']));
          form.enable_rtmp = Number(c['protocol.enable_rtmp']) === 1;
          form.rtmp_demand = Number(c['protocol.rtmp_demand']) === 1;
          form.directProxy_rtmp = String(Number(c['rtmp.directProxy']));
          form.rtmp_enhanced = String(Number(c['rtmp.enhanced']));
          form.enable_hls_ts = Number(c['protocol.enable_hls']) === 1;
          form.enable_hls_fmp4 = Number(c['protocol.enable_hls_fmp4']) === 1;
          form.hls_demand = Number(c['protocol.hls_demand']) === 1;
          form.segDur = Number(c['hls.segDur']);
          form.enable_http_ts = Number(c['protocol.enable_ts']) === 1;
          form.ts_demand = Number(c['protocol.ts_demand']) === 1;
          form.enable_http_fmp4 = Number(c['protocol.enable_fmp4']) === 1;
          form.fmp4_demand = Number(c['protocol.fmp4_demand']) === 1;
          form.continue_push_ms = Number(c['protocol.continue_push_ms']);
          form.paced_sender_ms = Number(c['protocol.paced_sender_ms']);
          form.fileBufSize = Number(c['record.fileBufSize']);
          form.fastStart = String(Number(c['record.fastStart']));
          form.enableFmp4 = String(Number(c['record.enableFmp4']));
          form.gop_cache = Number(c['rtp_proxy.gop_cache']);
          form.rtp_g711_dur_ms = Number(c['rtp_proxy.rtp_g711_dur_ms']);
          form.rtc_externIP = String(c['rtc.externIP'] ?? '').trim();
          form.rtc_port = Number(c['rtc.port'] ?? 8000) || 8000;
        }
      } catch { $toast('Failed to load config', 'error'); }
    }

    async function detectLanIp() {
      detecting.value = true;
      try {
        const res = await fetch('/api/server/lan-ip').then(r => r.json());
        if (res.code === 0 && res.ip) {
          form.rtc_externIP = res.ip;
          $toast('Detected: ' + res.ip, 'success');
        } else {
          $toast('Could not detect LAN IP', 'error');
        }
      } catch {
        $toast('Failed to detect LAN IP', 'error');
      } finally {
        detecting.value = false;
      }
    }

    async function applySettings() {
      applying.value = true;
      applyStatus.value = 'Applying configuration...';

      let enableAudio = '0', addMuteAudio = '0';
      if (form.audio_process === '0') { enableAudio = '0'; addMuteAudio = '1'; }
      else if (form.audio_process === '1') { enableAudio = '1'; addMuteAudio = '0'; }
      else if (form.audio_process === '2') { enableAudio = '1'; addMuteAudio = '1'; }

      const b = (v) => v ? '1' : '0';
      const putData = {
        'protocol.modify_stamp': form.modify_stamp,
        'protocol.enable_audio': enableAudio,
        'protocol.add_mute_audio': addMuteAudio,
        'protocol.enable_rtsp': b(form.enable_rtsp),
        'protocol.rtsp_demand': b(form.rtsp_demand),
        'rtsp.rtpTransportType': form.rtpTransportType,
        'rtsp.directProxy': form.directProxy_rtsp,
        'rtp.h264_stap_a': form.h264_stap_a,
        'protocol.enable_rtmp': b(form.enable_rtmp),
        'protocol.rtmp_demand': b(form.rtmp_demand),
        'rtmp.directProxy': form.directProxy_rtmp,
        'rtmp.enhanced': form.rtmp_enhanced,
        'protocol.enable_hls': b(form.enable_hls_ts),
        'protocol.enable_hls_fmp4': b(form.enable_hls_fmp4),
        'protocol.hls_demand': b(form.hls_demand),
        'hls.segDur': String(form.segDur),
        'protocol.enable_ts': b(form.enable_http_ts),
        'protocol.ts_demand': b(form.ts_demand),
        'protocol.enable_fmp4': b(form.enable_http_fmp4),
        'protocol.fmp4_demand': b(form.fmp4_demand),
        'protocol.continue_push_ms': String(form.continue_push_ms),
        'protocol.paced_sender_ms': String(form.paced_sender_ms),
        'record.fileBufSize': String(form.fileBufSize),
        'record.fastStart': form.fastStart,
        'record.enableFmp4': form.enableFmp4,
        'rtp_proxy.gop_cache': String(form.gop_cache),
        'rtp_proxy.rtp_g711_dur_ms': String(form.rtp_g711_dur_ms),
        'rtc.externIP': String(form.rtc_externIP || '').trim(),
        'rtc.port': String(form.rtc_port || 8000),
        'rtc.tcpPort': String(form.rtc_port || 8000),
      };

      const qs = new URLSearchParams(putData).toString();
      try {
        const res = await fetch('/api/server/config?' + qs, { method: 'PUT' }).then(r => r.json());
        if (res.code === 0) {
          const changed = Number(res.changed || 0);
          if (changed <= 0) { applyStatus.value = 'No changes'; setTimeout(() => { applying.value = false; }, 1200); return; }
          applyStatus.value = `Changed ${changed} setting(s), restarting ZLM...`;
          setTimeout(async () => {
            try { await fetch('/api/server/restart').then(r => r.json()); } catch {}
            applyStatus.value = 'Restarting, waiting for server...';
            waitForReady(0);
          }, 300);
        } else {
          applyStatus.value = res.msg || 'Apply failed';
          setTimeout(() => { applying.value = false; }, 2000);
        }
      } catch {
        applyStatus.value = 'Request failed';
        setTimeout(() => { applying.value = false; }, 2000);
      }
    }

    async function waitForReady(attempt) {
      if (attempt > 60) { applyStatus.value = 'Restarting, refresh manually if needed'; return; }
      try {
        const res = await fetch('/api/server/config', { signal: AbortSignal.timeout(1200) }).then(r => r.json());
        if (res && res.code === 0) { location.reload(); return; }
      } catch {}
      setTimeout(() => waitForReady(attempt + 1), 1000);
    }

    onMounted(loadConfig);

    return { form, applying, applyStatus, applySettings, detecting, detectLanIp };
  }
};
