/* ============================================================
   StreamUI – app.js
   Vue 3 SPA shell: routing, sidebar, shared components.
   ============================================================ */

const { createApp, ref, computed, watch, onMounted, onUnmounted, nextTick, reactive, toRaw } = Vue;

/* ── Toast (global) ─────────────────────────────────────── */

const toasts = ref([]);
let _toastId = 0;

function $toast(message, type, duration) {
  type = type || 'info';
  duration = duration || 2000;
  const id = ++_toastId;
  toasts.value.push({ id, message, type });
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id); }, duration);
}

const AppToast = {
  template: `
    <div class="toast-container">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">{{ t.message }}</div>
    </div>`,
  setup() { return { toasts }; }
};

/* ── Modal ──────────────────────────────────────────────── */

const AppModal = {
  props: {
    visible: Boolean,
    title: { type: String, default: '' },
    width: { type: String, default: '500px' },
    full: Boolean,
    shadeClose: { type: Boolean, default: true },
  },
  emits: ['update:visible'],
  template: `
    <teleport to="body">
      <div v-if="visible" class="modal-backdrop" @click.self="shadeClose && $emit('update:visible', false)">
        <div class="modal" :class="{ 'modal-full': full }" :style="full ? {} : { width }">
          <div class="modal-title">
            <span>{{ title }}</span>
            <button class="modal-close" @click="$emit('update:visible', false)">&times;</button>
          </div>
          <div class="modal-body"><slot /></div>
          <div v-if="$slots.footer" class="modal-footer"><slot name="footer" /></div>
        </div>
      </div>
    </teleport>`,
};

/* ── Confirm dialog ─────────────────────────────────────── */

const confirmState = reactive({ visible: false, title: 'Confirm', message: '', resolve: null });

function $confirm(message, title) {
  return new Promise(resolve => {
    confirmState.title = title || 'Confirm';
    confirmState.message = message;
    confirmState.visible = true;
    confirmState.resolve = resolve;
  });
}

const AppConfirm = {
  template: `
    <teleport to="body">
      <div v-if="state.visible" class="modal-backdrop" @click.self="cancel">
        <div class="modal" style="width:400px">
          <div class="modal-title"><span>{{ state.title }}</span></div>
          <div class="modal-body"><p v-html="state.message"></p></div>
          <div class="modal-footer">
            <button class="btn btn-secondary" @click="cancel">Cancel</button>
            <button class="btn btn-primary" @click="ok">OK</button>
          </div>
        </div>
      </div>
    </teleport>`,
  setup() {
    function ok() { confirmState.visible = false; confirmState.resolve && confirmState.resolve(true); }
    function cancel() { confirmState.visible = false; confirmState.resolve && confirmState.resolve(false); }
    return { state: confirmState, ok, cancel };
  }
};

/* ── Table ──────────────────────────────────────────────── */

const AppTable = {
  props: {
    columns: Array,
    data: Array,
    pageSize: { type: Number, default: 8 },
  },
  emits: ['tool'],
  template: `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th v-for="col in columns" :key="col.field" :style="col.width ? {width: col.width} : {minWidth: col.minWidth || 'auto'}">{{ col.title }}</th>
        </tr></thead>
        <tbody>
          <tr v-if="!pagedData.length"><td :colspan="columns.length" class="text-muted" style="padding:24px">No data</td></tr>
          <tr v-for="(row, ri) in pagedData" :key="ri">
            <td v-for="col in columns" :key="col.field">
              <slot :name="'cell-'+col.field" :row="row" :index="(page-1)*pageSize+ri">
                {{ row[col.field] ?? '' }}
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="totalPages > 1" class="pagination">
        <span class="text-muted">{{ data.length }} total</span>
        <button :disabled="page<=1" @click="page--">&laquo; Prev</button>
        <template v-for="p in pageNumbers" :key="p">
          <span v-if="p===page" class="page-current">{{ p }}</span>
          <button v-else @click="page=p">{{ p }}</button>
        </template>
        <button :disabled="page>=totalPages" @click="page++">Next &raquo;</button>
      </div>
    </div>`,
  setup(props) {
    const page = ref(1);
    const totalPages = computed(() => Math.max(1, Math.ceil((props.data?.length || 0) / props.pageSize)));
    const pagedData = computed(() => {
      const start = (page.value - 1) * props.pageSize;
      return (props.data || []).slice(start, start + props.pageSize);
    });
    const pageNumbers = computed(() => {
      const pages = [];
      for (let i = 1; i <= totalPages.value; i++) pages.push(i);
      return pages;
    });
    watch(() => props.data, () => { if (page.value > totalPages.value) page.value = 1; });
    return { page, totalPages, pagedData, pageNumbers };
  }
};

