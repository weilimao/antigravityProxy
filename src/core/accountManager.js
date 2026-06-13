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
        this.currentIndex = 0;
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
                this.accounts = parsed.accounts || [];
                this.poolMode = parsed.poolMode || false;
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
                poolMode: this.poolMode
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
        // Remove existing account with same email if exists
        this.accounts = this.accounts.filter(a => a.email !== accountInfo.email);

        this.accounts.push({
            id: Date.now().toString(),
            email: accountInfo.email,
            access_token: accountInfo.access_token,
            refresh_token: accountInfo.refresh_token || null,
            provider: accountInfo.provider || 'unknown',
            addedAt: new Date().toISOString()
        });

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
            addedAt: a.addedAt
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

    setPoolMode(enabled) {
        this.poolMode = enabled;
        this.saveAccounts();
    }

    getPoolMode() {
        return this.poolMode;
    }

    getNextToken() {
        if (!this.poolMode || this.accounts.length === 0) {
            return null;
        }

        const account = this.accounts[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.accounts.length;
        
        return account.access_token;
    }
}

// Export singleton instance
module.exports = new AccountManager();
