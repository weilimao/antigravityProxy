/**
 * Antigravity Proxy - Sticky Session Router
 *
 * 职责：将同一 IDE 会话的所有请求始终路由到同一账号，
 * 以确保 Gemini 服务端 Context Cache 持续命中，最大化缓存命中率。
 *
 * 核心特性：
 *  - 持久化：会话绑定关系写入 session_bindings.json，重启后保持缓存命中
 *  - 空闲优先：新会话优先分配无绑定的空闲账号，实现均匀负载
 *  - 故障转移：账号进入冷静期时，相关会话自动重新分配
 *  - TTL GC：30 分钟无活动的会话自动清理
 *  - 手动清空：提供 clearAllAndSave() 供 UI 按钮调用
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 会话 TTL：30 分钟无活动后过期
const SESSION_TTL_MS = 30 * 60 * 1000;

// GC 轮询间隔：5 分钟
const GC_INTERVAL_MS = 5 * 60 * 1000;

// 持久化文件名
const PERSIST_FILENAME = 'session_bindings.json';

class SessionRouter {
    constructor() {
        /** @type {Map<string, { accountId: string, lastActive: number }>} */
        this.sessionMap = new Map();
        this.gcTimer = null;
        this.persistPath = '';
        this.saveTimer = null;
    }

    // -------------------------------------------------------------------------
    // 生命周期
    // -------------------------------------------------------------------------

    /**
     * 初始化路由器：设置持久化路径并从磁盘加载已有绑定关系。
     * 应在 app ready 后、代理启动前调用（与 accountManager.init 同级）。
     *
     * @param {string} dataDir - Electron userData 目录
     */
    init(dataDir) {
        this.persistPath = path.join(dataDir, PERSIST_FILENAME);
        this._loadFromDisk();
        this._ensureGC();
        console.log(`[SessionRouter] 已初始化，加载 ${this.sessionMap.size} 个持久化会话绑定`);
    }

    /**
     * 数据目录迁移时调用，重定向持久化路径并重新加载。
     * @param {string} newDataDir
     */
    updatePath(newDataDir) {
        // 先将当前数据保存到旧路径
        this._saveToDisk();
        this.persistPath = path.join(newDataDir, PERSIST_FILENAME);
        this._loadFromDisk();
    }

    // -------------------------------------------------------------------------
    // 公开接口
    // -------------------------------------------------------------------------

    /**
     * 从拦截的请求中提取稳定的会话标识符。
     * 优先级：原始 Auth Token > socket 地址
     *
     * @param {import('http').IncomingMessage} req
     * @returns {string} sessionKey（永不为空）
     */
    extractSessionKey(req) {
        // 优先级 1：原始 IDE 的 Authorization Bearer Token
        // 同一 IDE 实例在整个会话期间 Token 固定不变，是最稳定的标识
        const authHeader = req.headers['authorization'] || '';
        if (authHeader.startsWith('Bearer ') && authHeader.length > 10) {
            const token = authHeader.substring(7);
            // 取 SHA256 哈希前 16 字符，避免在日志/文件中暴露明文 Token
            return 'auth:' + crypto.createHash('sha256').update(token).digest('hex').substring(0, 16);
        }

        // 优先级 2：客户端 socket 地址（同一 TCP 连接 = 同一 IDE 进程）
        const remoteAddr = (req.socket && req.socket.remoteAddress) || 'unknown';
        const remotePort = (req.socket && req.socket.remotePort) || '0';
        return 'sock:' + remoteAddr + ':' + remotePort;
    }

    /**
     * 核心路由方法：根据 sessionKey 获取已分配账号，或从可用账号中分配一个新的。
     *
     * @param {string} sessionKey - 由 extractSessionKey() 生成的会话标识
     * @param {Array<{id: string, email: string, access_token: string}>} availableAccounts - 当前未在冷静期的可用账号
     * @param {Function} [logFn] - 可选日志回调 (message: string) => void
     * @returns {{id: string, email: string, access_token: string} | null}
     */
    getOrAssignAccount(sessionKey, availableAccounts, logFn) {
        if (!availableAccounts || availableAccounts.length === 0) {
            return null;
        }

        const now = Date.now();
        const existing = this.sessionMap.get(sessionKey);

        // 检查已有映射是否仍然有效（账号仍在可用池中）
        if (existing) {
            const account = availableAccounts.find(a => a.id === existing.accountId);
            if (account) {
                // 刷新活跃时间戳（延迟写盘，避免每次请求都 I/O）
                existing.lastActive = now;
                this._scheduleSave();
                if (logFn) {
                    logFn(`🔒 [粘性路由] 会话 ${sessionKey} 命中已分配账号: ${account.email}`);
                }
                return account;
            }
            // 原映射账号已进入冷静期或被移除 → 清除旧映射，重新分配
            this.sessionMap.delete(sessionKey);
            if (logFn) {
                logFn(`🔄 [粘性路由] 会话 ${sessionKey} 原绑定账号不可用，重新分配...`);
            }
        }

        // 新会话或需要重新分配
        // 策略 1 —— 优先选取当前无任何会话绑定的「空闲账号」
        const boundAccountIds = this._getBoundAccountIds();
        const idleAccounts = availableAccounts.filter(a => !boundAccountIds.has(a.id));

        let assigned;
        if (idleAccounts.length > 0) {
            // 有空闲账号：哈希均匀选取（避免多空闲时全堆给第一个）
            const index = this._hashToIndex(sessionKey, idleAccounts.length);
            assigned = idleAccounts[index];
            if (logFn) {
                logFn(`🆕 [粘性路由] 会话 ${sessionKey} 分配至空闲账号: ${assigned.email} (空闲 ${idleAccounts.length}/${availableAccounts.length})`);
            }
        } else {
            // 策略 2 —— 所有账号均已有绑定：一致性哈希均匀分摊
            const index = this._hashToIndex(sessionKey, availableAccounts.length);
            assigned = availableAccounts[index];
            if (logFn) {
                logFn(`🆕 [粘性路由] 会话 ${sessionKey} 哈希分配账号: ${assigned.email} (所有账号均已绑定)`);
            }
        }

        this.sessionMap.set(sessionKey, { accountId: assigned.id, lastActive: now });
        this._scheduleSave();
        this._ensureGC();

        return assigned;
    }

    /**
     * 清空所有会话绑定并立即写盘。
     * 供 UI「清空会话绑定」按钮调用。
     *
     * @returns {number} 被清空的会话数量
     */
    clearAllAndSave() {
        const count = this.sessionMap.size;
        this.sessionMap.clear();
        this._saveToDisk(); // 立即写盘（覆盖为空文件）
        console.log(`[SessionRouter] 手动清空所有会话绑定 (共 ${count} 个)`);
        return count;
    }

    /**
     * 当某账号进入冷静期时调用，作废使用该账号的所有会话映射。
     * 下次请求时这些会话将自动重新哈希到其他可用账号。
     *
     * @param {string} accountId
     * @returns {number} 被作废的会话数量
     */
    invalidateByAccountId(accountId) {
        let count = 0;
        for (const [key, entry] of this.sessionMap.entries()) {
            if (entry.accountId === accountId) {
                this.sessionMap.delete(key);
                count++;
            }
        }
        if (count > 0) {
            this._scheduleSave();
        }
        return count;
    }

    /**
     * 返回当前活跃会话数量（用于调试与 UI 展示）
     * @returns {number}
     */
    getSessionCount() {
        return this.sessionMap.size;
    }

    // -------------------------------------------------------------------------
    // 持久化
    // -------------------------------------------------------------------------

    /**
     * 从磁盘加载持久化的会话绑定关系。
     * 过期条目（超过 TTL）在加载时即被丢弃。
     */
    _loadFromDisk() {
        if (!this.persistPath || !fs.existsSync(this.persistPath)) return;
        try {
            const raw = fs.readFileSync(this.persistPath, 'utf8');
            const data = JSON.parse(raw);
            const now = Date.now();
            let loaded = 0;
            this.sessionMap.clear();
            for (const [key, entry] of Object.entries(data)) {
                // 丢弃已超过 TTL 的旧条目
                if (now - entry.lastActive <= SESSION_TTL_MS) {
                    this.sessionMap.set(key, entry);
                    loaded++;
                }
            }
            console.log(`[SessionRouter] 从磁盘加载 ${loaded} 个有效会话绑定`);
        } catch (e) {
            console.error('[SessionRouter] 加载持久化文件失败，已重置:', e.message);
            this.sessionMap.clear();
        }
    }

    /**
     * 将当前 sessionMap 同步写入磁盘。
     */
    _saveToDisk() {
        if (!this.persistPath) return;
        try {
            const obj = {};
            for (const [key, entry] of this.sessionMap.entries()) {
                obj[key] = entry;
            }
            fs.writeFileSync(this.persistPath, JSON.stringify(obj, null, 2), 'utf8');
        } catch (e) {
            console.error('[SessionRouter] 写入持久化文件失败:', e.message);
        }
    }

    /**
     * 节流写盘：3 秒内合并多次写请求，避免高频 I/O
     */
    _scheduleSave() {
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(() => {
            this._saveToDisk();
            this.saveTimer = null;
        }, 3000);
    }

    // -------------------------------------------------------------------------
    // 内部工具
    // -------------------------------------------------------------------------

    /**
     * 将 sessionKey 通过 FNV-1a 32-bit 哈希映射到 [0, length) 的整数索引。
     */
    _hashToIndex(key, length) {
        let hash = 2166136261;
        for (let i = 0; i < key.length; i++) {
            hash ^= key.charCodeAt(i);
            hash = (hash * 16777619) >>> 0;
        }
        return hash % length;
    }

    /**
     * 返回当前所有已绑定账号的 ID 集合（用于空闲账号筛选）
     * @returns {Set<string>}
     */
    _getBoundAccountIds() {
        const ids = new Set();
        for (const entry of this.sessionMap.values()) {
            ids.add(entry.accountId);
        }
        return ids;
    }

    /**
     * 启动 GC 定时器（幂等）
     */
    _ensureGC() {
        if (this.gcTimer) return;
        this.gcTimer = setInterval(() => this._runGC(), GC_INTERVAL_MS);
        if (this.gcTimer.unref) this.gcTimer.unref();
    }

    /**
     * 清理超过 TTL 的过期会话条目，并触发写盘
     */
    _runGC() {
        const now = Date.now();
        let removed = 0;
        for (const [key, entry] of this.sessionMap.entries()) {
            if (now - entry.lastActive > SESSION_TTL_MS) {
                this.sessionMap.delete(key);
                removed++;
            }
        }
        if (removed > 0) {
            console.log(`[SessionRouter] GC: 清理 ${removed} 个过期会话，剩余 ${this.sessionMap.size} 个活跃会话`);
            this._saveToDisk();
        }
    }
}

// 导出单例
module.exports = new SessionRouter();
