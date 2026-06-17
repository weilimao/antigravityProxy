const { dialog } = require('electron');
const fs = require('fs');

class AccountExporter {
    async exportAll(accounts, window) {
        try {
            const result = await dialog.showSaveDialog(window, {
                title: '导出所有账号池数据',
                defaultPath: 'antigravity_accounts_pool.json',
                filters: [{ name: 'JSON Files', extensions: ['json'] }]
            });
            if (!result.canceled && result.filePath) {
                fs.writeFileSync(result.filePath, JSON.stringify(accounts, null, 2), 'utf8');
                return true;
            }
        } catch (err) {
            console.error('[AccountExporter] Export all failed:', err);
        }
        return false;
    }

    async exportSingle(account, window) {
        try {
            const cleanEmail = account.email.replace(/[^a-zA-Z0-9]/g, '_');
            const result = await dialog.showSaveDialog(window, {
                title: `导出账号 ${account.email}`,
                defaultPath: `account_${cleanEmail}.json`,
                filters: [{ name: 'JSON Files', extensions: ['json'] }]
            });
            if (!result.canceled && result.filePath) {
                fs.writeFileSync(result.filePath, JSON.stringify(account, null, 2), 'utf8');
                return true;
            }
        } catch (err) {
            console.error('[AccountExporter] Export single failed:', err);
        }
        return false;
    }

    async importAccounts(window) {
        try {
            const result = await dialog.showOpenDialog(window, {
                title: '导入账号 JSON 文件 (支持多选)',
                properties: ['openFile', 'multiSelections'],
                filters: [{ name: 'JSON Files', extensions: ['json'] }]
            });
            if (!result.canceled && result.filePaths.length > 0) {
                let allImported = [];
                for (const filePath of result.filePaths) {
                    try {
                        const content = fs.readFileSync(filePath, 'utf8');
                        const parsed = JSON.parse(content);
                        if (Array.isArray(parsed)) {
                            allImported.push(...parsed);
                        } else if (parsed && typeof parsed === 'object') {
                            allImported.push(parsed);
                        }
                    } catch (e) {
                        console.error(`[AccountExporter] Parse file failed: ${filePath}`, e);
                        dialog.showErrorBox('解析失败', `文件 ${filePath} 解析为 JSON 格式失败:\n${e.message}`);
                    }
                }
                // Validate required fields
                const validAccounts = allImported.filter(a => a && a.email && a.access_token);
                if (validAccounts.length < allImported.length) {
                    dialog.showMessageBox(window, {
                        type: 'warning',
                        title: '导入过滤提示',
                        message: `检测到 ${allImported.length - validAccounts.length} 个账号对象因缺少邮箱或 Token 等关键信息已被忽略。`
                    });
                }
                return validAccounts;
            }
        } catch (err) {
            console.error('[AccountExporter] Import failed:', err);
        }
        return [];
    }
}

module.exports = new AccountExporter();
