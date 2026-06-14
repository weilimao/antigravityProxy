const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class AccountManager extends EventEmitter {
    constructor() {
        super();
        this.userDataPath = '';
        this.accountsFilePath = '';
        this.accounts = []; // Array of { id, email, access_token, addedAt }
        this.poolMode = false;
        this.projectPoolMode = false;
        this.activeChannel = 'antigravity';
        this.currentIndex = 0;
    }

    _generateAccountId() {
        return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    init(userDataPath) {
        this.userDataPath = userDataPath;
        this.accountsFilePath = path.join(this.userDataPath, 'accounts.json');
        this.loadAccounts();
    }

    updatePath(newPath) {
        this.userDataPath = newPath;
        this.accountsFilePath = path.join(newPath, 'accounts.json');
        this.loadAccounts();
    }

    loadAccounts() {
        try {
            if (fs.existsSync(this.accountsFilePath)) {
                const data = fs.readFileSync(this.accountsFilePath, 'utf8');
                const parsed = JSON.parse(data);
                this.accounts = (parsed.accounts || []).map((account) => {
                    const provider = account.provider || (account.projectId ? 'project' : 'antigravity');
                    return {
                        ...account,
                        id: account.id || this._generateAccountId(),
                        provider: provider,
                        projectId: account.projectId || account.project_id || null,
                        projectLabel: account.projectLabel || account.project_label || '',
                        scopeType: provider === 'antigravity' ? 'account' : 'project',
                        enabled: typeof account.enabled === 'boolean' ? account.enabled : true
                    };
                });
                this.poolMode = parsed.poolMode || false;
                this.projectPoolMode = parsed.projectPoolMode || false;
                this.activeChannel = parsed.activeChannel || 'antigravity';
                if (this.accounts.some(a => a.cooldownUntil)) {
                    this.startCooldownMonitor();
                }
            }
        } catch (err) {
            console.error('[AccountManager] Failed to load accounts:', err);
            this.accounts = [];
            this.poolMode = false;
        }
    }

    saveAccounts(silent = false) {
        try {
            const data = {
                accounts: this.accounts,
                poolMode: this.poolMode,
                projectPoolMode: this.projectPoolMode,
                activeChannel: this.activeChannel
            };
            fs.writeFileSync(this.accountsFilePath, JSON.stringify(data, null, 2), 'utf8');
            if (!silent) {
                this.emit('accounts-updated', this.accounts);
            }
        } catch (err) {
            console.error('[AccountManager] Failed to save accounts:', err);
        }
    }

    addAccount(accountInfo) {
        const normalizedEmail = accountInfo.email || 'Unknown Account';
        const normalizedProvider = accountInfo.provider || 'unknown';
        const normalizedProjectId = accountInfo.projectId || accountInfo.project_id || null;

        // Same email can own multiple projects. Only replace the exact same identity.
        this.accounts = this.accounts.filter((account) => {
            const accountProjectId = account.projectId || account.project_id || null;
            return !(
                account.email === normalizedEmail &&
                (account.provider || 'unknown') === normalizedProvider &&
                accountProjectId === normalizedProjectId
            );
        });

        const newId = this._generateAccountId();
        const isEnabled = typeof accountInfo.enabled === 'boolean' ? accountInfo.enabled : true;

        const newAccount = {
            id: newId,
            email: normalizedEmail,
            access_token: accountInfo.access_token,
            refresh_token: accountInfo.refresh_token || null,
            provider: normalizedProvider,
            projectId: normalizedProjectId,
            projectLabel: accountInfo.projectLabel || accountInfo.project_label || '',
            scopeType: accountInfo.scopeType || (normalizedProjectId ? 'project' : 'account'),
            addedAt: new Date().toISOString(),
            tier: accountInfo.tier || 'Standard',
            enabled: isEnabled
        };

        this.accounts.push(newAccount);

        if (isEnabled) {
            const isAntigravity = normalizedProvider === 'antigravity';
            if (isAntigravity) {
                this.accounts.forEach(a => {
                    if (a.provider === 'antigravity' && a.id !== newId && a.enabled !== false) {
                        a.enabled = false;
                    }
                });
            } else {
                if (!this.projectPoolMode) {
                    this.accounts.forEach(a => {
                        if (a.provider !== 'antigravity' && a.id !== newId && a.enabled !== false) {
                            a.enabled = false;
                        }
                    });
                }
            }
        }

        this.saveAccounts();
    }

    removeAccount(id) {
        this.accounts = this.accounts.filter(a => a.id !== id);
        if (this.currentIndex >= this.accounts.length) {
            this.currentIndex = 0;
        }
        this.saveAccounts();
    }

    getAccounts() {
        // 不暴露 token，仅返回展示所需字段
        return this.accounts.map(a => ({
            id: a.id,
            email: a.email,
            provider: a.provider || 'gemini-cli',
            projectId: a.projectId || a.project_id || null,
            projectLabel: a.projectLabel || '',
            scopeType: a.scopeType || ((a.projectId || a.project_id) ? 'project' : 'account'),
            addedAt: a.addedAt,
            cooldowns: a.cooldowns || {},
            cooldownUntil: a.cooldownUntil || null,
            tier: a.tier || 'Standard',
            enabled: a.enabled !== false
        }));
    }

    /** 内部使用：按 id 获取完整账号（含 token） */
    getAccountById(id) {
        return this.accounts.find(a => a.id === id) || null;
    }

    /** 更新账号的 access_token（token 刷新后调用） */
    updateAccessToken(id, newToken) {
        const acc = this.accounts.find(a => a.id === id);
        if (acc) {
            acc.access_token = newToken;
            this.saveAccounts(true);
        }
    }

    /** 更新账号的启用/停用状态 */
    updateAccountEnabled(id, enabled) {
        const acc = this.accounts.find(a => a.id === id);
        if (acc && acc.enabled !== enabled) {
            acc.enabled = enabled;

            // 限制：
            // 1. 对于官方账号 (provider === 'antigravity')，在未开启 poolMode 时，只能启用一个
            // 2. 对于项目账号 (provider !== 'antigravity')，在未开启 projectPoolMode 时，只能启用一个
            if (enabled) {
                const isAntigravity = acc.provider === 'antigravity';
                if (isAntigravity) {
                    if (!this.poolMode) {
                        this.accounts.forEach(a => {
                            if (a.provider === 'antigravity' && a.id !== id && a.enabled !== false) {
                                a.enabled = false;
                            }
                        });
                    }
                } else {
                    if (!this.projectPoolMode) {
                        this.accounts.forEach(a => {
                            if (a.provider !== 'antigravity' && a.id !== id && a.enabled !== false) {
                                a.enabled = false;
                            }
                        });
                    }
                }
            }

            this.saveAccounts(true);
            this.emit('accounts-updated', this.accounts);
            
            // 如果有任何被禁用的账号，通知粘性路由器作废该账号的所有会话映射
            this.accounts.forEach(a => {
                if (a.enabled === false) {
                    try {
                        const sessionRouter = require('./sessionRouter');
                        const invalidated = sessionRouter.invalidateByAccountId(a.id);
                        if (invalidated > 0 && global.addLogToBuffer) {
                            global.addLogToBuffer(`🔄 [粘性路由] 账号 ${a.email} 已停用，已重置 ${invalidated} 个关联会话`);
                        }
                    } catch (e) {}
                }
            });
        }
    }

    /** 更新账号的订阅级别/标签 */
    updateAccountTier(id, tier) {
        const acc = this.accounts.find(a => a.id === id);
        if (acc && acc.tier !== tier) {
            acc.tier = tier;
            this.saveAccounts(true);
            this.emit('accounts-updated', this.accounts);
        }
    }

    setPoolMode(enabled) {
        this.poolMode = enabled;
        if (enabled) {
            this.projectPoolMode = false;
            this.activeChannel = 'antigravity';
        }
        this.saveAccounts();
    }

    getPoolMode() {
        return this.poolMode;
    }

    setProjectPoolMode(enabled) {
        this.projectPoolMode = enabled;
        if (enabled) {
            this.poolMode = false;
            this.activeChannel = 'project';
        }
        this.saveAccounts();
    }

    getProjectPoolMode() {
        return this.projectPoolMode;
    }

    setActiveChannel(channel) {
        if (channel === 'antigravity' || channel === 'project') {
            if (channel === 'project' && this.poolMode) {
                // 如果官方负载均衡开启，拒绝将实际路由通道切换为 project
                return;
            }
            if (channel === 'antigravity' && this.projectPoolMode) {
                // 如果项目负载均衡开启，拒绝将实际路由通道切换为 antigravity
                return;
            }
            this.activeChannel = channel;
            this.saveAccounts();
        }
    }

    getActiveChannel() {
        return this.activeChannel || 'antigravity';
    }

    getModelCategory(modelName) {
        const name = (modelName || '').toLowerCase();
        if (name.includes('claude')) {
            return 'claude';
        }
        return 'gemini'; // 默认归为 gemini 大类
    }

    getNextAccount(modelName) {
        if (this.accounts.length === 0) return null;
        const currentChannel = this.activeChannel || 'antigravity';
        // 官方账号永远不进行负载均衡，项目账号根据 projectPoolMode 决定
        const isPool = currentChannel === 'project' ? this.projectPoolMode : this.poolMode;
        
        // 如果没有开启负载均衡，直接返回当前通道的第一个启用且不在冷静期的账号
        const activeAccounts = this.accounts.filter(a => {
            const accountChannel = a.provider === 'antigravity' ? 'antigravity' : 'project';
            return accountChannel === currentChannel && a.enabled !== false;
        });

        if (activeAccounts.length === 0) {
            return null;
        }

        if (!isPool) {
            // 单账号模式下，直接返回第一个可用（且不在冷静期）的账号
            const category = this.getModelCategory(modelName);
            const now = Date.now();
            const account = activeAccounts[0];
            const cooldownUntil = account.cooldowns ? (account.cooldowns[category] || null) : account.cooldownUntil;
            if (!cooldownUntil || now >= cooldownUntil) {
                return account;
            }
            return null;
        }

        const category = this.getModelCategory(modelName);
        const now = Date.now();
        let attempts = 0;
        while (attempts < activeAccounts.length) {
            this.currentIndex = this.currentIndex % activeAccounts.length;
            const account = activeAccounts[this.currentIndex];
            this.currentIndex = (this.currentIndex + 1) % activeAccounts.length;

            const cooldownUntil = account.cooldowns
                ? (account.cooldowns[category] || null)
                : account.cooldownUntil;

            if (!cooldownUntil || now >= cooldownUntil) {
                let updated = false;
                if (account.cooldowns && account.cooldowns[category]) {
                    delete account.cooldowns[category];
                    updated = true;
                }
                if (account.cooldownUntil && now >= account.cooldownUntil) {
                    account.cooldownUntil = null;
                    updated = true;
                }
                if (updated) {
                    this.saveAccounts(true);
                }
                return account;
            }
            attempts++;
        }
        return null;
    }

    getNextToken(modelName) {
        const acc = this.getNextAccount(modelName);
        return acc ? acc.access_token : null;
    }

    setAccountCooldown(id, untilTimeMs, modelName) {
        const acc = this.accounts.find(a => a.id === id);
        if (acc) {
            const category = this.getModelCategory(modelName);
            if (!acc.cooldowns) {
                acc.cooldowns = {};
            }
            acc.cooldowns[category] = untilTimeMs;

            // 整体 cooldownUntil 取所有模型 cooldowns 的最大值
            const maxCooldown = Math.max(...Object.values(acc.cooldowns).filter(v => v));
            acc.cooldownUntil = maxCooldown > 0 ? maxCooldown : null;

            this.saveAccounts(true);
            this.emit('accounts-updated', this.accounts);
            this.startCooldownMonitor();
            // 通知粘性路由器作废该账号的所有会话映射，触发下次请求重新分配
            try {
                const sessionRouter = require('./sessionRouter');
                const invalidated = sessionRouter.invalidateByAccountId(id);
                if (invalidated > 0 && global.addLogToBuffer) {
                    global.addLogToBuffer(`🔄 [粘性路由] 账号 ${acc.email} 模型 ${category} 进入冷静期，已重置 ${invalidated} 个关联会话`);
                }
            } catch (e) {}
        }
    }

    /**
     * 返回当前未处于指定模型类别冷静期的可用账号列表（供 SessionRouter 使用）
     * @param {string} modelName
     * @returns {Array}
     */
    getAvailableAccounts(modelName) {
        if (this.accounts.length === 0) return [];
        const now = Date.now();
        const category = this.getModelCategory(modelName);
        const currentChannel = this.activeChannel || 'antigravity';
        
        return this.accounts.filter(a => {
            const accountChannel = a.provider === 'antigravity' ? 'antigravity' : 'project';
            if (accountChannel !== currentChannel) return false;
            if (a.enabled === false) return false;
            
            const cooldownUntil = a.cooldowns
                ? (a.cooldowns[category] || null)
                : a.cooldownUntil;
            return !cooldownUntil || now >= cooldownUntil;
        });
    }

    /**
     * 粘性会话路由入口：根据 sessionKey 将请求锁定到同一账号。
     * 若 poolMode 关闭或无 sessionKey，自动回退到轮询 getNextAccount()。
     *
     * @param {string|null} sessionKey - 由 sessionRouter.extractSessionKey() 生成
     * @param {string} modelName - 模型名称
     * @param {Function} [logFn] - 可选日志回调
     * @returns {object|null} 账号对象（含 access_token）
     */
    getAccountBySticky(sessionKey, modelName, logFn) {
        // 兼容原有的签名 (sessionKey, logFn)
        if (typeof modelName === 'function') {
            logFn = modelName;
            modelName = null;
        }

        const currentChannel = this.activeChannel || 'antigravity';
        const isPool = currentChannel === 'project' ? this.projectPoolMode : this.poolMode;

        if (!isPool || !sessionKey) {
            return this.getNextAccount(modelName);
        }

        const available = this.getAvailableAccounts(modelName);
        if (available.length === 0) return null;
        // 单账号时直接返回，无需路由计算
        if (available.length === 1) return available[0];
        const sessionRouter = require('./sessionRouter');
        return sessionRouter.getOrAssignAccount(sessionKey, available, logFn);
    }

    updateAccountCooldownFromQuota(id, buckets) {
        const acc = this.accounts.find(a => a.id === id);
        if (acc && buckets) {
            if (!acc.cooldowns) {
                acc.cooldowns = {};
            }

            let geminiExhausted = false;
            let claudeExhausted = false;
            let geminiResetTime = null;
            let claudeResetTime = null;

            for (const bucket of buckets) {
                const isClaude = (bucket.group && bucket.group.toLowerCase().includes('claude')) || 
                                 (bucket.modelId && bucket.modelId.toLowerCase().includes('claude'));
                const category = isClaude ? 'claude' : 'gemini';
                
                const isExhausted = bucket.remainingFraction === 0 || bucket.remainPercent === 0;

                if (isExhausted) {
                    if (category === 'claude') {
                        claudeExhausted = true;
                        if (bucket.resetTime) {
                            const t = new Date(bucket.resetTime).getTime();
                            if (!claudeResetTime || t > claudeResetTime) claudeResetTime = t;
                        }
                    } else {
                        geminiExhausted = true;
                        if (bucket.resetTime) {
                            const t = new Date(bucket.resetTime).getTime();
                            if (!geminiResetTime || t > geminiResetTime) geminiResetTime = t;
                        }
                    }
                }
            }

            let changed = false;

            if (geminiExhausted) {
                const newTime = geminiResetTime || (Date.now() + 10 * 60 * 1000);
                if (acc.cooldowns['gemini'] !== newTime) {
                    acc.cooldowns['gemini'] = newTime;
                    changed = true;
                }
            } else {
                if (acc.cooldowns['gemini'] !== undefined) {
                    delete acc.cooldowns['gemini'];
                    changed = true;
                }
            }

            if (claudeExhausted) {
                const newTime = claudeResetTime || (Date.now() + 10 * 60 * 1000);
                if (acc.cooldowns['claude'] !== newTime) {
                    acc.cooldowns['claude'] = newTime;
                    changed = true;
                }
            } else {
                if (acc.cooldowns['claude'] !== undefined) {
                    delete acc.cooldowns['claude'];
                    changed = true;
                }
            }

            const maxCooldown = Math.max(...Object.values(acc.cooldowns).filter(v => v));
            const newCooldownUntil = maxCooldown > 0 ? maxCooldown : null;
            if (acc.cooldownUntil !== newCooldownUntil) {
                acc.cooldownUntil = newCooldownUntil;
                changed = true;
            }

            if (changed) {
                this.saveAccounts(true);
                this.emit('accounts-updated', this.accounts);
                
                if (global.addLogToBuffer) {
                    if (!geminiExhausted && !claudeExhausted) {
                        global.addLogToBuffer(`✅ [负载均衡] 账号额度已恢复，重新加入分配池: ${acc.email}`);
                    } else {
                        global.addLogToBuffer(`⏳ [负载均衡] 账号 ${acc.email} 部分额度依然空置: Gemini(${geminiExhausted ? '已耗尽' : '正常'}) | Claude(${claudeExhausted ? '已耗尽' : '正常'})`);
                    }
                }
            }
            return changed;
        }
        return false;
    }

    startCooldownMonitor() {
        if (this.cooldownInterval) return;

        this.cooldownInterval = setInterval(async () => {
            const now = Date.now();
            const cooldownAccounts = this.accounts.filter(a => a.cooldownUntil);

            if (cooldownAccounts.length === 0) {
                clearInterval(this.cooldownInterval);
                this.cooldownInterval = null;
                return;
            }

            const quotaService = require('./quotaService');
            
            for (const acc of cooldownAccounts) {
                if (now >= acc.cooldownUntil) {
                    try {
                        if (global.addLogToBuffer) {
                            global.addLogToBuffer(`⏳ [负载均衡] 正在验证账号配额状态: ${acc.email} ...`);
                        }
                        const res = await quotaService.fetchQuota(acc, this);
                        
                        if (res && res.buckets) {
                            this.updateAccountCooldownFromQuota(acc.id, res.buckets);
                        }
                        if (res && res.tier) {
                            this.updateAccountTier(acc.id, res.tier);
                        } else {
                            acc.cooldownUntil = now + 5 * 60 * 1000;
                            if (acc.cooldowns) {
                                Object.keys(acc.cooldowns).forEach(k => {
                                    acc.cooldowns[k] = now + 5 * 60 * 1000;
                                });
                            }
                            this.saveAccounts(true);
                        }
                    } catch (err) {
                        acc.cooldownUntil = now + 5 * 60 * 1000;
                        if (acc.cooldowns) {
                            Object.keys(acc.cooldowns).forEach(k => {
                                acc.cooldowns[k] = now + 5 * 60 * 1000;
                            });
                        }
                        this.saveAccounts(true);
                    }
                }
            }
            this.emit('accounts-updated', this.accounts);
        }, 120000); // 2 分钟轮询一次
    }
}

// Export singleton instance
module.exports = new AccountManager();
