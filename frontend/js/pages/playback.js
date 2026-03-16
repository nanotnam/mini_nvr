/* Playback page – recording table, timeline player */
const PagePlayback = {
  components: { AppModal, AppTable },
  template: `
    <div class="card">
      <div class="card-header">Local Recording Management</div>
      <div class="card-body">
        <app-table :columns="columns" :data="tableData" :page-size="8">
          <template #cell-isRecordingMP4="{ row }">
            <template v-if="row.isRecordingMP4"><span style="color:#e03;font-weight:600">Yes</span></template>
            <template v-else-if="hasPolicy(row) && !row.isOnline"><span style="color:#ffb800;font-weight:600">Yes (offline)</span></template>
            <template v-else><span style="color:#999">No</span></template>
          </template>
          <template #cell-record_days="{ row }">{{ row.record_days == null ? '-' : row.record_days }}</template>
          <template #cell-total_storage_gb="{ row }">{{ row.total_storage_gb }} GB</template>
          <template #cell-actions="{ row }">
            <button class="btn btn-primary btn-sm mr-8" @click="openPlayer(row)">View</button>
            <button class="btn btn-danger btn-sm" @click="deleteRecordings(row)">Delete</button>
          </template>
        </app-table>
      </div>
    </div>

    <!-- Playback player -->
    <app-modal v-model:visible="showPlayer" title="Playback" width="100%" :full="true">
      <div style="max-width:1100px;margin:auto">
        <div class="toolbar">
          <label style="font-weight:500">Recording Date</label>
          <select class="select" style="width:160px" v-model="selectedDate" @change="onDateChange">
            <option v-for="d in availableDates" :key="d" :value="d">{{ d }}</option>
          </select>
          <button class="btn btn-secondary" @click="downloadSegment">Download segment</button>
        </div>
        <div style="display:flex;justify-content:center">
          <video ref="playerVideo" controls autoplay style="width:1024px;height:576px;background:#23292e"></video>
        </div>
        <!-- Timeline -->
        <div ref="timeline" class="timeline-wrap" @click="onTimelineClick" style="margin:0 40px">
          <div class="timeline-track"></div>
          <div ref="segmentsEl" class="timeline-segments"></div>
          <div ref="labelsEl" class="timeline-labels"></div>
          <div ref="playheadEl" class="timeline-playhead" @mousedown="onPlayheadDown"></div>
          <div ref="timeEl" class="timeline-time">--:--:--</div>
        </div>
      </div>
    </app-modal>`,

  setup() {
    const tableData = ref([]);
    const showPlayer = ref(false);
    const availableDates = ref([]);
    const selectedDate = ref('');

    const playerVideo = ref(null);
    const timeline = ref(null);
    const segmentsEl = ref(null);
    const labelsEl = ref(null);
    const playheadEl = ref(null);
    const timeEl = ref(null);

    let currentApp = '', currentStream = '';
    let recordings = [];
    let startTime = 0, endTime = 0, durationMs = 1;
    let isDragging = false, rafId = 0, pendingSeek = null;
    const recordingsCache = new Map();

    const columns = [
      { field: 'app', title: 'App', width: '150px' },
      { field: 'stream', title: 'Stream ID', width: '200px' },
      { field: 'isRecordingMP4', title: 'Recording', width: '120px' },
      { field: 'record_days', title: 'Retention (d)', width: '120px' },
      { field: 'slice_num', title: 'Segments', width: '120px' },
      { field: 'total_storage_gb', title: 'Storage', width: '120px' },
      { field: 'actions', title: 'Actions', width: '180px' },
    ];

    function hasPolicy(row) {
      return row.record_days !== undefined && row.record_days !== null && String(row.record_days).trim() !== '-' && String(row.record_days).trim() !== '';
    }

    function parseTime(s) { return new Date(s).getTime(); }
    function formatTimeStr(ts) { return new Date(ts).toTimeString().substring(0, 8); }

    async function loadTable() {
      try {
        const res = await fetch('/api/playback/streamid-record-list').then(r => r.json());
        if (res.code === 0) tableData.value = res.data || [];
      } catch { $toast('Failed to fetch recordings', 'error'); }
    }

    function openPlayer(row) {
      const dates = (row.dates || []).slice().sort();
      if (!dates.length) { $toast('No recordings available', 'warn'); return; }
      currentApp = row.app;
      currentStream = row.stream;
      availableDates.value = dates;
      selectedDate.value = dates[0];
      showPlayer.value = true;
      nextTick(() => loadRecordings(dates[0]));
    }

    watch(showPlayer, (v) => { if (!v) cleanup(); });

    function onDateChange() { loadRecordings(selectedDate.value); }

    async function loadRecordings(date) {
      const key = `${currentApp}||${currentStream}||${date}`;
      if (recordingsCache.has(key)) { setRecordings(recordingsCache.get(key)); return; }
      try {
        const params = new URLSearchParams({ app: currentApp, stream: currentStream, date });
        const res = await fetch('/api/playback/streamid-record?' + params).then(r => r.json());
        if (res.code === 0) {
          const list = (res.data || []).map(r => ({ ...r, filename: '/record/' + r.filename }));
          recordingsCache.set(key, list);
          setRecordings(list);
        } else {
          $toast('Failed to load recordings', 'error');
          setRecordings([]);
        }
      } catch { $toast('Failed to load recordings', 'error'); setRecordings([]); }
    }

    function setRecordings(list) {
      recordings = list.slice().sort((a, b) => parseTime(a.start) - parseTime(b.start));
      if (!recordings.length) {
        clearTimeline();
        if (timeEl.value) timeEl.value.textContent = 'No recordings';
        return;
      }
      startTime = parseTime(recordings[0].start);
      endTime = parseTime(recordings[recordings.length - 1].end);
      durationMs = Math.max(1, endTime - startTime);
      renderTimeline();
      updatePlayhead(startTime);
      seekTo(startTime);
    }

    function clearTimeline() {
      if (segmentsEl.value) segmentsEl.value.innerHTML = '';
      if (labelsEl.value) labelsEl.value.innerHTML = '';
      if (playheadEl.value) playheadEl.value.style.left = '0px';
      if (timeEl.value) { timeEl.value.style.left = '0px'; timeEl.value.textContent = '--:--:--'; }
    }

    function renderTimeline() {
      const tl = timeline.value;
      if (!tl || !segmentsEl.value || !labelsEl.value) return;
      segmentsEl.value.innerHTML = '';
      labelsEl.value.innerHTML = '';
      const pxPerMs = tl.offsetWidth / durationMs;
      const frag = document.createDocumentFragment();
      recordings.forEach(rec => {
        const s = parseTime(rec.start), e = parseTime(rec.end);
        const seg = document.createElement('div');
        seg.className = 'timeline-segment';
        seg.style.left = ((s - startTime) * pxPerMs) + 'px';
        seg.style.width = ((e - s) * pxPerMs) + 'px';
        frag.appendChild(seg);
      });
      segmentsEl.value.appendChild(frag);

      const cur = new Date(startTime);
      cur.setMinutes(0, 0, 0);
      let t = cur.getTime();
      const lblFrag = document.createDocumentFragment();
      while (t <= endTime) {
        const left = (t - startTime) * pxPerMs;
        if (left >= 0 && left <= tl.offsetWidth) {
          const lbl = document.createElement('div');
          lbl.className = 'timeline-label';
          lbl.style.left = left + 'px';
          const d = new Date(t);
          lbl.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':00';
          lblFrag.appendChild(lbl);
        }
        t += 3600000;
      }
      labelsEl.value.appendChild(lblFrag);
    }

    function updatePlayhead(ts) {
      const tl = timeline.value;
      if (!tl || !playheadEl.value || !timeEl.value) return;
      const pxPerMs = tl.offsetWidth / durationMs;
      const left = (ts - startTime) * pxPerMs;
      playheadEl.value.style.left = left + 'px';
      timeEl.value.style.left = (left + 10) + 'px';
      timeEl.value.textContent = formatTimeStr(ts);
    }

    function seekTo(ts) {
      const vid = playerVideo.value;
      if (!vid || !recordings.length) return;
      pendingSeek = ts;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (pendingSeek === null) return;
        const targetTs = pendingSeek;
        pendingSeek = null;

        let rec = recordings.find(r => targetTs >= parseTime(r.start) && targetTs < parseTime(r.end));
        let finalTs = targetTs;
        if (!rec) {
          const next = recordings.find(r => parseTime(r.start) > targetTs);
          if (next) { rec = next; finalTs = parseTime(rec.start) + 1000; }
          else { rec = recordings[recordings.length - 1]; finalTs = Math.max(parseTime(rec.start), parseTime(rec.end) - 1000); }
        }
        updatePlayhead(finalTs);
        const seekTime = Math.max(0, (finalTs - parseTime(rec.start)) / 1000);
        const currentSrc = vid.src || '';
        if (currentSrc.endsWith(rec.filename)) { vid.currentTime = seekTime; return; }
        vid.onloadedmetadata = () => { vid.currentTime = seekTime; vid.play().catch(() => {}); vid.onloadedmetadata = null; };
        vid.src = rec.filename;
        vid.load();
      });
    }

    function getRecFromSrc() {
      const vid = playerVideo.value;
      if (!vid || !vid.src) return null;
      try { const path = new URL(vid.src, location.href).pathname; return recordings.find(r => r.filename === path) || null; }
      catch { return null; }
    }

    function onTimeUpdate() {
      if (isDragging) return;
      const vid = playerVideo.value;
      if (!vid || !vid.src) return;
      const rec = getRecFromSrc();
      if (!rec) return;
      updatePlayhead(parseTime(rec.start) + vid.currentTime * 1000);
    }

    function onEnded() {
      const vid = playerVideo.value;
      if (!vid) return;
      const rec = getRecFromSrc();
      if (!rec) return;
      const idx = recordings.indexOf(rec);
      if (idx !== -1 && idx + 1 < recordings.length) seekTo(parseTime(recordings[idx + 1].start) + 1000);
    }

    function onPlayheadDown(e) { isDragging = true; playheadEl.value?.classList.add('dragging'); e.preventDefault(); }

    function onMouseMove(e) {
      if (!isDragging || !timeline.value) return;
      const rect = timeline.value.getBoundingClientRect();
      let x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      seekTo(startTime + (x / rect.width) * durationMs);
    }

    function onMouseUp() { if (isDragging) { isDragging = false; playheadEl.value?.classList.remove('dragging'); } }

    function onTimelineClick(e) {
      if (!timeline.value) return;
      const rect = timeline.value.getBoundingClientRect();
      seekTo(startTime + ((e.clientX - rect.left) / rect.width) * durationMs);
    }

    function downloadSegment() {
      const rec = getRecFromSrc();
      if (!rec) { $toast('No segment currently loaded', 'warn'); return; }
      const a = document.createElement('a');
      a.href = rec.filename;
      a.download = rec.filename.split('/').pop() || 'record.mp4';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }

    function cleanup() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0; pendingSeek = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      const vid = playerVideo.value;
      if (vid) { vid.removeEventListener('timeupdate', onTimeUpdate); vid.removeEventListener('ended', onEnded); vid.pause(); vid.removeAttribute('src'); vid.load(); }
      clearTimeline();
    }

    async function deleteRecordings(row) {
      const ok = await $confirm(`Delete recordings for <b>${row.app}/${row.stream}</b>?`);
      if (!ok) return;
      try {
        const params = new URLSearchParams({ app: row.app, stream: row.stream });
        const res = await fetch('/api/playback/streamid-record?' + params, { method: 'DELETE' }).then(r => r.json());
        if (res.code === 0) { $toast('Deleted', 'success'); loadTable(); }
        else $toast('Delete failed', 'error');
      } catch { $toast('Delete failed', 'error'); }
    }

    onMounted(() => {
      loadTable();
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      nextTick(() => {
        const vid = playerVideo.value;
        if (vid) { vid.addEventListener('timeupdate', onTimeUpdate); vid.addEventListener('ended', onEnded); }
      });
    });

    onUnmounted(() => { cleanup(); document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); });

    return {
      tableData, showPlayer, availableDates, selectedDate, columns,
      playerVideo, timeline, segmentsEl, labelsEl, playheadEl, timeEl,
      loadTable, openPlayer, onDateChange, downloadSegment, deleteRecordings,
      onTimelineClick, onPlayheadDown, hasPolicy,
    };
  }
};
