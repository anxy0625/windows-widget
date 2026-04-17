// ---- 工具函数 ----
function formatSpeed(bps) {
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// ---- 颜色工具 ----
function getColorClass(percent) {
  if (percent < 60) return '';
  if (percent < 80) return 'warn';
  return 'danger';
}

// ---- DOM 引用 ----
const widget = document.getElementById('widget');
const btnSettings = document.getElementById('btnSettings');
const btnPin = document.getElementById('btnPin');

const modDatetime = document.getElementById('modDatetime');
const timeDisplay = document.getElementById('timeDisplay');
const dateDisplay = document.getElementById('dateDisplay');

const modCpu = document.getElementById('modCpu');
const cpuUsage = document.getElementById('cpuUsage');
const cpuBar = document.getElementById('cpuBar');
const cpuTemp = document.getElementById('cpuTemp');

const modMemory = document.getElementById('modMemory');
const memPercent = document.getElementById('memPercent');
const memBar = document.getElementById('memBar');
const memDetail = document.getElementById('memDetail');

const modNetwork = document.getElementById('modNetwork');
const netUp = document.getElementById('netUp');
const netDown = document.getElementById('netDown');

const modWeather = document.getElementById('modWeather');
const weatherIcon = modWeather.querySelector('.module-icon');
const weatherCity = document.getElementById('weatherCity');
const btnRefreshWeather = document.getElementById('btnRefreshWeather');
const weatherLastUpdate = document.getElementById('weatherLastUpdate');
const weatherTemp = document.getElementById('weatherTemp');
const weatherDesc = document.getElementById('weatherDesc');
const weatherHumidity = document.getElementById('weatherHumidity');

// ---- 配置应用 ----
let currentConfig = null;

function applyConfig(config) {
  currentConfig = config;

  // 主题
  widget.className = `widget theme-${config.theme || 'dark'}`;

  // 模块显示/隐藏
  const m = config.modules || {};
  modDatetime.classList.toggle('hidden', !m.datetime);
  modCpu.classList.toggle('hidden', !m.cpu);
  modMemory.classList.toggle('hidden', !m.memory);
  modNetwork.classList.toggle('hidden', !m.network);
  modWeather.classList.toggle('hidden', !m.weather);

  // 透明度
  document.body.style.opacity = config.opacity || 0.9;

  // 置顶按钮状态同步
  updatePinButton(config.alwaysOnTop);

  if (m.weather) {
    fetchWeather();
  }
}

// ---- 日期时间 ----
const WEEK_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function updateDateTime() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  timeDisplay.textContent = `${h}:${m}:${s}`;

  const month = now.getMonth() + 1;
  const day = now.getDate();
  const week = WEEK_DAYS[now.getDay()];
  dateDisplay.textContent = `${now.getFullYear()}年${month}月${day}日 ${week}`;
}
setInterval(updateDateTime, 1000);
updateDateTime();

// ---- 系统数据更新 ----
window.electronAPI.onConfigUpdated((config) => {
  applyConfig(config);
});

if (window.electronAPI.onSystemData) {
  window.electronAPI.onSystemData((data) => updateDisplay(data));
}

function updateDisplay(data) {
  if (!currentConfig) return;
  const m = currentConfig.modules || {};

  if (m.cpu && data.cpu) {
    const pct = data.cpu.usage;
    cpuUsage.textContent = pct;
    cpuBar.style.width = pct + '%';
    cpuBar.style.background = pct > 80
      ? 'linear-gradient(90deg, #ef4444, #f97316)'
      : pct > 60
      ? 'linear-gradient(90deg, #f59e0b, #f97316)'
      : '';
    cpuTemp.textContent = data.cpu.temp ? `温度: ${data.cpu.temp}°C` : '';
  }

  if (m.memory && data.memory) {
    const pct = data.memory.percent;
    memPercent.textContent = pct;
    memBar.style.width = pct + '%';
    memBar.style.background = pct > 85
      ? 'linear-gradient(90deg, #ef4444, #f97316)'
      : pct > 70
      ? 'linear-gradient(90deg, #f59e0b, #eab308)'
      : '';
    memDetail.textContent = `${formatBytes(data.memory.used)} / ${formatBytes(data.memory.total)}`;
  }

  if (m.network && data.network) {
    netUp.textContent = formatSpeed(data.network.up);
    netDown.textContent = formatSpeed(data.network.down);
  }
}