/* ── Tabs ───────────────────────────────────────────────── */

const AppTabs = {
  props: { tabs: Array },
  template: `
    <div>
      <div class="tabs-header">
        <button v-for="(tab, i) in tabs" :key="i" class="tab-btn" :class="{active: active===i}" @click="active=i">{{ tab.title }}</button>
      </div>
      <div class="tab-body" v-for="(tab, i) in tabs" :key="i" v-show="active===i">
        <slot :name="'tab-'+i" :tab="tab" />
      </div>
    </div>`,
  setup() { return { active: ref(0) }; }
};

/* ── Switch ─────────────────────────────────────────────── */

const AppSwitch = {
  props: { modelValue: Boolean },
  emits: ['update:modelValue'],
  template: `<div class="switch" :class="{on: modelValue}" @click="$emit('update:modelValue', !modelValue)"></div>`,
};

/* ── Tree ───────────────────────────────────────────────── */

const AppTree = {
  props: { data: Array },
  emits: ['select'],
  template: `
    <ul class="tree">
      <li v-for="node in data" :key="node.title">
        <template v-if="node.children && node.children.length">
          <span class="tree-toggle" @click="node._open = !node._open">{{ node._open ? '&#9660;' : '&#9654;' }} {{ node.title }}</span>
          <ul v-show="node._open">
            <li v-for="child in node.children" :key="child.title">
              <span class="tree-leaf" @click="$emit('select', child)">{{ child.title }}</span>
            </li>
          </ul>
        </template>
        <template v-else>
          <span class="tree-leaf" @click="$emit('select', node)">{{ node.title }}</span>
        </template>
      </li>
    </ul>`,
};

/* ── Helpers ────────────────────────────────────────────── */

function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => $toast('Copied', 'success', 800)).catch(() => $toast('Copy failed', 'error'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); $toast('Copied', 'success', 800); } catch { $toast('Copy failed', 'error'); }
    document.body.removeChild(ta);
  }
}

function formatDuration(seconds) {
  if (seconds == null || seconds === '-') return '-';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':');
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/* ── Streaming video player mixin ───────────────────────── */

function createStreamPlayer(videoEl, statusEl) {
  let stopped = false, retryCount = 0, retryTimer = null, waitingTimer = null, baseUrl = null;

  const showStatus = (text) => { if (statusEl) { statusEl.textContent = text; statusEl.style.display = 'flex'; } };
  const hideStatus = () => { if (statusEl) statusEl.style.display = 'none'; };
  const clearTimers = () => { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } if (waitingTimer) { clearTimeout(waitingTimer); waitingTimer = null; } };
  const buildUrl = () => baseUrl + (baseUrl.includes('?') ? '&' : '?') + '_t=' + Date.now();

  const scheduleReconnect = () => {
    if (stopped || !videoEl) return;
    clearTimers();
    const delay = Math.min(15000, 1000 * Math.pow(2, Math.min(retryCount, 6))) + Math.floor(Math.random() * 300);
    showStatus('Offline, reconnecting...');
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (stopped || !videoEl) return;
      videoEl.pause(); videoEl.src = buildUrl(); videoEl.load();
      const p = videoEl.play(); if (p && p.catch) p.catch(() => {});
      retryCount++;
    }, delay);
  };

  const onPlaying = () => { retryCount = 0; clearTimers(); hideStatus(); };
  const onCanPlay = () => hideStatus();
  const onWaiting = () => {
    if (stopped) return;
    if (waitingTimer) return;
    waitingTimer = setTimeout(() => { waitingTimer = null; scheduleReconnect(); }, 4000);
  };
  const onError = () => scheduleReconnect();
  const onStalled = () => scheduleReconnect();
  const onEnded = () => scheduleReconnect();

  videoEl.addEventListener('playing', onPlaying);
  videoEl.addEventListener('canplay', onCanPlay);
  videoEl.addEventListener('waiting', onWaiting);
  videoEl.addEventListener('error', onError);
  videoEl.addEventListener('stalled', onStalled);
  videoEl.addEventListener('ended', onEnded);

  return {
    play(app, stream, isOnline) {
      this.stop();
      stopped = false; retryCount = 0;
      baseUrl = `http://${location.hostname}:8080/${encodeURIComponent(app)}/${encodeURIComponent(stream)}.live.mp4`;
      showStatus(isOnline ? 'Connecting...' : 'Stream offline, waiting for connection...');
      videoEl.src = buildUrl(); videoEl.load();
      const p = videoEl.play(); if (p && p.catch) p.catch(() => {});
    },
    stop() {
      stopped = true; baseUrl = null; retryCount = 0; clearTimers(); hideStatus();
      if (videoEl) { videoEl.pause(); videoEl.removeAttribute('src'); videoEl.load(); }
    },
    destroy() {
      this.stop();
      videoEl.removeEventListener('playing', onPlaying);
      videoEl.removeEventListener('canplay', onCanPlay);
      videoEl.removeEventListener('waiting', onWaiting);
      videoEl.removeEventListener('error', onError);
      videoEl.removeEventListener('stalled', onStalled);
      videoEl.removeEventListener('ended', onEnded);
    }
  };
}

