const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const configManager = require('./src/configManager');
const weatherService = require('./src/weatherService');
const systemMonitor = require('./src/systemMonitor');

let mainWindow;
let tray;
let settingsWindow;
let monitorTimer = null;

let config = configManager.loadConfig();

// 启动/重启监控定时器（支持动态调整间隔）
function startMonitor() {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }

  // 如果 CPU/内存/网络 模块全关闭，不开定时器
  const m = config.modules;
  if (!m.cpu && !m.memory && !m.network) return;

  const intervalMs = (config.refreshInterval || 2) * 1000;

  const tick = async () => {
    // 窗口不可见时跳过采集，节省性能
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
    const data = await systemMonitor.collectData(config);
    if (data) mainWindow.webContents.send('system-data', data);
  };

  tick(); // 立即执行一次
  monitorTimer = setInterval(tick, intervalMs);
}

// ---- 窗口创建 ----
function createMainWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { x: dX, y: dY, width: dW, height: dH } = primaryDisplay.workArea;

  const winW = config.width || 200;
  const defaultX = dX + dW - winW - 20;
  const defaultY = dY + Math.round(dH / 2) - 240;

  let winX = config.position.x;
  let winY = config.position.y;

  // 使用用户设定的强制归位，或者坐标不存在时归位
  if (config.resetPositionOnStart || winX === null || winY === null || winX === undefined) {
    winX = defaultX;
    winY = defaultY;
  } else {
    // 增加极端越界保护：如果它跑到所有显示器外面太远，则强制拉回主屏居中
    const display = screen.getDisplayNearestPoint({ x: winX, y: winY });
    const { x: curX, y: curY, width: curW, height: curH } = display.workArea;
    if (winX < curX - 250 || winX > curX + curW || winY < curY - 100 || winY > curY + curH) {
      winX = defaultX;
      winY = defaultY;
    }
  }

  // 计算一个安全的右边缘初始位置（避让滚动条等，若还是过去的写死值则重新调整）
  const safeRightMargin = 20;
  if (winX === dX + dW - 220 || winX === dX + dW - 200) {
     winX = defaultX;
  }

  const appIconPath = path.join(__dirname, 'assets', 'app_icon.png');
  const appIcon = fs.existsSync(appIconPath)
    ? nativeImage.createFromPath(appIconPath)
    : null;

  mainWindow = new BrowserWindow({
    width: winW,
    height: 480,
    minWidth: 200,
    x: winX,
    y: winY,
    frame: false,
    transparent: true,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    icon: appIcon,
    type: 'toolbar', // 关键修改：设为工具栏类型，防止点击桌面时被隐藏
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('renderer/index.html');

  mainWindow.on('moved', () => {
    let [x, y] = mainWindow.getPosition();
    const [w, h] = mainWindow.getSize();

    // 获取窗口所在的显示器工作区（支持多显示器）
    const display = screen.getDisplayNearestPoint({ x: x + w / 2, y: y + h / 2 });
    const { x: dx, y: dy, width: dw, height: dh } = display.workArea;

    const SNAP = 20; // 吸附距离
    let snapped = false;

    // 边缘吸附 (下边缘不强制吸附出屏幕界限，右侧吸附留20px间隙避让下方滚动条)
    if (Math.abs(x - dx) < SNAP)             { x = dx;          snapped = true; }
    if (Math.abs((x + w) - (dx + dw)) < SNAP) { x = dx + dw - w - 20; snapped = true; }
    if (Math.abs(y - dy) < SNAP)             { y = dy;          snapped = true; }

    // 禁止移出屏幕: 左右边界限制 (右侧同样留20px间隙)
    if (x < dx)          { x = dx;          snapped = true; }
    if (x + w > dx + dw) { x = dx + dw - w - 20; snapped = true; }
    
    // 强制限制上边缘，永远不允许跑到屏幕上面以至于无法拖动
    if (y < dy)          { y = dy;          snapped = true; }

    if (snapped) mainWindow.setPosition(x, y);

    config.position = { x, y };
    configManager.saveConfig(config);

    // ---- 顶部吸附收纳逻辑 (Dock Top) ----
    const isDockedTop = (y === dy);
    const COLLAPSED_HEIGHT = 6;        // 折叠后窗口实际高度（像素），尽量薄以免遮挡浏览器标签
    
    // 初始化防抖变量（挂载在 mainWindow 对象上便于跨闭包访问）
    if (mainWindow._currentDockedTop === undefined) {
      mainWindow._currentDockedTop = false;
      mainWindow._dockMonitorTimer = null;
      mainWindow._isCurrentlyCollapsed = false;
      mainWindow._expandedHeight = null; // 记住展开时的窗口高度，用于恢复
    }

    if (isDockedTop !== mainWindow._currentDockedTop) {
      mainWindow._currentDockedTop = isDockedTop;
      // 靠边时禁止用户手动拉伸
      mainWindow.setResizable(!isDockedTop);
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('docked-top', isDockedTop);
      }

      if (isDockedTop) {
        // 利用极低消耗的定时器进行精确物理位置轮询（每100ms），彻底绕过无边框窗体的 HTML 虚假鼠标事件
        mainWindow._dockMonitorTimer = setInterval(() => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          const point = screen.getCursorScreenPoint();
          const bounds = mainWindow.getBounds();
          
          const isInside = point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
                           point.y >= bounds.y && point.y <= bounds.y + bounds.height;
                           
          if (isInside && mainWindow._isCurrentlyCollapsed) {
            // 鼠标回归，展开：先恢复窗口大小和鼠标响应，再通知渲染进程
            mainWindow._isCurrentlyCollapsed = false;
            mainWindow.setIgnoreMouseEvents(false); // 恢复鼠标响应
            const [curW] = mainWindow.getSize();
            const restoreH = mainWindow._expandedHeight || 480;
            mainWindow.setResizable(true);
            mainWindow.setSize(curW, restoreH);
            mainWindow.setResizable(false);
            mainWindow.webContents.send('set-collapsed', false);
          } else if (!isInside && !mainWindow._isCurrentlyCollapsed) {
            // 鼠标移出边界，收起：先保存当前高度，再缩小窗口
            const [curW, curH] = mainWindow.getSize();
            mainWindow._expandedHeight = curH; // 记住展开高度
            mainWindow._isCurrentlyCollapsed = true;
            mainWindow.webContents.send('set-collapsed', true);
            // 延迟一帧缩小窗口，让渲染侧先完成折叠动画
            setTimeout(() => {
              if (mainWindow && !mainWindow.isDestroyed() && mainWindow._isCurrentlyCollapsed) {
                mainWindow.setResizable(true);
                mainWindow.setSize(curW, COLLAPSED_HEIGHT);
                mainWindow.setResizable(false);
                // 折叠后让窗口鼠标穿透，不拦截下方的浏览器等应用
                mainWindow.setIgnoreMouseEvents(true);
              }
            }, 50);
          }
        }, 100);
      } else {
        if (mainWindow._dockMonitorTimer) {
          clearInterval(mainWindow._dockMonitorTimer);
          mainWindow._dockMonitorTimer = null;
        }
        if (mainWindow._isCurrentlyCollapsed) {
          mainWindow._isCurrentlyCollapsed = false;
          // 恢复窗口大小和鼠标响应
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setIgnoreMouseEvents(false);
            const [curW] = mainWindow.getSize();
            const restoreH = mainWindow._expandedHeight || 480;
            mainWindow.setResizable(true);
            mainWindow.setSize(curW, restoreH);
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('set-collapsed', false);
          }
        }
      }
    }
  });

  mainWindow.on('resized', () => {
    const [w] = mainWindow.getSize();
    config.width = w;
    configManager.saveConfig(config);
  });

  mainWindow.on('show', updateTrayMenu);
  mainWindow.on('hide', updateTrayMenu);

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('config-updated', config);
    startMonitor();
  });
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    return;
  }
  
  const appIconPath = path.join(__dirname, 'assets', 'app_icon.png');
  const appIcon = fs.existsSync(appIconPath)
    ? nativeImage.createFromPath(appIconPath)
    : null;

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 700,
    resizable: false,
    icon: appIcon,
    title: '插件设置',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWindow.loadFile('renderer/settings.html');
  settingsWindow.setMenuBarVisibility(false);
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'app_icon.png');
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } else {
    icon = nativeImage.createFromDataURL(getDefaultTrayIcon());
  }
  tray = new Tray(icon);
  tray.setToolTip('桌面性能监控');
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) mainWindow.hide();
      else mainWindow.show();
    } else {
      createMainWindow();
    }
  });
  updateTrayMenu();
}

