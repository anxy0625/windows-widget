const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  closeSettings: () => ipcRenderer.invoke('close-settings'),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  fetchWeather: (params) => ipcRenderer.invoke('fetch-weather', params),
  getWeather: (params) => ipcRenderer.invoke('get-weather', params),
  getAutoLaunchStatus: () => ipcRenderer.invoke('get-auto-launch-status'),
  getTopProcesses: (params) => ipcRenderer.invoke('get-top-processes', params),
  killProcess: (params) => ipcRenderer.invoke('kill-process', params),
  resizeWindow: (params) => ipcRenderer.invoke('resize-window', params),
  onConfigUpdated: (callback) => {
    ipcRenderer.on('config-updated', (_, config) => callback(config));
  },
  onSystemData: (callback) => {
    ipcRenderer.on('system-data', (_, data) => callback(data));
  },
  onDockedTop: (callback) => {
    ipcRenderer.on('docked-top', (_, docked) => callback(docked));
  },
  onSetCollapsed: (callback) => {
    ipcRenderer.on('set-collapsed', (_, collapse) => callback(collapse));
  }
});