// ---- 天气 ----
let weatherTimer = null;

async function fetchWeather(force = false) {
  if (force && btnRefreshWeather) {
    btnRefreshWeather.classList.add('spinning');
    setTimeout(() => btnRefreshWeather.classList.remove('spinning'), 800);
  }
  try {
    const data = await window.electronAPI.fetchWeather({ force });
    if (data) {
      weatherCity.textContent = data.city || '天气';
      weatherTemp.textContent = data.temp || '--';
      weatherDesc.textContent = translateDesc(data.desc); // 尝试中文转换
      weatherHumidity.textContent = data.humidity ? `湿度: ${data.humidity}` : '';

      // 动态更新天气图标
      if (data.code) {
        weatherIcon.textContent = getWeatherIcon(data.code, data.provider);
      }
      
      // 更新上次刷新时间
      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const hh = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      weatherLastUpdate.textContent = `${mm}-${dd} ${hh}:${min}`;
    }
  } catch (e) {}
}

// 天气状态映射函数
function getWeatherIcon(code, provider) {
  const c = parseInt(code);

  if (provider === 'owm') {
    // OpenWeatherMap 标准映射 (2xx雷, 3xx/5xx雨, 6xx雪, 7xx雾, 800晴, 80x云)
    if (c >= 200 && c < 300) return '⛈'; 
    if (c >= 300 && c < 600) return '🌧';
    if (c >= 600 && c < 700) return '❄️';
    if (c >= 700 && c < 800) return '🌫';
    if (c === 800) return '☀️';
    if (c >= 801 && c < 900) return '⛅';
  } else {
    // WWO (wttr.in) 标准映射
    const wwoMap = {
      '113': '☀️', '116': '🌤', '119': '☁️', '122': '🌥',
      '143': '🌫', '248': '🌫', '260': '🌫', 
      '176': '🌧', '179': '❄️', '182': '🌧', '185': '🌧',
      '200': '⛈', '227': '❄️', '230': '❄️',
      '263': '🌧', '266': '🌧', '281': '🌧', '284': '🌧',
      '293': '🌧', '296': '🌧', '299': '🌧', '302': '🌧', '305': '🌧', '308': '🌧',
      '311': '🌧', '314': '🌧', '317': '🌧', '320': '🌧',
      '323': '❄️', '326': '❄️', '329': '❄️', '332': '❄️', '335': '❄️', '338': '❄️',
      '353': '🌧', '356': '🌧', '359': '🌧',
      '368': '❄️', '371': '❄️',
      '386': '⛈', '389': '⛈', '392': '⛈', '395': '⛈'
    };
    if (wwoMap[code]) return wwoMap[code];
    // 根据区间粗略判定
    if (c >= 386 || c === 200) return '⛈';
    if (c >= 323 && c <= 338) return '❄️';
    if (c >= 176 && c <= 314) return '🌧';
    if (c >= 116 && c <= 122) return '⛅';
    return c === 113 ? '☀️' : '🌤';
  }
  return '🌤';
}

function translateDesc(desc) {
  if (!desc) return '';
  const map = {
    'Clear': '晴', 'Sunny': '晴', 'Partly cloudy': '多云', 'Cloudy': '阴',
    'Overcast': '阴', 'Mist': '薄雾', 'Fog': '大雾', 'Patchy rain possible': '可能有雨',
    'Light rain': '小雨', 'Moderate rain': '中雨', 'Heavy rain': '大雨',
    'Thundery outbreaks possible': '可能有雷阵雨', 'Light snow': '小雪'
  };
  // 如果 API 没返回中文且匹配到词库，则翻译
  return map[desc] || desc;
}

if (btnRefreshWeather) {
  btnRefreshWeather.addEventListener('click', () => {
    fetchWeather(true);
  });
}

setInterval(() => {
  if (currentConfig && currentConfig.modules && currentConfig.modules.weather) {
    fetchWeather();
  }
}, 10 * 60 * 1000);

