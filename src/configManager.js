const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const configPath = path.join(app.getPath('userData'), 'config.json');

const defaultConfig = {
  theme: 'dark',
  modules: {
    cpu: true,
    memory: true,
    network: true,
    datetime: true,
    weather: false
  },
  weatherCity: '北京',
  weatherApiKey: '',
  position: { x: null, y: null },
  opacity: 0.9,
  alwaysOnTop: true,
  refreshInterval: 2,   // 单位：秒，可选 1/2/3/5/10
  autoLaunch: false,    // 开机自启
  topN: 10,             // 进程排行榜显示数量
  resetPositionOnStart: false // 每次启动重置到默认位置
};

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return Object.assign({}, defaultConfig, raw, {
        modules: Object.assign({}, defaultConfig.modules, raw.modules)
      });
    }
  } catch (e) {}
  return Object.assign({}, defaultConfig);
}

function saveConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
}

// ---- 开机自启 ----
function applyAutoLaunch(enable) {
  // Electron 内置 app.setLoginItemSettings（Windows/macOS 原生）
  app.setLoginItemSettings({
    openAtLogin: enable,
    path: process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()]
  });
}

function getAutoLaunchStatus() {
  const settings = app.getLoginItemSettings();
  return settings.openAtLogin;
}

module.exports = {
  loadConfig,
  saveConfig,
  applyAutoLaunch,
  getAutoLaunchStatus,
  defaultConfig
};
