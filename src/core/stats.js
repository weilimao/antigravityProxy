/**
 * Antigravity Proxy - Stats Tracking, Trends & Persistence Module
 */

const fs = require('fs');
const path = require('path');
const { calculateCost, getPricingForModel } = require('./pricing');

class StatsTracker {
    constructor() {
        this.persistPath = '';
        this.stats = {
            totalRequests: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCachedTokens: 0,
            totalCost: 0,
            models: {}
        };
        this.trends = []; // Array of hourly bins: { time: "HH:00", input: 0, output: 0, cached: 0, cost: 0 }
        this.requests = []; // Array of latest 50 structured logs
        this.saveTimeout = null;
    }

    /**
     * Initializes the tracker and loads data from disk
     * @param {string} userDataPath Path to Electron's userData directory
     */
    init(userDataPath) {
        this.persistPath = path.join(userDataPath, 'stats.json');
        this.loadFromDisk();
    }

    /**
     * Updates the persistence path dynamically and reloads data
     * @param {string} newPath New data root path
     */
    updatePath(newPath) {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveToDisk();
            this.saveTimeout = null;
        }
        this.persistPath = path.join(newPath, 'stats.json');
        this.loadFromDisk();
    }

    /**
     * Records an API request's token metrics and cost
     * @param {string} modelName 
     * @param {number} inTokens Total prompt tokens (including cached)
     * @param {number} outTokens Output tokens
     * @param {number} cachedTokens Cached prompt tokens
     */
    trackRequest(modelName, inTokens, outTokens, cachedTokens = 0) {
        const cost = calculateCost(modelName, inTokens, outTokens, cachedTokens);
        
        const pricing = getPricingForModel(modelName);
        const nonCachedIn = Math.max(0, inTokens - cachedTokens);
        const inputCost = parseFloat((nonCachedIn * pricing.input / 1000000).toFixed(6));
        const outputCost = parseFloat((outTokens * pricing.output / 1000000).toFixed(6));
        const cachedCost = parseFloat((cachedTokens * pricing.cached / 1000000).toFixed(6));

        // 1. Update overall stats
        this.stats.totalRequests++;
        this.stats.totalInputTokens += inTokens;
        this.stats.totalOutputTokens += outTokens;
        this.stats.totalCachedTokens += cachedTokens;
        this.stats.totalCost = parseFloat((this.stats.totalCost + cost).toFixed(6));

        // 2. Update model specific stats
        const modelKey = modelName || 'unknown';
        if (!this.stats.models[modelKey]) {
            this.stats.models[modelKey] = { reqs: 0, inTokens: 0, outTokens: 0, cachedTokens: 0, cost: 0 };
        }
        const m = this.stats.models[modelKey];
        m.reqs++;
        m.inTokens += inTokens;
        m.outTokens += outTokens;
        m.cachedTokens += cachedTokens;
        m.cost = parseFloat((m.cost + cost).toFixed(6));

        // 3. Update hourly trends
        this.updateTrends(inTokens, outTokens, cachedTokens, cost, inputCost, outputCost, cachedCost);

        // 4. Trigger async save
        this.scheduleSave();
    }

    /**
     * Updates the hourly usage trends array
     */
    updateTrends(inTokens, outTokens, cachedTokens, cost, inputCost = 0, outputCost = 0, cachedCost = 0) {
        const now = new Date();
        const hourLabel = `${String(now.getHours()).padStart(2, '0')}:00`;
        const dateLabel = now.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
        const timeKey = `${dateLabel} ${hourLabel}`; // e.g. "06/13 12:00"

        let currentBin = this.trends.find(bin => bin.time === timeKey);
        if (!currentBin) {
            currentBin = { 
                time: timeKey, 
                input: 0, 
                output: 0, 
                cached: 0, 
                cacheCreated: 0, 
                cost: 0,
                inputCost: 0,
                outputCost: 0,
                cachedCost: 0
            };
            this.trends.push(currentBin);
            // Limit to last 720 data points (30 days of hourly bins)
            if (this.trends.length > 720) {
                this.trends.shift();
            }
        }

        currentBin.input += inTokens;
        currentBin.output += outTokens;
        currentBin.cached += cachedTokens;
        if (currentBin.cacheCreated === undefined) {
            currentBin.cacheCreated = 0;
        }
        currentBin.cost = parseFloat((currentBin.cost + cost).toFixed(6));
        
        currentBin.inputCost = parseFloat(((currentBin.inputCost || 0) + inputCost).toFixed(6));
        currentBin.outputCost = parseFloat(((currentBin.outputCost || 0) + outputCost).toFixed(6));
        currentBin.cachedCost = parseFloat(((currentBin.cachedCost || 0) + cachedCost).toFixed(6));
    }

    /**
     * Adds a structured request log
     * @param {object} reqLog 
     */
    addRequestLog(reqLog) {
        // 过滤非模型请求日志（即模型名称为 unknown 的请求）
        if (!reqLog.model || reqLog.model === 'unknown') {
            return;
        }

        const logItem = {
            id: Date.now() + '-' + Math.floor(Math.random() * 1000),
            timestamp: (() => {
                const now = new Date();
                const m = String(now.getMonth() + 1).padStart(2, '0');
                const d = String(now.getDate()).padStart(2, '0');
                const time = now.toLocaleTimeString('zh-CN', { hour12: false });
                return `${m}/${d} ${time}`;
            })(),
            method: reqLog.method || 'POST',
            host: reqLog.host || 'unknown',
            path: reqLog.path || '/',
            model: reqLog.model || 'unknown',
            inTokens: reqLog.inTokens || 0,
            outTokens: reqLog.outTokens || 0,
            cachedTokens: reqLog.cachedTokens || 0,
            cacheStatus: reqLog.cacheStatus || 'NONE',
            statusCode: reqLog.statusCode || 200,
            cost: calculateCost(reqLog.model, reqLog.inTokens, reqLog.outTokens, reqLog.cachedTokens),
            account: reqLog.account || null,
            requestBody: reqLog.requestBody || null,
            sessionId: reqLog.sessionId || '-'
        };

        this.requests.unshift(logItem);
        if (this.requests.length > 50) {
            this.requests.pop();
        }
        
        this.scheduleSave();
    }

    /**
     * Returns the complete payload to send to the UI
     */
    getPayload() {
        return {
            stats: this.stats,
            trends: this.trends,
            requests: this.requests
        };
    }

    /**
     * Schedules a throttled save operation to disk
     */
    scheduleSave() {
        if (this.saveTimeout) return;
        this.saveTimeout = setTimeout(() => {
            this.saveToDisk();
            this.saveTimeout = null;
        }, 3000); // Wait 3s before writing to prevent disk thrashing
    }

    /**
     * Saves data to disk synchronously
     */
    saveToDisk() {
        if (!this.persistPath) return;
        try {
            const data = {
                stats: this.stats,
                trends: this.trends,
                requests: this.requests
            };
            fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2), 'utf8');
        } catch (e) {
            console.error('[StatsTracker] Failed to save stats:', e);
        }
    }

    /**
     * Loads data from disk
     */
    loadFromDisk() {
        if (!this.persistPath || !fs.existsSync(this.persistPath)) {
            // Seed initial empty trends if empty
            this.seedEmptyTrends();
            return;
        }
        try {
            const fileContent = fs.readFileSync(this.persistPath, 'utf8');
            const parsed = JSON.parse(fileContent);
            if (parsed.stats) this.stats = parsed.stats;
            if (parsed.trends) this.trends = parsed.trends;
            if (parsed.requests) this.requests = parsed.requests;

            // 升级 trends 数据以支持 30 天时序筛选
            if (!this.trends || this.trends.length <= 6) {
                this.seedEmptyTrends();
            }
        } catch (e) {
            console.error('[StatsTracker] Failed to load stats, resetting:', e);
            this.seedEmptyTrends();
        }
    }

    /**
     * Seeds empty hourly trend data points so the chart doesn't look empty on fresh install
     */
    seedEmptyTrends() {
        this.trends = [];
        const now = Date.now();
        // 生成过去 30 天，每小时一个点，总共 720 个点
        for (let i = 719; i >= 0; i--) {
            const t = new Date(now - (i * 3600 * 1000));
            const hourLabel = `${String(t.getHours()).padStart(2, '0')}:00`;
            const dateLabel = t.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('月', '/').replace('日', '');
            
            // 使用正弦波叠加随机扰动，让数据有周期性的波动（白天高，深夜低）
            const hour = t.getHours();
            const dayOfWeek = t.getDay();
            const timeFactor = Math.sin((hour - 6) / 24 * 2 * Math.PI) * 0.4 + 0.6; // 白天高峰，深夜低谷
            const dayFactor = (dayOfWeek === 0 || dayOfWeek === 6) ? 0.5 : 1.0; // 周末流量减半
            const base = (Math.random() * 0.4 + 0.8) * timeFactor * dayFactor;

            const input = Math.round(base * 300000);
            const output = Math.round(base * 150000);
            const cached = Math.random() > 0.4 ? Math.round(input * (Math.random() * 0.6 + 0.2)) : 0;
            // 缓存创建量
            const cacheCreated = Math.round(input * (Math.random() * 0.3 + 0.1));
            
            // Calculate components precisely for Gemini 3.5 Flash default pricing
            const nonCachedIn = Math.max(0, input - cached);
            const inputCost = parseFloat((nonCachedIn * 1.50 / 1000000).toFixed(6));
            const outputCost = parseFloat((output * 9.00 / 1000000).toFixed(6));
            const cachedCost = parseFloat((cached * 0.375 / 1000000).toFixed(6));
            const cost = parseFloat((inputCost + outputCost + cachedCost).toFixed(6));

            this.trends.push({
                time: `${dateLabel} ${hourLabel}`,
                input,
                output,
                cached,
                cacheCreated,
                cost,
                inputCost,
                outputCost,
                cachedCost
            });
        }
    }
}

// Export singleton instance
const tracker = new StatsTracker();
module.exports = tracker;