// ---- 置顶按钮状态 ----
function updatePinButton(isOnTop) {
  btnPin.classList.toggle('active', isOnTop);
  btnPin.title = isOnTop ? '取消置顶' : '置顶';
}

btnPin.addEventListener('click', async () => {
  const isOnTop = await window.electronAPI.toggleAlwaysOnTop();
  updatePinButton(isOnTop);
});

btnSettings.addEventListener('click', async () => {
  window.electronAPI.openSettings && window.electronAPI.openSettings();
});

// ---- 进程排行榜 ----
const btnCpuTop = document.getElementById('btnCpuTop');
const cpuProcPanel = document.getElementById('cpuProcPanel');
const cpuProcList = document.getElementById('cpuProcList');
const btnMemTop = document.getElementById('btnMemTop');
const memProcPanel = document.getElementById('memProcPanel');
const memProcList = document.getElementById('memProcList');

let cpuPanelOpen = false;
let memPanelOpen = false;
let cpuProcTimer = null;
let memProcTimer = null;

// 用于记录哪些进程组（按名称）是被展开的，避免刷新时收起
const expandedGroups = new Set();

function getRefreshMs() {
  return (currentConfig ? currentConfig.refreshInterval || 2 : 2) * 1000;
}

// 同步窗口高度 (使用 ResizeObserver 并加入防抖阈值防止死锁卡顿)
let lastHeight = 0;
const resizeObserver = new ResizeObserver(() => {
  requestAnimationFrame(() => {
    // 折叠状态下不要通过 ResizeObserver 调整窗口大小，交由主进程管理
    if (isCollapsed) return;
    const h = widget.offsetHeight;
    if (h > 0 && Math.abs(h - lastHeight) > 1) { // 差异超过1px才触发 IPC
      lastHeight = h;
      window.electronAPI.resizeWindow({ height: h });
    }
  });
});
window.addEventListener('DOMContentLoaded', () => {
  resizeObserver.observe(widget);
});

// 渲染进程列表
function renderProcList(container, procs, sortBy) {
  if (!procs || procs.length === 0) {
    container.innerHTML = '<div class="proc-loading">暂无数据</div>';
    return;
  }
  
  // 完全基于字符串拼接重新构建 HTML，保留 expanded 状态
  container.innerHTML = procs.map((g, i) => {
    const isExpanded = expandedGroups.has(g.name);
    const gVal = sortBy === 'cpu' ? `${g.cpu}%` : (g.mem >= 1024 ? `${(g.mem/1024).toFixed(1)}GB` : `${g.mem}MB`);
    
    // 子进程 HTML
    const childrenHtml = g.children.map(c => {
      const cVal = sortBy === 'cpu' ? `${c.cpu}%` : (c.mem >= 1024 ? `${(c.mem/1024).toFixed(1)}G` : `${c.mem}M`);
      return `
        <div class="proc-item child-item" data-pid="${c.pid}">
          <span class="proc-rank">↳</span>
          <span class="proc-name" title="PID: ${c.pid}">PID: ${c.pid}</span>
          <span class="proc-value">${cVal}</span>
          <button class="proc-kill btn-kill-child" title="终止子进程 ${c.pid}" data-pid="${c.pid}">✕</button>
        </div>`;
    }).join('');

    return `
      <div class="proc-group" data-name="${g.name}">
        <div class="proc-item group-header">
          <span class="proc-expander ${isExpanded ? 'expanded' : ''}" title="展开/折叠">▶</span>
          <span class="proc-name" title="${g.name}">${g.name} (${g.children.length})</span>
          <span class="proc-value">${gVal}</span>
          <button class="proc-kill btn-kill-group" title="终止 ${g.name} 全体进程" data-name="${g.name}">✕</button>
        </div>
        <div class="proc-children ${isExpanded ? '' : 'hidden'}">
          ${childrenHtml}
        </div>
      </div>
    `;
  }).join('');

  // 绑定展开/折叠事件
  container.querySelectorAll('.group-header').forEach(header => {
    header.addEventListener('click', (e) => {
      // 若点击了 kill 按钮则跳过组折叠
      if (e.target.closest('.proc-kill')) return;
      
      const groupDiv = header.closest('.proc-group');
      const name = groupDiv.dataset.name;
      const childrenDiv = header.nextElementSibling;
      const expander = header.querySelector('.proc-expander');
      
      if (childrenDiv.classList.contains('hidden')) {
        childrenDiv.classList.remove('hidden');
        expander.classList.add('expanded');
        expandedGroups.add(name);
      } else {
        childrenDiv.classList.add('hidden');
        expander.classList.remove('expanded');
        expandedGroups.delete(name);
      }
    });
  });

  // 绑定 Kill Group 事件 (按名称全杀)
  container.querySelectorAll('.btn-kill-group').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.dataset.name;
      const groupEl = btn.closest('.proc-group');
      btn.textContent = '…';
      const res = await window.electronAPI.killProcess({ name });
      if (res.success) {
        groupEl.style.opacity = '0.3';
        groupEl.style.textDecoration = 'line-through';
        setTimeout(() => groupEl.remove(), 600);
      } else {
        btn.textContent = '✕';
        btn.style.color = '#ef4444';
      }
    });
  });

  // 绑定 Kill Child 事件 (单条 PID 杀)
  container.querySelectorAll('.btn-kill-child').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const pid = parseInt(btn.dataset.pid);
      const childEl = btn.closest('.child-item');
      btn.textContent = '…';
      const res = await window.electronAPI.killProcess({ pid });
      if (res.success) {
        childEl.style.opacity = '0.3';
        childEl.style.textDecoration = 'line-through';
        setTimeout(() => childEl.remove(), 600);
      } else {
        btn.textContent = '✕';
        btn.style.color = '#ef4444';
      }
    });
  });
}