function updateTrayMenu() {
  const isVisible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  const menu = Menu.buildFromTemplate([
    {
      label: isVisible ? '📉  隐藏面板' : '📈  显示面板',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (isVisible) mainWindow.hide();
          else mainWindow.show();
        } else {
          createMainWindow();
        }
      }
    },
    { type: 'separator' },
    { label: '⚙️  打开设置', click: createSettingsWindow },
    { type: 'separator' },
    {
      label: config.alwaysOnTop ? '✅ 置顶显示' : '置顶显示',
      click: () => {
        config.alwaysOnTop = !config.alwaysOnTop;
        configManager.saveConfig(config);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setAlwaysOnTop(config.alwaysOnTop);
          mainWindow.webContents.send('config-updated', config);
        }
        updateTrayMenu();
      }
    },
    { type: 'separator' },
    {
      label: '🔄  重启应用',
      click: () => {
        // 先解除单例锁（如果有），防止重启后的新实例误触单例保护
        app.relaunch();
        app.exit(0); // 使用 exit(0) 强制干净退出，防止 quit() 流程过长干扰重启
      }
    },
    {
      label: '❌  彻底退出',
      click: () => {
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
}

// ---- IPC ----
ipcMain.handle('get-config', () => config);

ipcMain.handle('save-config', (_, newConfig) => {
  const oldInterval = config.refreshInterval;
  const oldModules = JSON.stringify(config.modules);

  config = Object.assign(config, newConfig, {
    modules: Object.assign({}, config.modules, newConfig.modules)
  });
  configManager.saveConfig(config);

  // 应用开机自启
  configManager.applyAutoLaunch(config.autoLaunch);

  // 如果刷新间隔或模块开关有变化，重启监控定时器
  const intervalChanged = oldInterval !== config.refreshInterval;
  const modulesChanged = oldModules !== JSON.stringify(config.modules);
  if (intervalChanged || modulesChanged) {
    if (intervalChanged) systemMonitor.clearNetStatsCache();
    if (newConfig.weatherCity || newConfig.weatherApiKey) weatherService.clearCache();
    startMonitor();
  }

  if (config.resetPositionOnStart && mainWindow && !mainWindow.isDestroyed()) {
    const [w] = mainWindow.getSize();
    const primaryDisplay = screen.getPrimaryDisplay();
    const { x: dX, y: dY, width: dW, height: dH } = primaryDisplay.workArea;
    mainWindow.setPosition(dX + dW - w - 20, dY + Math.round(dH / 2 - 240));
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('config-updated', config);
  }
  updateTrayMenu();
  return config;
});

ipcMain.handle('close-settings', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
});

