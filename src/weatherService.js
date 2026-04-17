const https = require('https');

class WeatherService {
  constructor() {
    this.weatherCache = null;
    this.weatherLastFetch = 0;
  }

  clearCache() {
    this.weatherCache = null;
    this.weatherLastFetch = 0;
  }

  async fetchWeather(config, force = false) {
    if (force) this.clearCache();
    
    // 只有 weather 模块开启时才真正请求
    if (!config.modules.weather) return null;

    const city = config.weatherCity;
    const apiKey = config.weatherApiKey;

    const now = Date.now();
    if (this.weatherCache && now - this.weatherLastFetch < 10 * 60 * 1000) {
      return this.weatherCache;
    }

    return new Promise((resolve) => {
      if (!apiKey) {
        const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh-cn`;
        https.get(url, { headers: { 'User-Agent': 'curl/7.68.0', 'Accept-Language': 'zh-CN,zh;q=0.9' } }, (res) => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => {
            try {
              const j = JSON.parse(body);
              const cur = j.current_condition[0];
              this.weatherCache = {
                temp: cur.temp_C + '°C',
                desc: cur.weatherDesc[0].value,
                code: cur.weatherCode,
                provider: 'wwo', 
                humidity: cur.humidity + '%',
                city
              };
              this.weatherLastFetch = Date.now();
              resolve(this.weatherCache);
            } catch (e) { resolve(null); }
          });
        }).on('error', () => resolve(null));
      } else {
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=zh_cn`;
        https.get(url, (res) => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => {
            try {
              const j = JSON.parse(body);
              this.weatherCache = {
                temp: Math.round(j.main.temp) + '°C',
                desc: j.weather[0].description,
                code: String(j.weather[0].id),
                provider: 'owm',
                humidity: j.main.humidity + '%',
                city: j.name
              };
              this.weatherLastFetch = Date.now();
              resolve(this.weatherCache);
            } catch (e) { resolve(null); }
          });
        }).on('error', () => resolve(null));
      }
    });
  }
}

module.exports = new WeatherService();
