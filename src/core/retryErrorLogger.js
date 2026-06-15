const fs = require('fs');
const path = require('path');

class RetryErrorLogger {
    constructor() {
        this.persistPath = '';
        this.logs = [];
        this.maxLogs = 300; // 最多保留 300 条最新的重试/报错日志
    }

    /**
     * 初始化日志路径并从磁盘载入现有日志
     * @param {string} userDataPath 
     */
    init(userDataPath) {
        this.persistPath = path.join(userDataPath, 'retry_error_logs.json');
        this.loadFromDisk();
    }

    /**
     * 动态更新存储路径（用于数据目录迁移）
     * @param {string} newPath 
     */
    updatePath(newPath) {
        this.persistPath = path.join(newPath, 'retry_error_logs.json');
        this.loadFromDisk();
    }

    /**
     * 记录一条重试或报错日志
     * @param {string} type - 'RETRY' | 'ERROR'
     * @param {object} param1 
     */
    log(type, { path: reqPath, model, account, attempt, error }) {
        const timestamp = (() => {
            const now = new Date();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            const time = now.toLocaleTimeString('zh-CN', { hour12: false });
            return `${m}/${d} ${time}`;
        })();

        const logEntry = {
            id: Date.now() + '-' + Math.floor(Math.random() * 1000),
            timestamp,
            type, // 'RETRY' | 'ERROR'
            path: reqPath || '-',
            model: model || '-',
            account: account || '-',
            attempt: attempt || 1,
            error: error || 'Unknown Error'
        };

        this.logs.unshift(logEntry);
        
        // 限制最大日志条数，防止文件过大
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(0, this.maxLogs);
        }

        this.saveToDisk();
    }

    /**
     * 获取全部日志记录
     * @returns {Array}
     */
    getLogs() {
        return this.logs;
    }

    /**
     * 清空日志
     * @param {string} type - 可选 'ALL' | 'RETRY' | 'ERROR'
     */
    clearLogs(type) {
        if (!type || type === 'ALL') {
            this.logs = [];
        } else {
            this.logs = this.logs.filter(log => log.type !== type);
        }
        this.saveToDisk();
    }

    /**
     * 写入磁盘
     */
    saveToDisk() {
        if (!this.persistPath) return;
        try {
            fs.writeFileSync(this.persistPath, JSON.stringify(this.logs, null, 2), 'utf8');
        } catch (e) {
            console.error('[RetryErrorLogger] Failed to save logs:', e);
        }
    }

    /**
     * 从磁盘载入
     */
    loadFromDisk() {
        if (!this.persistPath || !fs.existsSync(this.persistPath)) {
            this.logs = [];
            return;
        }
        try {
            const fileContent = fs.readFileSync(this.persistPath, 'utf8');
            const parsed = JSON.parse(fileContent);
            if (Array.isArray(parsed)) {
                this.logs = parsed;
            } else {
                this.logs = [];
            }
        } catch (e) {
            console.error('[RetryErrorLogger] Failed to load logs:', e);
            this.logs = [];
        }
    }
}

const logger = new RetryErrorLogger();
module.exports = logger;