// 拉取并渲染
async function fetchAndRenderProcs(sortBy) {
  const container = sortBy === 'cpu' ? cpuProcList : memProcList;
  try {
    const procs = await window.electronAPI.getTopProcesses({ sortBy });
    renderProcList(container, procs, sortBy);
  } catch (e) {
    container.innerHTML = '<div class="proc-loading">获取失败</div>';
  }
}

// 开/关面板
function togglePanel(type) {
  const isOpen = type === 'cpu' ? cpuPanelOpen : memPanelOpen;
  const panel = type === 'cpu' ? cpuProcPanel : memProcPanel;
  const btn = type === 'cpu' ? btnCpuTop : btnMemTop;

  if (isOpen) {
    // 收起
    panel.classList.add('hidden');
    btn.classList.remove('active');
    if (type === 'cpu') { clearInterval(cpuProcTimer); cpuProcTimer = null; cpuPanelOpen = false; }
    else { clearInterval(memProcTimer); memProcTimer = null; memPanelOpen = false; }
  } else {
    // 展开
    panel.classList.remove('hidden');
    btn.classList.add('active');
    const listEl = type === 'cpu' ? cpuProcList : memProcList;
    listEl.innerHTML = '<div class="proc-loading">加载中...</div>';

    if (type === 'cpu') {
      cpuPanelOpen = true;
      fetchAndRenderProcs('cpu');
      cpuProcTimer = setInterval(() => fetchAndRenderProcs('cpu'), getRefreshMs());
    } else {
      memPanelOpen = true;
      fetchAndRenderProcs('mem');
      memProcTimer = setInterval(() => fetchAndRenderProcs('mem'), getRefreshMs());
    }
  }
}

btnCpuTop.addEventListener('click', () => togglePanel('cpu'));
btnMemTop.addEventListener('click', () => togglePanel('mem'));

// ---- 初始化 ----
async function init() {
  const config = await window.electronAPI.getConfig();
  applyConfig(config);
}

init();

// ---- 置顶折叠特性 (Dock Top) ----
let isDockedTop = false;
let isCollapsed = false;

if (window.electronAPI.onDockedTop) {
  window.electronAPI.onDockedTop((docked) => {
    isDockedTop = docked;
  });
}

if (window.electronAPI.onSetCollapsed) {
  window.electronAPI.onSetCollapsed((collapse) => {
    setCollapsed(collapse);
  });
}

function setCollapsed(collapse) {
  if (isCollapsed === collapse) return;
  isCollapsed = collapse;
  if (collapse) {
    widget.classList.add('collapsed');
  } else {
    widget.classList.remove('collapsed');
  }
}
