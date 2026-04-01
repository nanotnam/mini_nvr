/* Video Wall page – grid layout, stream selector, video players */
const PageVideoWall = {
  components: { AppModal, AppTree },
  template: `
    <div>
      <!-- Controls -->
      <div style="display:flex;justify-content:center;align-items:center;padding:16px 0">
        <div class="btn-group">
          <button class="btn btn-secondary" @click="setLayout(1)">1x1</button>
          <button class="btn btn-secondary" @click="setLayout(4)">2x2</button>
          <button class="btn btn-secondary" @click="setLayout(9)">3x3</button>
          <button class="btn btn-secondary" @click="toggleFullscreen">&#9974;</button>
        </div>
      </div>
      <!-- Grid -->
      <div style="display:flex;justify-content:center">
        <div ref="wallContainer" class="vw-container" :class="'layout-' + cellCount" style="width:960px;height:540px">
          <div v-for="(cell, i) in cells" :key="i" class="vw-cell">
            <video :ref="el => setVideoRef(i, el)" autoplay muted playsinline webkit-playsinline preload="none"></video>
            <div :ref="el => setStatusRef(i, el)" class="cell-status"></div>
            <div class="cell-btns">
              <button class="btn btn-primary btn-sm" @click="openSelector(i)">Select</button>
              <button class="btn btn-danger btn-sm" @click="stopCell(i)">Reset</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Stream selector -->
    <app-modal v-model:visible="showSelector" title="Select Stream" width="300px">
      <app-tree :data="treeData" @select="onTreeSelect" />
      <div v-if="treeLoading" class="text-muted text-center" style="padding:12px">Loading...</div>
      <div v-if="!treeLoading && treeData.length===0" class="text-muted text-center" style="padding:12px">No streams available</div>
    </app-modal>`,

  setup() {
    const cellCount = ref(4);
    const cells = ref([]);
    const showSelector = ref(false);
    const treeData = ref([]);
    const treeLoading = ref(false);
    const wallContainer = ref(null);

    let players = [];
    let videoEls = {};
    let statusEls = {};
    let selectingIndex = -1;

    function setVideoRef(i, el) { videoEls[i] = el; }
    function setStatusRef(i, el) { statusEls[i] = el; }

    function setLayout(n) {
      players.forEach(p => { if (p) p.destroy(); });
      players = [];
      cellCount.value = n;
      cells.value = Array.from({ length: n }, (_, i) => ({ index: i }));
      nextTick(() => {
        for (let i = 0; i < n; i++) {
          const vid = videoEls[i];
          const stat = statusEls[i];
          if (vid && stat) {
            players[i] = createStreamPlayer(vid, stat);
          }
        }
      });
    }

    async function loadStreamTree() {
      treeLoading.value = true;
      try {
        // Do not hard-filter schema here; player can use WebRTC first, then fallback to fMP4.
        const res = await fetch('/api/stream/streamid-list').then(r => r.json());
        let list = [];
        if (res.code === 0) list = res.data || [];

        // If no online streams are reported, fallback to configured pull streams
        // so users can still select them and wait for reconnection.
        if (!list.length) {
          const fallbackRes = await fetch('/api/stream/pull-proxy-table').then(r => r.json());
          if (fallbackRes.code === 0) list = fallbackRes.data || [];
        }

        const map = new Map();
        list.forEach(item => {
          if (!item.app || !item.stream) return;
          if (!map.has(item.app)) map.set(item.app, { title: item.app, _open: true, children: [] });
          map.get(item.app).children.push({
            title: item.stream,
            app: item.app,
            stream: item.stream,
            isOnline: item.isOnline !== false,
          });
        });
        treeData.value = Array.from(map.values());
      } catch { $toast('Failed to fetch stream list', 'error'); }
      treeLoading.value = false;
    }

    function openSelector(i) {
      selectingIndex = i;
      loadStreamTree();
      showSelector.value = true;
    }

    function onTreeSelect(node) {
      if (!node.app || !node.stream) return;
      const i = selectingIndex;
      if (players[i]) players[i].play(node.app, node.stream, node.isOnline !== false);
      showSelector.value = false;
      $toast(`Connecting to ${node.app}/${node.stream}...`, 'info', 1500);
    }

    function stopCell(i) {
      if (players[i]) players[i].stop();
    }

    function toggleFullscreen() {
      const el = wallContainer.value;
      if (!el) return;
      if (!document.fullscreenElement) {
        el.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen();
      }
    }

    onMounted(() => setLayout(4));
    onUnmounted(() => players.forEach(p => { if (p) p.destroy(); }));

    return {
      cellCount, cells, showSelector, treeData, treeLoading, wallContainer,
      setVideoRef, setStatusRef, setLayout, openSelector, onTreeSelect, stopCell, toggleFullscreen,
    };
  }
};
