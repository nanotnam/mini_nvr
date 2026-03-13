/* Push Streams page – table, preview/close, record toggle */
const PagePushStreams = {
  components: { AppModal, AppTable, AppTabs },
  template: `
    <div class="card">
      <div class="card-body">
        <div class="toolbar">
          <input class="input input-inline" v-model="searchApp" placeholder="Search app name" />
          <input class="input input-inline" v-model="searchStream" placeholder="Search stream ID" />
          <button class="btn btn-primary" @click="loadTable">Search</button>
          <button class="btn btn-secondary" @click="resetSearch">Reset</button>
          <button class="btn btn-secondary" @click="showHelp=true">Help</button>
        </div>

        <app-table :columns="columns" :data="tableData" :page-size="8">
          <template #cell-aliveSecond="{ row }">{{ formatDuration(row.aliveSecond) }}</template>
          <template #cell-peer="{ row }">{{ peerStr(row) }}</template>
          <template #cell-isRecordingMP4="{ row }">
            <div class="switch" :class="{on: row.isRecordingMP4}" @click="toggleRecord(row)"></div>
          </template>
          <template #cell-schemas="{ row }">
            <template v-if="!Array.isArray(row.schemas) || row.schemas.length===0">
              <span class="badge badge-gray">None</span>
            </template>
            <template v-else>
              <span v-for="s in uniqueSchemas(row.schemas)" :key="s" class="badge badge-blue mr-8" style="margin-bottom:2px">{{ schemaName(s) }}</span>
            </template>
          </template>
          <template #cell-actions="{ row }">
            <button class="btn btn-primary btn-sm mr-8" @click="openPreview(row)">Preview</button>
            <button class="btn btn-danger btn-sm" @click="closeStream(row)">Close</button>
          </template>
        </app-table>
      </div>
    </div>

    <!-- Preview -->
    <app-modal v-model:visible="showPreview" :title="'Preview — ' + previewTitle" width="1000px" :full="true">
      <div style="display:flex;flex-direction:column;align-items:center;height:100%">
        <div class="video-player" style="width:960px;height:540px;flex-shrink:0">
          <video ref="previewVideo" autoplay style="width:960px;height:540px"></video>
          <div ref="previewStatus" class="video-status"></div>
        </div>
        <div v-if="previewSchemas.length" style="width:100%;margin-top:16px">
          <div class="tabs-header">
            <button v-for="(s, i) in previewSchemas" :key="i" class="tab-btn" :class="{active: previewTab===i}" @click="previewTab=i">{{ schemaName(s.schema) }}</button>
          </div>
          <div v-for="(s, i) in previewSchemas" :key="i" v-show="previewTab===i" class="tab-body">
            <div style="line-height:1.8">
              <b>Tracks:</b><br/>
              <template v-if="!s.tracks || s.tracks.length===0"><span>No track info</span><br/></template>
              <template v-else><span v-for="(t,ti) in s.tracks" :key="ti">[{{ t.codec_type===0?'Video':t.codec_type===1?'Audio':'Other' }}] {{ trackDetail(t) }}<br/></span></template>
            </div>
            <div style="margin-top:8px;padding:8px;background:#f8f9fa;border-radius:4px;font-size:13px">
              Bitrate: {{ ((s.bytesSpeed||0)*8/1048576).toFixed(2) }} Mbps &nbsp;
              Viewers: {{ s.readerCount||0 }} &nbsp;
              Traffic: {{ formatBytes(s.totalBytes||0) }}
            </div>
            <div style="margin-top:10px">Stream URL (click to copy):<br/>
              <span class="mono clickable" style="display:inline-block;margin-top:4px;padding:6px 10px;background:#f0f0f0;border:1px solid #ddd;border-radius:4px" @click="copyToClipboard(schemaUrl(s.schema, previewRow))">{{ schemaUrl(s.schema, previewRow) }}</span>
            </div>
          </div>
        </div>
        <div v-else style="margin-top:24px;color:#888">No distribution protocols enabled for this stream.</div>
      </div>
    </app-modal>

    <!-- Record dialog -->
    <app-modal v-model:visible="showRecord" title="Start Recording" width="400px">
      <div class="form-row"><label class="form-label">Retention (days)</label><div class="form-field"><input class="input" type="number" v-model.number="recordDays" min="1" max="30" /></div></div>
      <template #footer>
        <button class="btn btn-secondary" @click="showRecord=false">Cancel</button>
        <button class="btn btn-primary" @click="submitRecord">Submit</button>
      </template>
    </app-modal>

    <!-- Help dialog -->
    <app-modal v-model:visible="showHelp" title="Push Stream — Help" width="820px">
      <div style="line-height:1.8">
        <p><b>What is a push stream?</b></p>
        <p>Push a local video/camera feed to StreamUI (ZLMediaKit) via RTSP / RTMP / RTP. Once active, the app/stream ID pair appears in this list and can be previewed or distributed.</p>
        <p class="mt-8" style="color:#666">If FFmpeg and StreamUI run on the same machine use <code>127.0.0.1</code>; otherwise replace it with the StreamUI server IP.</p>
        <p class="mt-8">1. Push via RTSP (TCP)</p>
        <pre style="background:#f8f8f8;padding:10px;border:1px solid #ddd;border-radius:4px;overflow:auto">ffmpeg -re -i ./test.mp4 -vcodec h264 -acodec aac -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:8554/{app}/{streamID}</pre>
        <p class="mt-8">2. Push via RTMP</p>
        <pre style="background:#f8f8f8;padding:10px;border:1px solid #ddd;border-radius:4px;overflow:auto">ffmpeg -re -i ./test.mp4 -vcodec h264 -acodec aac -f flv rtmp://127.0.0.1:1935/{app}/{streamID}</pre>
        <p class="mt-8">3. Push via RTP</p>
        <pre style="background:#f8f8f8;padding:10px;border:1px solid #ddd;border-radius:4px;overflow:auto">ffmpeg -re -i ./test.mp4 -vcodec h264 -acodec aac -f rtp_mpegts rtp://127.0.0.1:10000</pre>
      </div>
    </app-modal>`,

  setup() {
    const tableData = ref([]);
    const searchApp = ref('');
    const searchStream = ref('');
    const showPreview = ref(false);
    const showRecord = ref(false);
    const showHelp = ref(false);
    const previewRow = ref(null);
    const previewTab = ref(0);
    const previewSchemas = ref([]);
    const previewTitle = ref('');
    const previewVideo = ref(null);
    const previewStatus = ref(null);
    const recordRow = ref(null);
    const recordDays = ref(1);
    let player = null;

    const columns = [
      { field: 'app', title: 'App', width: '120px' },
      { field: 'stream', title: 'Stream ID', width: '180px' },
      { field: 'originTypeStr', title: 'Type', width: '120px' },
      { field: 'originUrl', title: 'Source URL', minWidth: '200px' },
      { field: 'peer', title: 'Peer IP', width: '180px' },
      { field: 'aliveSecond', title: 'Duration', width: '100px' },
      { field: 'isRecordingMP4', title: 'Recording', width: '90px' },
      { field: 'totalReaderCount', title: 'Viewers', width: '80px' },
      { field: 'schemas', title: 'Protocols', minWidth: '150px' },
      { field: 'actions', title: 'Actions', width: '180px' },
    ];

    const schemaConfig = [
      { key: 'rtsp', name: 'RTSP' }, { key: 'rtmp', name: 'RTMP' },
      { key: 'hls', name: 'HLS' }, { key: 'hls.fmp4', name: 'HLS-fMP4' },
      { key: 'ts', name: 'HTTP-TS' }, { key: 'fmp4', name: 'HTTP-fMP4' },
    ];
    const schemaName = (s) => schemaConfig.find(c => c.key === s)?.name || s.toUpperCase();
    const uniqueSchemas = (schemas) => [...new Set((schemas || []).map(s => s.schema).filter(Boolean))];

    function schemaUrl(schema, row) {
      if (!row) return '';
      const h = location.hostname;
      const map = {
        rtsp: `rtsp://${h}:8554/${row.app}/${row.stream}`,
        rtmp: `rtmp://${h}:1935/${row.app}/${row.stream}`,
        hls: `http://${h}:8080/${row.app}/${row.stream}/hls.m3u8`,
        'hls.fmp4': `http://${h}:8080/${row.app}/${row.stream}/hls.fmp4.m3u8`,
        ts: `http://${h}:8080/${row.app}/${row.stream}.live.ts`,
        fmp4: `http://${h}:8080/${row.app}/${row.stream}.live.mp4`,
      };
      return map[schema] || '#';
    }

    function trackDetail(t) {
      if (t.codec_type === 0) return `Codec ${t.codec_id_name}, ${t.width}x${t.height}@${t.fps||'?'}FPS, GOP ${t.gop_size} (${t.gop_interval_ms}ms)`;
      if (t.codec_type === 1) return `Codec ${t.codec_id_name}, ${t.sample_rate}Hz, ${t.channels}ch`;
      return `Codec ${t.codec_id_name || 'Unknown'}`;
    }

    function peerStr(row) {
      const s = row.originSock || {};
      if (s.peer_ip) return s.peer_ip + ':' + s.peer_port;
      return '-';
    }

    async function loadTable() {
      try {
        const params = new URLSearchParams();
        if (searchApp.value) params.set('app', searchApp.value);
        if (searchStream.value) params.set('stream', searchStream.value);
        const res = await fetch('/api/stream/streamid-list?' + params).then(r => r.json());
        if (res.code === 0) {
          const allowed = ['rtmp_push', 'rtsp_push', 'rtp_push'];
          tableData.value = (res.data || []).filter(d => allowed.includes(d.originTypeStr));
        }
      } catch { $toast('Failed to fetch push streams', 'error'); }
    }

    function resetSearch() { searchApp.value = ''; searchStream.value = ''; loadTable(); }

    function openPreview(row) {
      previewRow.value = row;
      previewTab.value = 0;
      previewTitle.value = row.app + '/' + row.stream;
      previewSchemas.value = Array.isArray(row.schemas) ? row.schemas.filter(s => s.schema) : [];
      showPreview.value = true;

      nextTick(() => {
        const vid = previewVideo.value;
        const stat = previewStatus.value;
        if (!vid) return;
        if (player) { player.destroy(); player = null; }
        player = createStreamPlayer(vid, stat);

        const hasFmp4 = Array.isArray(row.schemas) && row.schemas.some(s => s.schema === 'fmp4');
        if (!hasFmp4) {
          if (stat) { stat.textContent = 'Enable HTTP-fMP4 distribution in Settings first'; stat.style.display = 'flex'; }
        } else {
          player.play(row.app, row.stream, true);
        }
      });
    }

    watch(showPreview, (v) => { if (!v && player) { player.destroy(); player = null; } });

    async function closeStream(row) {
      const ok = await $confirm(`Close stream <b>${row.app} / ${row.stream}</b>?`);
      if (!ok) return;
      try {
        const params = new URLSearchParams({ vhost: row.vhost, app: row.app, stream: row.stream });
        const res = await fetch('/api/stream/streamid?' + params, { method: 'DELETE' }).then(r => r.json());
        if (res.code === 0) { $toast('Stream closed', 'success'); loadTable(); }
      } catch { $toast('Close failed', 'error'); }
    }

    function toggleRecord(row) {
      if (row.isRecordingMP4) {
        $confirm(`Stop recording <b>${row.app} / ${row.stream}</b>?`).then(async ok => {
          if (!ok) return;
          try {
            const res = await fetch(`/api/playback/stop-record?vhost=${row.vhost}&app=${row.app}&stream=${row.stream}`).then(r => r.json());
            if (res.code === 0) { $toast('Recording stopped', 'success'); loadTable(); }
            else $toast(res.msg || 'Failed', 'error');
          } catch { $toast('Request failed', 'error'); }
        });
      } else {
        recordRow.value = row;
        recordDays.value = 1;
        showRecord.value = true;
      }
    }

    async function submitRecord() {
      if (recordDays.value < 1 || recordDays.value > 30) { $toast('Retention days must be between 1 and 30', 'warn'); return; }
      const row = recordRow.value;
      try {
        const res = await fetch(`/api/playback/start-record?vhost=${row.vhost}&app=${row.app}&stream=${row.stream}&record_days=${recordDays.value}`).then(r => r.json());
        if (res.code === 0) { $toast('Recording started', 'success'); showRecord.value = false; loadTable(); }
        else $toast(res.msg || 'Failed', 'error');
      } catch { $toast('Request failed', 'error'); }
    }

    onMounted(loadTable);
    onUnmounted(() => { if (player) player.destroy(); });

    return {
      tableData, searchApp, searchStream, columns,
      showPreview, showRecord, showHelp,
      previewRow, previewTab, previewSchemas, previewTitle,
      previewVideo, previewStatus,
      recordRow, recordDays,
      loadTable, resetSearch, openPreview, closeStream,
      toggleRecord, submitRecord, peerStr,
      schemaName, uniqueSchemas, schemaUrl, trackDetail,
      formatDuration, formatBytes, copyToClipboard,
    };
  }
};