ipcMain.handle('open-settings', () => {
  createSettingsWindow();
});

ipcMain.handle('toggle-always-on-top', () => {
  config.alwaysOnTop = !config.alwaysOnTop;
  configManager.saveConfig(config);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(config.alwaysOnTop);
  }
  updateTrayMenu();
  // 通知渲染进程更新按钮状态
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('config-updated', config);
  }
  return config.alwaysOnTop;
});

ipcMain.handle('fetch-weather', async (_, { force = false } = {}) => {
  return await weatherService.fetchWeather(config, force);
});

ipcMain.handle('get-weather', async (_, { city, apiKey }) => {
  weatherService.clearCache();
  // 临时用传入参数测试（不影响主配置）
  const tmpConfig = config.modules.weather;
  config.modules.weather = true;
  // 构建一个临时配置对象传递进去
  const testConfig = Object.assign({}, config, {
    weatherCity: city,
    weatherApiKey: apiKey
  });
  const result = await weatherService.fetchWeather(testConfig);
  config.modules.weather = tmpConfig;
  return result;
});

// 查询当前自启状态（给设置页初始化用）
ipcMain.handle('get-auto-launch-status', () => {
  return configManager.getAutoLaunchStatus();
});

// ---- 进程排行榜 ----
ipcMain.handle('get-top-processes', async (_, { sortBy }) => {
  return await systemMonitor.getTopProcesses(config, sortBy);
});

ipcMain.handle('kill-process', async (_, { pid, name }) => {
  return await systemMonitor.killProcess(pid, name);
});

ipcMain.handle('resize-window', (_, { height }) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    // 折叠状态下窗口大小由折叠逻辑管理，不接受来自渲染进程的调整
    if (mainWindow._isCurrentlyCollapsed) return;

    const pos = mainWindow.getPosition();
    const size = mainWindow.getSize();
    
    // 获取当前所在屏幕的高度安全可用区
    const display = screen.getDisplayNearestPoint({ x: pos[0], y: pos[1] });
    const maxSafeHeight = display.workArea.y + display.workArea.height - pos[1] - 10; // 给底部留10px间隙

    // 如果目标高度大于最大可用高度，则截断
    const finalHeight = Math.min(height, maxSafeHeight);
    
    mainWindow.setContentSize(size[0], finalHeight);
  }
});

// ---- 启动 ----
function getDefaultTrayIcon() {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAtElEQVQ4T2NkIBIwEqmOgWoGKCkpMTIwMPxnYGBg+I8kRqoLGBkZ/zMwMDD8RxIj1QWMjIz/GRgYGP4jidHFBYyMjP8ZGBgY/iOJkesDBkZGxv8MDAz/kcTIdQEjI+N/BgYGhv9IYuS6gJGR8T8DAwPDfyQxci1gZGT8z8DAwPAfSYxcCxgZGf8zMDAw/EcSI9cCRkbG/wwMDAz/kcTItYCRkfE/AwMDw38kMXItYGRk/M/AkJmZSYwLABirIBGrU4O0AAAAAElFTkSuQmCC';
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    } else {
      createMainWindow();
    }
  });

  app.whenReady().then(() => {
    // 启动时同步一次自启状态
    configManager.applyAutoLaunch(config.autoLaunch);
    createMainWindow();
    createTray();
  });
}

app.on('window-all-closed', (e) => {
  e.preventDefault();
});
