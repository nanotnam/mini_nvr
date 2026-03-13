/* Pull Streams page – table, add/preview/delete, record toggle */
const PagePullStreams = {
  components: { AppModal, AppTable, AppSwitch, AppTabs },
  template: `
    <div class="card">
      <div class="card-body">
        <!-- Toolbar -->
        <div class="toolbar">
          <input class="input input-inline" v-model="searchApp" placeholder="Search app name" />
          <input class="input input-inline" v-model="searchStream" placeholder="Search stream ID" />
          <select class="select" style="width:140px" v-model="searchStatus">
            <option value="all">All</option>
            <option value="online">Online only</option>
            <option value="offline">Offline only</option>
          </select>
          <button class="btn btn-primary" @click="loadTable">Search</button>
          <button class="btn btn-secondary" @click="resetSearch">Reset</button>
          <button class="btn btn-secondary" @click="showHelp=true">Help</button>
          <div class="toolbar-spacer"></div>
          <button class="btn btn-primary" @click="openAdd">+ Add</button>
        </div>

        <!-- Table -->
        <app-table :columns="columns" :data="filteredData" :page-size="8">
          <template #cell-isOnline="{ row }">
            <img :src="row.isOnline ? '/assets/signal.svg' : '/assets/nosignal.svg'" class="status-icon" :alt="row.isOnline ? 'online' : 'offline'" />
          </template>
          <template #cell-aliveSecond="{ row }">{{ formatDuration(row.aliveSecond) }}</template>
          <template #cell-isRecordingMP4="{ row }">
            <template v-if="row.isRecordingMP4 === '-'">-</template>
            <div v-else class="switch" :class="{on: row.isRecordingMP4}" @click="toggleRecord(row)"></div>
          </template>
          <template #cell-schemas="{ row }">
            <template v-if="row.schemas === '-'">-</template>
            <template v-else-if="!Array.isArray(row.schemas) || row.schemas.length === 0">
              <span class="badge badge-gray">None</span>
            </template>
            <template v-else>
              <span v-for="s in uniqueSchemas(row.schemas)" :key="s" class="badge badge-blue mr-8" style="margin-bottom:2px">{{ schemaName(s) }}</span>
            </template>
          </template>
          <template #cell-actions="{ row }">
            <button class="btn btn-primary btn-sm mr-8" @click="openPreview(row)">Preview</button>
            <button class="btn btn-danger btn-sm" @click="deleteRow(row)">Delete</button>
          </template>
        </app-table>
      </div>
    </div>

    <!-- Add dialog -->
    <app-modal v-model:visible="showAdd" title="Add Stream" width="600px">
      <div class="form-row"><label class="form-label">Source URL</label><div class="form-field"><input class="input" v-model="addForm.url" placeholder="RTSP / RTMP / FLV / HLS / TS ..." /></div></div>
      <div class="form-row"><label class="form-label">App Name</label><div class="form-field"><input class="input" v-model="addForm.app" /></div></div>
      <div class="form-row"><label class="form-label">Stream ID</label><div class="form-field"><input class="input" v-model="addForm.stream" /></div></div>
      <div class="form-row"><label class="form-label">Audio</label><div class="form-field">
        <select class="select" v-model="addForm.audio_type">
          <option value="0">No audio</option>
          <option value="1">Forward original audio</option>
          <option value="2">Forward muted audio</option>
        </select>
      </div></div>
      <template #footer>
        <button class="btn btn-secondary" @click="showAdd=false">Cancel</button>
        <button class="btn btn-primary" @click="submitAdd">Submit</button>
      </template>
    </app-modal>

    <!-- Preview dialog -->
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
              Total traffic: {{ formatBytes(s.totalBytes||0) }}
            </div>
            <div style="margin-top:10px">Stream URL (click to copy):<br/>
              <span class="mono clickable" style="display:inline-block;margin-top:4px;padding:6px 10px;background:#f0f0f0;border:1px solid #ddd;border-radius:4px" @click="copyToClipboard(schemaUrl(s.schema, previewRow))">{{ schemaUrl(s.schema, previewRow) }}</span>
            </div>
          </div>
        </div>
        <div v-else-if="previewNoFmp4" style="margin-top:24px;color:#888">No distribution protocols enabled for this stream.</div>
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
    <app-modal v-model:visible="showHelp" title="Pull Stream — Help" width="720px">
      <div style="line-height:1.8">
        <p><b>What is a pull stream?</b></p>
        <p>A pull stream lets the server fetch an existing URL (RTSP/RTMP/FLV/HLS/TS) and re-publish it locally. Identify each stream with an app name + stream ID pair for preview, distribution, and recording.</p>
        <p class="mt-8"><b>How to add one</b></p>
        <p>Click Add, fill in the source URL, app name, stream ID, and audio mode, then submit. Keep the app/stream ID combination unique.</p>
        <p class="mt-8"><b>Notes</b></p>
        <ul style="padding-left:18px"><li>Ensure the source URL is reachable from the server.</li><li>Duplicate app/stream IDs may overwrite existing entries.</li><li>An unstable source will appear offline with increasing reconnect counts.</li></ul>
      </div>
    </app-modal>`,

  setup() {
    const tableData = ref([]);
    const searchApp = ref('');
    const searchStream = ref('');
    const searchStatus = ref('all');
    const showAdd = ref(false);
    const showPreview = ref(false);
    const showRecord = ref(false);
    const showHelp = ref(false);
    const addForm = reactive({ url: '', app: 'live', stream: '', audio_type: '0' });
    const previewRow = ref(null);
    const previewTab = ref(0);
    const previewSchemas = ref([]);
    const previewNoFmp4 = ref(false);
    const previewTitle = ref('');
    const previewVideo = ref(null);
    const previewStatus = ref(null);
    const recordRow = ref(null);
    const recordDays = ref(1);
    let player = null;
    let refreshTimers = [];

    const columns = [
      { field: 'app', title: 'App', width: '120px' },
      { field: 'stream', title: 'Stream ID', width: '180px' },
      { field: 'isOnline', title: 'Online', width: '80px' },
      { field: 'url', title: 'Source URL', minWidth: '200px' },
      { field: 'rePullCount', title: 'Reconnects', width: '100px' },
      { field: 'aliveSecond', title: 'Duration', width: '100px' },
      { field: 'isRecordingMP4', title: 'Recording', width: '90px' },
      { field: 'totalReaderCount', title: 'Viewers', width: '80px' },
      { field: 'schemas', title: 'Protocols', minWidth: '150px' },
      { field: 'actions', title: 'Actions', width: '180px' },
    ];

    const filteredData = computed(() => {
      let d = tableData.value;
      if (searchStatus.value === 'online') d = d.filter(r => r.isOnline);
      if (searchStatus.value === 'offline') d = d.filter(r => !r.isOnline);
      return d;
    });

    const schemaConfig = [
      { key: 'rtsp', name: 'RTSP' }, { key: 'rtmp', name: 'RTMP' },
      { key: 'hls', name: 'HLS' }, { key: 'hls.fmp4', name: 'HLS-fMP4' },
      { key: 'ts', name: 'HTTP-TS' }, { key: 'fmp4', name: 'HTTP-fMP4' },
      { key: 'webrtc', name: 'WebRTC' }, { key: 'rtc', name: 'RTC' },
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

    async function loadTable() {
      try {
        const params = new URLSearchParams();
        if (searchApp.value) params.set('app', searchApp.value);
        if (searchStream.value) params.set('stream', searchStream.value);
        const res = await fetch('/api/stream/pull-proxy-table?' + params).then(r => r.json());
        if (res.code === 0) tableData.value = res.data || [];
      } catch { $toast('Failed to fetch pull-stream list', 'error'); }
    }

    function resetSearch() { searchApp.value = ''; searchStream.value = ''; searchStatus.value = 'all'; loadTable(); }

    function openAdd() { addForm.url = ''; addForm.app = 'live'; addForm.stream = ''; addForm.audio_type = '0'; showAdd.value = true; }

    async function submitAdd() {
      if (!addForm.url || !addForm.app || !addForm.stream) { $toast('Please fill in all required fields', 'warn'); return; }
      try {
        const params = new URLSearchParams({ vhost: '__defaultVhost__', app: addForm.app, stream: addForm.stream, url: addForm.url, audio_type: addForm.audio_type });
        const res = await fetch('/api/stream/pull-proxy?' + params, { method: 'POST' }).then(r => r.json());
        if (res.code === 0) {
          $toast('Added successfully', 'success');
          showAdd.value = false;
          loadTable();
          setTimeout(loadTable, 3000);
          setTimeout(loadTable, 10000);
        } else { $toast(res.msg || 'Failed', 'error'); }
      } catch { $toast('Request failed', 'error'); }
    }

    async function deleteRow(row) {
      const ok = await $confirm(`Delete <b>${row.app} / ${row.stream}</b>?`);
      if (!ok) return;
      try {
        const params = new URLSearchParams({ vhost: row.vhost, app: row.app, stream: row.stream });
        const res = await fetch('/api/stream/pull-proxy?' + params, { method: 'DELETE' }).then(r => r.json());
        if (res.code === 0) { $toast('Deleted', 'success'); loadTable(); }
      } catch { $toast('Delete failed', 'error'); }
    }

    function openPreview(row) {
      previewRow.value = row;
      previewTab.value = 0;
      previewTitle.value = row.app + '/' + row.stream;
      previewSchemas.value = Array.isArray(row.schemas) ? row.schemas.filter(s => s.schema) : [];
      previewNoFmp4.value = previewSchemas.value.length === 0;
      showPreview.value = true;

      nextTick(() => {
        const vid = previewVideo.value;
        const stat = previewStatus.value;
        if (!vid) return;
        if (player) { player.destroy(); player = null; }
        player = createStreamPlayer(vid, stat);

        const isOnline = row.isOnline === true;
        const hasFmp4 = Array.isArray(row.schemas) && row.schemas.some(s => s.schema === 'fmp4');
        if (isOnline && !hasFmp4) {
          if (stat) { stat.textContent = 'Enable HTTP-fMP4 distribution in Settings first'; stat.style.display = 'flex'; }
        } else {
          player.play(row.app, row.stream, isOnline);
        }
      });
    }

    watch(showPreview, (v) => { if (!v && player) { player.destroy(); player = null; } });

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
    onUnmounted(() => { refreshTimers.forEach(clearTimeout); if (player) player.destroy(); });

    return {
      tableData, searchApp, searchStream, searchStatus, filteredData, columns,
      showAdd, showPreview, showRecord, showHelp,
      addForm, previewRow, previewTab, previewSchemas, previewNoFmp4, previewTitle,
      previewVideo, previewStatus,
      recordDays,
      loadTable, resetSearch, openAdd, submitAdd, deleteRow,
      openPreview, toggleRecord, submitRecord,
      schemaName, uniqueSchemas, schemaUrl, trackDetail,
      formatDuration, formatBytes, copyToClipboard,
    };
  }
};
