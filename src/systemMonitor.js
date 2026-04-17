const si = require('systeminformation');
const { exec } = require('child_process');

class SystemMonitor {
  constructor() {
    this.prevNetStats = null;
  }

  clearNetStatsCache() {
    this.prevNetStats = null;
  }

  async collectData(config) {
    const m = config.modules;
    try {
      // 并行发起只有已启用模块需要的请求
      const tasks = [];
      const keys = [];

      if (m.cpu) {
        tasks.push(si.currentLoad());
        keys.push('cpuLoad');
        tasks.push(si.cpuTemperature().catch(() => ({ main: null })));
        keys.push('cpuTemp');
      }
      if (m.memory) {
        tasks.push(si.mem());
        keys.push('mem');
      }
      if (m.network) {
        tasks.push(si.networkStats());
        keys.push('netStats');
      }

      const results = await Promise.all(tasks);
      const map = {};
      keys.forEach((k, i) => { map[k] = results[i]; });

      const data = {};

      if (m.cpu && map.cpuLoad) {
        data.cpu = {
          usage: Math.round(map.cpuLoad.currentLoad),
          temp: map.cpuTemp && map.cpuTemp.main ? Math.round(map.cpuTemp.main) : null
        };
      }

      if (m.memory && map.mem) {
        data.memory = {
          used: map.mem.active,
          total: map.mem.total,
          percent: Math.round((map.mem.active / map.mem.total) * 100)
        };
      }

      if (m.network && map.netStats && map.netStats.length > 0) {
        // 聚合所有网卡接口的流量（与任务管理器的总网络流量一致）
        let totalTx = 0, totalRx = 0, latestMs = 0;
        for (const stat of map.netStats) {
          totalTx += stat.tx_bytes;
          totalRx += stat.rx_bytes;
          if (stat.ms > latestMs) latestMs = stat.ms;
        }

        let network = { up: 0, down: 0 };
        if (this.prevNetStats && latestMs !== this.prevNetStats.ms) {
          const dt = (latestMs - this.prevNetStats.ms) / 1000 || 1;
          network.up = Math.max(0, (totalTx - this.prevNetStats.tx_bytes) / dt);
          network.down = Math.max(0, (totalRx - this.prevNetStats.rx_bytes) / dt);
        }
        this.prevNetStats = { ms: latestMs, tx_bytes: totalTx, rx_bytes: totalRx };
        data.network = network;
      }

      return data;
    } catch (e) {
      console.error('数据采集失败:', e.message);
      return null;
    }
  }

  async getTopProcesses(config, sortBy) {
    try {
      const procs = await si.processes();
      const n = config.topN || 10;
      
      // 系统保留进程黑名单，过滤以防止误杀或干扰视觉
      const SYSTEM_BLACKLIST = new Set([
        'memory compression',
        'registry',
        'system',
        'system idle process',
        'smss.exe',
        'csrss.exe',
        'wininit.exe',
        'services.exe',
        'lsass.exe',
        'winlogon.exe',
        'fontdrvhost.exe',
        'dwm.exe',
        'svchost.exe',
        'spoolsv.exe',
        'taskmgr.exe'
      ]);

      // 按名称聚合进程
      const map = new Map();
      procs.list.forEach(p => {
        if (!p.name || p.pid <= 4) return; // 过滤系统空闲和无效项
        
        const lowerName = p.name.toLowerCase();
        if (SYSTEM_BLACKLIST.has(lowerName)) return; // 过滤纯底层关键进程
        
        const key = p.name;
        if (!map.has(key)) map.set(key, { name: key, cpu: 0, mem: 0, children: [] });
        
        const entry = map.get(key);
        entry.cpu += p.cpu;
        entry.mem += p.memRss;
        entry.children.push({ pid: p.pid, cpu: p.cpu, mem: p.memRss });
      });

      // 排序父级、生成带有已排序子级的最终结果
      const sorted = Array.from(map.values())
        .sort((a, b) => sortBy === 'cpu' ? b.cpu - a.cpu : b.mem - a.mem)
        .slice(0, n)
        .map(g => ({
          name: g.name,
          cpu: Math.round(g.cpu * 10) / 10,
          mem: Math.round(g.mem / 1024), // MB
          children: g.children
            .sort((a, b) => sortBy === 'cpu' ? b.cpu - a.cpu : b.mem - a.mem)
            .map(c => ({
              pid: c.pid,
              cpu: Math.round(c.cpu * 10) / 10,
              mem: Math.round(c.mem / 1024)
            }))
        }));
        
      return sorted;
    } catch (e) {
      console.error('获取进程列表失败:', e.message);
      return [];
    }
  }

  async killProcess(pid, name) {
    return new Promise((resolve) => {
      const target = name ? `/IM "${name}"` : `/PID ${pid}`;
      exec(`taskkill /F ${target}`, (err) => {
        if (err) {
          console.error('终止进程失败:', err.message);
          resolve({ success: false, message: err.message });
        } else {
          resolve({ success: true });
        }
      });
    });
  }
}

module.exports = new SystemMonitor();
