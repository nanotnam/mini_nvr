/* Dashboard page – 7 ECharts charts with polling */
const PageDashboard = {
  template: `
    <div>
      <div class="card"><div class="card-body" style="display:flex; gap:0">
        <div ref="chartStatistic" style="flex:1;height:400px"></div>
        <div ref="chartWorkThreads" style="flex:1;height:400px"></div>
        <div ref="chartThreads" style="flex:1;height:400px"></div>
      </div></div>
      <div class="card"><div class="card-body" style="display:flex; gap:0">
        <div ref="chartCpu" style="flex:1;height:400px"></div>
        <div ref="chartMemory" style="flex:1;height:400px"></div>
        <div ref="chartDisk" style="flex:1;height:400px"></div>
        <div ref="chartNetwork" style="flex:1;height:400px"></div>
      </div></div>
    </div>`,
  setup() {
    const chartStatistic = ref(null);
    const chartWorkThreads = ref(null);
    const chartThreads = ref(null);
    const chartCpu = ref(null);
    const chartMemory = ref(null);
    const chartDisk = ref(null);
    const chartNetwork = ref(null);

    let charts = [];
    let timers = [];
    let historyData = [];
    const ecOpts = { locale: 'EN' };

    function poll(url, fn) {
      let stopped = false;
      const run = async () => {
        if (stopped) return;
        try {
          const res = await fetch(url).then(r => r.json());
          if (res.code === 0) fn(res);
        } catch {}
        if (!stopped) timers.push(setTimeout(run, 3000));
      };
      run();
      return () => { stopped = true; };
    }

    onMounted(() => {
      const ec = (el) => { const c = echarts.init(el, null, ecOpts); charts.push(c); return c; };
      const cStat = ec(chartStatistic.value);
      const cWT   = ec(chartWorkThreads.value);
      const cThr  = ec(chartThreads.value);
      const cCpu  = ec(chartCpu.value);
      const cMem  = ec(chartMemory.value);
      const cDisk = ec(chartDisk.value);
      const cNet  = ec(chartNetwork.value);

      poll('/api/perf/statistic', (res) => {
        cStat.setOption({
          title: { text: 'Statistic', left: 'center', textStyle: { fontSize: 14 } },
          tooltip: { confine: true },
          xAxis: { type: 'category', data: Object.keys(res.data), axisLabel: { rotate: 45, fontSize: 10 } },
          yAxis: { type: 'value' },
          series: [{ type: 'bar', data: Object.values(res.data), itemStyle: { color: '#009688' } }]
        });
      });

      poll('/api/perf/work-threads-load', (res) => {
        const names = [], delays = [], loads = [];
        res.data.forEach(item => { names.push(item.name.replace('work poller ', 'work ')); delays.push(item.delay); loads.push(item.load); });
        cWT.setOption({
          title: { text: 'WorkThreadsLoad', left: 'center', textStyle: { fontSize: 14 } },
          tooltip: { trigger: 'axis', confine: true },
          legend: { data: ['Delay', 'Load'], bottom: '5%', itemWidth: 12, itemHeight: 8 },
          xAxis: [{ type: 'category', data: names, axisLabel: { rotate: 45, fontSize: 10 } }],
          yAxis: [{ type: 'value', name: 'Delay (ms)', position: 'left' }, { type: 'value', name: 'Load (%)', position: 'right' }],
          series: [
            { name: 'Delay', type: 'line', data: delays, yAxisIndex: 0, itemStyle: { color: '#5B8FF9' } },
            { name: 'Load', type: 'bar', data: loads, yAxisIndex: 1, itemStyle: { color: '#D7504B' } }
          ]
        });
      });

      poll('/api/perf/threads-load', (res) => {
        const names = [], delays = [], loads = [];
        res.data.forEach(item => { names.push(item.name.replace('event poller ', 'event ')); delays.push(item.delay); loads.push(item.load); });
        cThr.setOption({
          title: { text: 'ThreadsLoad', left: 'center', textStyle: { fontSize: 14 } },
          tooltip: { trigger: 'axis', confine: true },
          legend: { data: ['Delay', 'Load'], bottom: '5%', itemWidth: 12, itemHeight: 8 },
          xAxis: [{ type: 'category', data: names, axisLabel: { rotate: 45, fontSize: 10 } }],
          yAxis: [{ type: 'value', name: 'Delay (ms)', position: 'left' }, { type: 'value', name: 'Load (%)', position: 'right' }],
          series: [
            { name: 'Delay', type: 'line', data: delays, yAxisIndex: 0, itemStyle: { color: '#5B8FF9' } },
            { name: 'Load', type: 'bar', data: loads, yAxisIndex: 1, itemStyle: { color: '#D7504B' } }
          ]
        });
      });

      function parseTimeToMs(t) { const [h,m,s] = t.split(':').map(Number); return (h*3600+m*60+s)*1000; }

      poll('/api/perf/host-stats', (res) => {
        const cur = res.data;
        historyData.push(cur);
        if (historyData.length > 5) historyData.shift();

        const times = historyData.map(d => d.time);
        cCpu.setOption({
          title: { text: 'CPU Usage', left: 'center', textStyle: { fontSize: 14 } },
          tooltip: { trigger: 'axis', confine: true, formatter(params) { const p = Array.isArray(params) ? params[0] : params; return (p?.axisValue || '') + '<br/>CPU Load: ' + (p?.value ?? '') + '%'; } },
          legend: { data: ['CPU'], bottom: '5%', itemWidth: 12, itemHeight: 8 },
          xAxis: { type: 'category', boundaryGap: false, data: times, axisLabel: { rotate: 45, fontSize: 10 } },
          yAxis: { type: 'value', axisLabel: { formatter: '{value}%' }, min: 0, max: 100 },
          series: [{ name: 'CPU', type: 'line', data: historyData.map(d => d.cpu), smooth: true, lineStyle: { color: '#73c0de', width: 2 }, itemStyle: { color: '#73c0de' }, areaStyle: { color: 'rgba(115,192,222,0.5)' } }]
        });

        cMem.setOption({
          title: { text: 'Memory Usage', left: 'center', textStyle: { fontSize: 14 } },
          tooltip: { trigger: 'axis', confine: true, formatter(params) {
            const p = Array.isArray(params) ? params[0] : params;
            const idx = p?.dataIndex ?? 0;
            const item = historyData[idx] || {};
            const mem = item.memory || {};
            const fmt = n => Number.isFinite(n) ? n.toFixed(1) : '-';
            const total = parseFloat(mem.total), used = parseFloat(mem.used);
            return (item.time || '') + '<br/>Total: ' + fmt(total) + ' GB<br/>Used: ' + fmt(used) + ' GB<br/>Free: ' + fmt(total - used) + ' GB';
          }},
          legend: { data: ['Memory Used'], bottom: '5%', itemWidth: 12, itemHeight: 8 },
          xAxis: { type: 'category', boundaryGap: false, data: historyData.map(d => d.time), axisLabel: { rotate: 45, fontSize: 10 } },
          yAxis: { type: 'value', axisLabel: { formatter: '{value} GB' }, max: parseFloat(cur.memory.total) },
          series: [{ name: 'Memory Used', type: 'line', data: historyData.map(d => parseFloat(d.memory.used)), lineStyle: { color: '#5470c6' }, itemStyle: { color: '#5470c6' }, areaStyle: {} }]
        });

        let disks = Array.isArray(cur.disks) ? cur.disks : [];
        if (!disks.length && cur.disk) disks = [{ device: 'disk', mountpoint: '/', fstype: '', used: cur.disk.used, total: cur.disk.total }];
        const diskNames = disks.map(d => d.device || d.mountpoint || 'disk');
        const diskUsed = disks.map(d => parseFloat(d.used));
        const diskTotal = disks.map(d => parseFloat(d.total));
        const diskFree = diskTotal.map((t, i) => parseFloat((t - diskUsed[i]).toFixed(1)));
        const diskMax = diskTotal.length > 0 ? Math.max(...diskTotal) : 0;

        cDisk.setOption({
          title: { text: 'Disk Usage', left: 'center', textStyle: { fontSize: 14 } },
          legend: { data: ['Used', 'Free'], bottom: '5%', itemWidth: 12, itemHeight: 8 },
          grid: { left: '8%', right: '8%', top: '15%', bottom: '20%' },
          xAxis: { type: 'value', max: diskMax, axisLabel: { formatter: '{value} GB', fontSize: 10 }, splitLine: { show: false } },
          yAxis: { type: 'category', data: diskNames },
          tooltip: { confine: true, formatter(params) { if (!Array.isArray(params)) params = [params]; const i = params[0]?.dataIndex ?? 0; return diskNames[i] + '<br/>Total: ' + diskTotal[i]?.toFixed(1) + ' GB<br/>Used: ' + diskUsed[i]?.toFixed(1) + ' GB<br/>Free: ' + diskFree[i]?.toFixed(1) + ' GB'; } },
          series: [
            { name: 'Used', type: 'bar', stack: 'disk', label: { show: true, position: 'inside', formatter: p => diskUsed[p.dataIndex].toFixed(1) + ' GB', color: '#fff' }, itemStyle: { color: '#91cc75' }, data: diskUsed },
            { name: 'Free', type: 'bar', stack: 'disk', label: { show: true, position: 'inside', formatter: p => diskFree[p.dataIndex].toFixed(1) + ' GB' }, itemStyle: { color: '#e0e0e0' }, data: diskFree }
          ]
        });

        const netRecv = [], netSent = [], netTimes = [];
        for (let i = 1; i < historyData.length; i++) {
          const prevMs = parseTimeToMs(times[i-1]), currMs = parseTimeToMs(times[i]);
          const diff = (currMs - prevMs) / 1000;
          if (diff >= 2.5 && diff <= 3.5) {
            const bRecv = historyData[i].net_io.recv - historyData[i-1].net_io.recv;
            const bSent = historyData[i].net_io.sent - historyData[i-1].net_io.sent;
            if (bRecv < 0 || bSent < 0) continue;
            netRecv.push(parseFloat((bRecv * 8 / 1e6 / diff).toFixed(2)));
            netSent.push(parseFloat((bSent * 8 / 1e6 / diff).toFixed(2)));
            netTimes.push(times[i]);
          }
        }

        cNet.setOption({
          title: { text: 'Bandwidth', left: 'center', textStyle: { fontSize: 14 } },
          tooltip: { trigger: 'axis', confine: true, formatter: params => params[0]?.name + '<br/>' + params.map(p => p.seriesName + ': ' + p.value + ' Mbps').join('<br/>') },
          legend: { data: ['Recv', 'Send'], bottom: '5%', itemWidth: 12, itemHeight: 8 },
          xAxis: { type: 'category', data: netTimes, axisLabel: { rotate: 45, fontSize: 10 } },
          yAxis: { type: 'value', min: 0, axisLabel: { formatter: '{value} Mbps' } },
          series: [
            { name: 'Recv', type: 'line', data: netRecv, smooth: true, lineStyle: { width: 2, color: '#91cc75' }, itemStyle: { color: '#91cc75' }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(145,204,117,0.5)' }, { offset: 1, color: 'rgba(145,204,117,0.1)' }] } } },
            { name: 'Send', type: 'line', data: netSent, smooth: true, lineStyle: { width: 2, color: '#fac858' }, itemStyle: { color: '#fac858' }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(250,200,88,0.5)' }, { offset: 1, color: 'rgba(250,200,88,0.1)' }] } } }
          ]
        });
      });
    });

    onUnmounted(() => {
      timers.forEach(t => clearTimeout(t));
      charts.forEach(c => c.dispose());
    });

    return { chartStatistic, chartWorkThreads, chartThreads, chartCpu, chartMemory, chartDisk, chartNetwork };
  }
};