/* ── Version ────────────────────────────────────────────── */

const STREAMUI_VERSION = '1.0.0';

/* ── Nav items ──────────────────────────────────────────── */

const navItems = [
  { hash: '#/dashboard', icon: '&#9881;', label: 'Dashboard' },
  { hash: '#/pull-streams', icon: '&#9654;', label: 'Pull Streams' },
  { hash: '#/push-streams', icon: '&#9654;', label: 'Push Streams' },
  { hash: '#/video-wall', icon: '&#9638;', label: 'Video Wall' },
  { hash: '#/playback', icon: '&#9205;', label: 'Playback' },
  { hash: '#/settings', icon: '&#9881;', label: 'Settings' },
];

/* ── Main App ───────────────────────────────────────────── */

const StreamUIApp = {
  template: `
    <div class="layout">
      <!-- Sidebar -->
      <aside class="sidebar" :class="{ collapsed }">
        <div class="sidebar-logo">
          <img src="./assets/logo.svg" alt="" class="logo-icon-only">
          <span class="logo-text">StreamUI</span>
        </div>
        <nav class="sidebar-nav">
          <a v-for="item in nav" :key="item.hash" :href="item.hash"
             :class="{ active: currentPage === item.hash }"
             @click.prevent="navigate(item.hash)">
            <span class="nav-icon" v-html="item.icon"></span>
            <span class="nav-label">{{ item.label }}</span>
          </a>
          <a :href="apiDocsUrl" target="_blank" rel="noopener noreferrer">
            <span class="nav-icon">&#128279;</span>
            <span class="nav-label">API Docs</span>
          </a>
        </nav>
        <div class="sidebar-version" v-show="!collapsed">v{{ version }}</div>
      </aside>

      <!-- Main -->
      <div class="main-area">
        <header class="header">
          <button class="header-btn" @click="collapsed = !collapsed" title="Toggle sidebar">
            {{ collapsed ? '&#9654;' : '&#9664;' }}
          </button>
          <button class="header-btn" @click="refreshKey++" title="Refresh page">&#8635;</button>
          <div class="header-spacer"></div>
        </header>
        <div class="page-body">
          <keep-alive>
            <component :is="pageComponent" :key="currentPage + '-' + refreshKey" />
          </keep-alive>
        </div>
      </div>
    </div>
    <app-toast />
    <app-confirm />`,

  setup() {
    const collapsed = ref(false);
    const currentPage = ref(location.hash || '#/dashboard');
    const refreshKey = ref(0);

    const pageMap = {
      '#/dashboard': 'PageDashboard',
      '#/pull-streams': 'PagePullStreams',
      '#/push-streams': 'PagePushStreams',
      '#/video-wall': 'PageVideoWall',
      '#/playback': 'PagePlayback',
      '#/settings': 'PageSettings',
    };

    const pageComponent = computed(() => pageMap[currentPage.value] || 'PageDashboard');

    const apiDocsUrl = computed(() => `${location.protocol}//${location.hostname}:10801/docs`);

    function navigate(hash) { location.hash = hash; currentPage.value = hash; }

    function onHashChange() { currentPage.value = location.hash || '#/dashboard'; }
    onMounted(() => { window.addEventListener('hashchange', onHashChange); if (!location.hash) location.hash = '#/dashboard'; });
    onUnmounted(() => window.removeEventListener('hashchange', onHashChange));

    return { collapsed, currentPage, refreshKey, nav: navItems, pageComponent, apiDocsUrl, navigate, version: STREAMUI_VERSION };
  }
};
