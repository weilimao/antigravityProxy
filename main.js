const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const originalFs = require('original-fs');
const { exec, execSync, spawn } = require('child_process');
const asar = require('asar');

// Request single instance lock to prevent double launch
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
    process.exit(0);
}

// Setup physical log file in workspace
const logFilePath = path.join(__dirname, 'proxy.log');
try {
    fs.writeFileSync(logFilePath, `--- Proxy Log Started at ${new Date().toISOString()} ---\n`, 'utf8');
} catch (e) {}

function writeToFileLog(msg) {
    try {
        fs.appendFileSync(logFilePath, msg + '\n', 'utf8');
    } catch (e) {}
}

// Suppress noisy connection reset and abort logs from http-mitm-proxy in terminal, but record them in file
const originalConsoleDebug = console.debug;
console.debug = function (...args) {
    const msg = `[DEBUG] ${args.join(' ')}`;
    writeToFileLog(msg);
    if (args[0] && typeof args[0] === 'string' && args[0].includes('Got ECONNRESET')) {
        return;
    }
    originalConsoleDebug.apply(console, args);
};

const originalConsoleError = console.error;
console.error = function (...args) {
    const msg = `[ERROR] ${args.map(arg => arg instanceof Error ? arg.stack : String(arg)).join(' ')}`;
    writeToFileLog(msg);
    if (args[0]) {
        if (typeof args[0] === 'string') {
            const lower = args[0].toLowerCase();
            if (lower.includes('client_to_proxy_request_error') ||
                lower.includes('socket_error') ||
                lower.includes('proxy_to_client_response_error') ||
                lower.includes('econnreset') ||
                lower.includes('aborted')
            ) {
                return;
            }
        } else if (args[0] instanceof Error) {
            if (args[0].code === 'ECONNRESET' || args[0].message === 'aborted') {
                return;
            }
        }
    }
    originalConsoleError.apply(console, args);
};

const settings = require('./src/core/settings');
const patchManager = require('./src/core/patchManager');

// Hot patch http-mitm-proxy dependency for Windows compatibility before loading ProxyEngine
patchManager.hotPatchMitmProxy(__dirname);
const ProxyEngine = require('./engine');
const accountManager = require('./src/core/accountManager');
const geminiCliAuth = require('./src/core/geminiCliAuth');
const antigravityAuth = require('./src/core/antigravityAuth');
const quotaService = require('./src/core/quotaService');

// Helper to kill Agent process
function killAgentProcess(sync = false) {
    if (sync) {
        if (process.platform === 'win32') {
            try { execSync('taskkill /F /IM Antigravity.exe', { stdio: 'ignore' }); } catch (e) {}
        } else if (process.platform === 'darwin') {
            try { execSync('pkill -f Antigravity', { stdio: 'ignore' }); } catch (e) {}
        }
        // Sync sleep
        const seconds = 1.5;
        if (process.platform === 'win32') {
            try { execSync(`powershell -Command Start-Sleep -s ${seconds}`, { stdio: 'ignore' }); } catch (e) {
                const end = Date.now() + 1500;
                while (Date.now() < end) {}
            }
        } else {
            try { execSync(`sleep ${seconds}`, { stdio: 'ignore' }); } catch (e) {
                const end = Date.now() + 1500;
                while (Date.now() < end) {}
            }
        }
    } else {
        return new Promise((resolve) => {
            if (process.platform === 'win32') {
                try { execSync('taskkill /F /IM Antigravity.exe', { stdio: 'ignore' }); } catch (e) {}
            } else if (process.platform === 'darwin') {
                try { execSync('pkill -f Antigravity', { stdio: 'ignore' }); } catch (e) {}
            }
            setTimeout(resolve, 1500);
        });
    }
}

// Helper to start Agent process
function startAgentProcess() {
    const homeDir = app.getPath('home');
    if (process.platform === 'win32') {
        const agentExe = path.join(homeDir, 'AppData', 'Local', 'Programs', 'antigravity', 'Antigravity.exe');
        if (fs.existsSync(agentExe)) {
            try {
                spawn(agentExe, [], {
                    detached: true,
                    stdio: 'ignore'
                }).unref();
            } catch (e) {
                console.error('Failed to spawn Agent:', e);
            }
        }
    } else if (process.platform === 'darwin') {
        const agentApp = '/Applications/Antigravity.app';
        if (fs.existsSync(agentApp)) {
            try {
                spawn('open', [agentApp], {
                    detached: true,
                    stdio: 'ignore'
                }).unref();
            } catch (e) {
                console.error('Failed to spawn Agent:', e);
            }
        }
    }
}

// Async patcher for startup
// Patching utilities are delegated to patchManager

let mainWindow;
let tray;
let updateManager;
const engine = new ProxyEngine();
let isQuitting = false;
const logBuffer = [];

// Handle second instance activation
app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
});

function checkCertStatus(callback) {
    if (process.platform === 'win32') {
        exec('certutil -user -store ROOT NodeMITMProxyCA', (err, stdout) => {
            if (!err && stdout && stdout.includes('NodeMITMProxyCA')) {
                callback(true);
            } else {
                callback(false);
            }
        });
    } else if (process.platform === 'darwin') {
        exec('security find-certificate -c "NodeMITMProxyCA"', (err) => {
            callback(!err);
        });
    } else {
        callback(false);
    }
}

function installCert(callback) {
    const caCertPath = path.join(settings.getActiveDataDirectory(), 'certs', 'certs', 'ca.pem');
    if (!fs.existsSync(caCertPath)) {
        callback(false, 'Certificate file ca.pem not found. Please start proxy first.');
        return;
    }

    if (process.platform === 'win32') {
        exec(`certutil -user -addstore -f ROOT "${caCertPath}"`, (err, stdout, stderr) => {
            if (err) {
                callback(false, err.message);
            } else {
                checkCertStatus(callback);
            }
        });
    } else {
        callback(false, 'Only Windows is supported for automatic installation.');
    }
}

function uninstallCert(callback) {
    if (process.platform === 'win32') {
        exec('certutil -user -delstore ROOT NodeMITMProxyCA', (err, stdout, stderr) => {
            if (err) {
                callback(false, err.message);
            } else {
                checkCertStatus(callback);
            }
        });
    } else {
        callback(false, 'Only Windows is supported for automatic uninstallation.');
    }
}

function addLogToBuffer(msg) {
    if (settings && typeof settings.getEnableSystemLog === 'function') {
        if (!settings.getEnableSystemLog()) {
            return;
        }
    }
    const timestamp = new Date().toISOString().split('T')[1].replace('Z', '');
    const formatted = `[${timestamp}] ${msg}`;
    logBuffer.push(formatted);
    if (logBuffer.length > 50) logBuffer.shift();
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('log', formatted);
    }
    writeToFileLog(formatted);
}
global.addLogToBuffer = addLogToBuffer;

// Base64 16x16 tray icon fallback
const iconBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAChUlEQVR4nCWSzU5TYRCGZ+b7zteetqeUChR/UBTFlCBBMQFNCJoYf8IFuPEKXHoDrrwF9R40MWLEROPOhcEIBtSFCYoYDYoU2sI5p9/fmIOzmNWbyfNmHhRBNyES4v4iIokoAIgRmL1n59kxO/Ce90f+TxMKIqlESCgB0YLj7IT0iM6lxiWADp0FBkmQpSWpoixLyhm0HuhAcACAdvwWEuaCro7ZSXUTGZitzDBQRKIcUlmjJpAD1bFbE7crBh8uP/i0t4yCC0G/B286bWSfwUsMItnFyEooJaL6+JXo+MHecu/FwzMqKKNEF2Ah35sVRCIGyFEeUTIBgSwfPK4ujy7trS02vg7VRvoLR5kCBxpz+/UACQAQhAFgBOu5ND2xPVL+1Zc0RKoKlbGec94BMlvyiMTMlBVhZ7zuuNR2R2JqNO0R1fHhE9Vh6bheqkc29EY7r5k9gJcMbDjxECVJu/viDXH+9N+n73+/fLvaVBPh1IUjI+PR6MvN+QICW539gYE168QlIihUBZz4+CXaNH2nJlsV6iTxVrgmNzDYVqa9w2wzcJXvARCVSq0+fCZ/qCaM+bmwVioOxBH8gZ9Tx04iqO+t9W9Li61Wg8FirlCznJ+cvn73zs3nH1cXRa4vpf4tEyYUNgOxrXlw7+zs0P17j9+8e+VFLJkZ0cVtfjS3srL8ev3H6uDsjUvXruYhmH/24smHucHGcKs9Y9sC0AMDSlUFpEKxMjQ0aWRklbHxbpcIFSM3O0VRQgpSbHxeX9iNmwweRVDJRCUplRLFKlZrYVCMDOU1UAymo5t+o202tNaeHbCXAI6ZPFtrwOtdjJXD2HR8PgVlJXiX+rZ1NjM8U93/AxRkSoiTkQsIAAAAAElFTkSuQmCC';

// Function to update global config for IDE and Agent
async function updateSettings(enable) {
    const appData = app.getPath('appData');
    if (!appData) return;

    const idePath = path.join(appData, 'Antigravity IDE', 'User', 'settings.json');

    // Agent settings location could be in .antigravity in user home or roaming appdata
    const homeDir = app.getPath('home');
    const agentPaths = [
        path.join(appData, 'Antigravity', 'User', 'settings.json'),
        path.join(appData, 'Antigravity-Agent', 'User', 'settings.json'),
        path.join(homeDir, '.antigravity', 'settings.json'),
        path.join(homeDir, '.antigravity-agent', 'settings.json'),
        path.join(homeDir, '.gemini', 'antigravity-cli', 'settings.json'),
        path.join(homeDir, '.gemini', 'settings.json')
    ];

    const updateFile = (filePath) => {
        try {
            if (!fs.existsSync(filePath)) return false;
            let data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (enable) {
                data['jetski.cloudCodeUrl'] = 'http://127.0.0.1:18443';
            } else {
                delete data['jetski.cloudCodeUrl'];
            }
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
            return true;
        } catch (e) {
            console.error(`Failed to update ${filePath}:`, e);
            return false;
        }
    };

    updateFile(idePath);
    for (const p of agentPaths) {
        if (updateFile(p)) break; // Update the first one that exists
    }
}

// Function to inject/restore HTTP_PROXY in agentapi.bat for CLI interception
// CLI's language_server.exe is spawned via agentapi.bat — we patch the bat to
// inject HTTP_PROXY so the Go binary routes all traffic through our local proxy.
// Script patching utilities are delegated to patchManager

function createWindow() {
    const isSilent = process.argv.includes('--silent');
    mainWindow = new BrowserWindow({
        width: 850,
        height: 700,
        show: !isSilent,
        icon: path.join(__dirname, 'src', 'ui', 'icon.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        autoHideMenuBar: true,
        title: "Antigravity Proxy Desktop"
    });

    mainWindow.loadFile('index.html');
    // mainWindow.webContents.openDevTools(); // 已禁用：不默认打开开发工具

    // 定期更新应用内存占用和活跃进程数并发送给渲染进程
    let memoryTimer = setInterval(() => {
        if (!mainWindow || mainWindow.isDestroyed()) {
            clearInterval(memoryTimer);
            return;
        }
        try {
            const metrics = app.getAppMetrics();
            const totalMemoryKB = metrics.reduce((sum, m) => sum + (m.memory.workingSetSize || 0), 0);
            mainWindow.webContents.send('memory-stats-updated', {
                total: totalMemoryKB * 1024,
                processCount: metrics.length
            });
        } catch (e) {
            console.error('Failed to send memory stats:', e);
        }
    }, 2000);

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
}

function updateLoginItemSettings() {
    try {
        const autoStart = settings.getAutoStart();
        const silentStart = settings.getSilentStart();
        app.setLoginItemSettings({
            openAtLogin: autoStart,
            path: process.execPath,
            args: silentStart ? ['--silent'] : []
        });
        console.log(`[AutoStart] Updated login item settings. openAtLogin: ${autoStart}, args: ${silentStart ? '--silent' : 'none'}`);
    } catch (e) {
        console.error('[AutoStart] Failed to update login item settings:', e);
    }
}

app.whenReady().then(async () => {
    // 初始化设置管理器
    settings.init(app.getPath('userData'));

    // 同步自启动设置到操作系统
    updateLoginItemSettings();

    // 显式更新数据统计模块的路径，纠正 ProxyEngine 实例化时的时序差
    const statsTracker = require('./src/core/stats');
    statsTracker.updatePath(settings.getActiveDataDirectory());

    // 初始化计费配置的活跃路径
    const pricing = require('./src/core/pricing');
    pricing.init(settings.getActiveDataDirectory());

    createWindow();

    // 优先从打包进 ASAR 的本地资源文件中加载系统托盘图标，若不存在则使用 base64 作为后备
    const trayIconPath = path.join(__dirname, 'src', 'ui', 'tray-icon.png');
    let trayIcon;
    try {
        if (fs.existsSync(trayIconPath)) {
            trayIcon = nativeImage.createFromPath(trayIconPath);
        } else {
            trayIcon = nativeImage.createFromDataURL(iconBase64);
        }
    } catch (e) {
        console.error('Failed to load tray icon from path, fallback to base64:', e);
        trayIcon = nativeImage.createFromDataURL(iconBase64);
    }
    tray = new Tray(trayIcon);
    tray.on('click', () => mainWindow.show());
    setupTrayMenu(app.getLocale());

    // Hook up engine events to IPC
    engine.on('log', (msg) => {
        addLogToBuffer(msg);
    });

    engine.on('state', (isRunning) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('state', isRunning);
        }
    });

    engine.on('stats', (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('stats-updated', payload);
        }
    });

    addLogToBuffer('🖥️ Antigravity Proxy UI Started');

    // 初始化账号管理器
    accountManager.init(settings.getActiveDataDirectory());
    // 初始化粘性会话路由器（加载持久化绑定关系）
    const sessionRouter = require('./src/core/sessionRouter');
    sessionRouter.init(settings.getActiveDataDirectory());

    // 监听账号管理器更新，通知 UI
    accountManager.on('accounts-updated', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('accounts-res', {
                accounts: accountManager.getAccounts(),
                poolMode: accountManager.getPoolMode()
            });
        }
    });

    // 核心改造：启动代理服务，从配置加载上次记住的拦截模式
    const savedInterceptMode = settings.getIsInterceptMode();
    engine.start();
    engine.setMode(savedInterceptMode);

    // 将系统的云端端点强行指向本地 (App 生命周期内有效)
    await updateSettings(true);
    // 改写 agentapi.bat 注入 HTTP_PROXY，让 CLI 的 language_server 也走本地代理
    const batPatched = patchManager.updateAgentapiBat(true, app.getPath('appData'), app.getPath('home'), path.join(settings.getActiveDataDirectory(), 'certs', 'certs', 'ca.pem'));
    // 动态原地注入用户本地 app.asar 代理环境变量
    await patchManager.patchAgentAsar(
        true,
        app.getPath('home'),
        path.join(app.getPath('temp'), 'antigravity-agent-asar-temp'),
        path.join(settings.getActiveDataDirectory(), 'certs', 'certs', 'ca.pem'),
        addLogToBuffer
    );

    // 初始化自动更新管理器
    const UpdateManager = require('./src/core/updateManager');
    updateManager = new UpdateManager({
        logger: {
            log: (msg) => addLogToBuffer(`[SYSTEM] ${msg}`),
            error: (msg, err) => addLogToBuffer(`[ERROR] ${msg} ${err ? err : ''}`)
        },
        appVersion: app.getVersion(),
        tempDir: app.getPath('temp'),
        appQuitCallback: () => {
            isQuitting = true;
            app.quit();
        }
    });

    // 绑定更新管理器事件，向渲染进程发送通知
    updateManager.on('update-available', (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('app:update-available', data);
        }
    });

    updateManager.on('update-not-available', (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('app:update-not-available', data);
        }
    });

    updateManager.on('download-progress', (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('app:download-progress', progress);
        }
    });

    updateManager.on('download-complete', (filePath) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('app:download-complete', filePath);
        }
    });

    updateManager.on('error', (err) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('app:update-error', err.message || err);
        }
    });

    addLogToBuffer(`✅ Global settings mapped. All IDE/Agent traffic is now routed through us.${batPatched ? ' CLI bat patched.' : ''}`);
    addLogToBuffer('ℹ️ CLI: HTTP_PROXY injected into agentapi.bat for language_server interception.');
    addLogToBuffer('ℹ️ Current Mode: Passthrough (Direct connection, no retries).');
});

// --- 账号池相关 IPC ---
ipcMain.handle('auth:login', async (event, provider) => {
    try {
        let res;
        if (provider === 'antigravity') {
            res = await antigravityAuth.startLogin();
        } else {
            res = await geminiCliAuth.startLogin();
        }
        return res;
    } catch (err) {
        addLogToBuffer(`❌ Login failed (${provider}): ${err.message}`);
        return { success: false, error: err.message };
    }
});

ipcMain.on('accounts:get', (event) => {
    event.reply('accounts-res', {
        accounts: accountManager.getAccounts(),
        poolMode: accountManager.getPoolMode()
    });
});

ipcMain.on('accounts:remove', (event, id) => {
    accountManager.removeAccount(id);
});

ipcMain.on('accounts:toggle-enabled', (event, id, enabled) => {
    accountManager.updateAccountEnabled(id, enabled);
    const acc = accountManager.getAccountById(id);
    if (acc) {
        addLogToBuffer(`🔄 Account ${acc.email} is now ${enabled ? 'enabled' : 'disabled'} in the pool.`);
    }
});

ipcMain.on('pool:toggle', (event, enable) => {
    accountManager.setPoolMode(enable);
    if (enable) {
        addLogToBuffer(`🔄 Account Load Balancing enabled. Distributing requests across ${accountManager.getAccounts().length} accounts.`);
    } else {
        addLogToBuffer('🔄 Account Load Balancing disabled. Using client-provided credentials.');
    }
});

// 手动清空粘性会话绑定（UI 按钮触发）
ipcMain.handle('pool:clear-sessions', () => {
    const sessionRouter = require('./src/core/sessionRouter');
    const count = sessionRouter.clearAllAndSave();
    addLogToBuffer(`🧹 [粘性路由] 手动清空所有会话绑定，共 ${count} 条。下次请求将重新均匀分配账号。`);
    return { success: true, cleared: count };
});

// 按账号 ID 查询配额
ipcMain.handle('quota:fetch', async (event, accountId) => {
    const account = accountManager.accounts.find(a => a.id === accountId);
    if (!account) return { error: 'Account not found', buckets: [] };
    try {
        // 传入完整 account（含 refresh_token）以便 quotaService 自动刷新过期 token
        const res = await quotaService.fetchQuota(account, accountManager);
        if (res && res.buckets) {
            accountManager.updateAccountCooldownFromQuota(accountId, res.buckets);
        }
        if (res && res.tier) {
            accountManager.updateAccountTier(accountId, res.tier);
        }
        return res;
    } catch (err) {
        return { error: err.message, buckets: [] };
    }
});
// ----------------------

ipcMain.on('toggle', async (event, enable) => {
    // 热切换：只需调用 Engine 的 setMode 即可瞬间生效
    engine.setMode(enable);
    settings.setIsInterceptMode(enable);
    if (enable) {
        addLogToBuffer('✅ Mode Switched: Intercept ON (Traffic buffering & retrying 503 errors)');
    } else {
        addLogToBuffer('✅ Mode Switched: Intercept OFF (Passthrough to Google directly)');
    }
});

ipcMain.on('get-state', (event) => {
    event.reply('state', engine.isInterceptMode);
    
    const statsTracker = require('./src/core/stats');
    event.reply('stats-updated', statsTracker.getPayload());
    
    // Send buffered logs to the new window
    logBuffer.forEach(log => event.reply('log', log));

    // Send certificate status when UI requests it
    checkCertStatus((isInstalled) => {
        event.reply('cert-status-res', isInstalled);
    });
});

ipcMain.on('get-userdata-path', (event) => {
    event.returnValue = app.getPath('userData');
});

ipcMain.on('settings:get-dir-sync', (event) => {
    event.returnValue = {
        activeDir: settings.getActiveDataDirectory(),
        defaultDir: app.getPath('userData')
    };
});

ipcMain.on('settings:get-system-log-enabled', (event) => {
    event.returnValue = settings.getEnableSystemLog();
});

ipcMain.on('settings:set-system-log-enabled', (event, enable) => {
    settings.setEnableSystemLog(enable);
});

ipcMain.on('settings:get-startup-options', (event) => {
    event.returnValue = {
        autoStart: settings.getAutoStart(),
        silentStart: settings.getSilentStart()
    };
});

ipcMain.on('settings:set-auto-start', (event, enable) => {
    settings.setAutoStart(enable);
    updateLoginItemSettings();
});

ipcMain.on('settings:set-silent-start', (event, enable) => {
    settings.setSilentStart(enable);
    updateLoginItemSettings();
});

ipcMain.handle('settings:change-dir', async (event) => {
    const window = BrowserWindow.getFocusedWindow();
    const result = dialog.showOpenDialogSync(window, {
        title: '选择数据存储目录',
        properties: ['openDirectory', 'createDirectory']
    });

    if (!result || result.length === 0) {
        return { success: false, error: '用户取消选择' };
    }

    const targetDir = result[0];
    
    // 如果选择的目录就是当前活动的目录，直接返回成功
    if (path.resolve(targetDir) === path.resolve(settings.getActiveDataDirectory())) {
        return { success: true, activeDir: targetDir };
    }

    try {
        event.sender.send('settings:migration-progress', { step: 'stop-proxy', status: '正在停止代理服务器...' });
        engine.stop();

        event.sender.send('settings:migration-progress', { step: 'migrate-files', status: '正在复制数据文件与证书 (请勿关闭软件)...' });
        const migrateResult = await settings.migrateData(targetDir);
        
        if (!migrateResult.success) {
            event.sender.send('settings:migration-progress', { step: 'error', status: migrateResult.error });
            engine.start(); // 恢复启动
            return migrateResult;
        }

        event.sender.send('settings:migration-progress', { step: 'update-paths', status: '正在重定向数据服务工作路径...' });
        // 重新加载数据
        accountManager.updatePath(targetDir);
        
        const statsTracker = require('./src/core/stats');
        statsTracker.updatePath(targetDir);
        
        const pricing = require('./src/core/pricing');
        pricing.updatePath(targetDir);

        const sessionRouter = require('./src/core/sessionRouter');
        sessionRouter.updatePath(targetDir);

        event.sender.send('settings:migration-progress', { step: 'patch-externals', status: '正在更新外部编辑器代理补丁...' });
        // 更新 IDE 及 CLI 设置的证书路径
        await updateSettings(true);
        patchManager.updateAgentapiBat(true, app.getPath('appData'), app.getPath('home'), path.join(settings.getActiveDataDirectory(), 'certs', 'certs', 'ca.pem'));
        await patchManager.patchAgentAsar(
            true,
            app.getPath('home'),
            path.join(app.getPath('temp'), 'antigravity-agent-asar-temp'),
            path.join(settings.getActiveDataDirectory(), 'certs', 'certs', 'ca.pem'),
            addLogToBuffer
        );

        event.sender.send('settings:migration-progress', { step: 'restart-proxy', status: '正在重新启动代理服务器...' });
        engine.start();

        event.sender.send('settings:migration-progress', { step: 'success', status: '🎉 迁移成功！数据已妥善转移并重定向。' });
        addLogToBuffer(`📁 数据存储路径已成功更改并迁移至: ${targetDir}`);
        
        return { success: true, activeDir: targetDir };
    } catch (err) {
        console.error('[ChangeDir] Migration failed:', err);
        // 恢复
        try { engine.start(); } catch (_) {}
        return { success: false, error: err.message };
    }
});

ipcMain.on('cert-status', (event) => {
    checkCertStatus((isInstalled) => {
        event.reply('cert-status-res', isInstalled);
    });
});

ipcMain.on('cert-install', (event) => {
    addLogToBuffer('⏳ Starting Root CA installation (waiting for user confirmation in Windows dialog)...');
    installCert((isInstalled, errorMsg) => {
        if (isInstalled) {
            addLogToBuffer('🔒 Local Root CA successfully trusted in Windows User store.');
        } else {
            addLogToBuffer(`❌ Failed to trust local Root CA: ${errorMsg || 'User cancelled or error occurred'}`);
        }
        event.reply('cert-status-res', isInstalled, errorMsg);
    });
});

ipcMain.on('cert-uninstall', (event) => {
    addLogToBuffer('⏳ Removing Root CA certificate...');
    uninstallCert((isInstalled, errorMsg) => {
        if (!isInstalled) {
            addLogToBuffer('🔓 Local Root CA removed from Windows User store.');
        } else {
            addLogToBuffer(`❌ Failed to remove local Root CA: ${errorMsg || 'Error occurred'}`);
        }
        event.reply('cert-status-res', isInstalled, errorMsg);
    });
});

ipcMain.on('get-pricing', (event) => {
    const { getAllPricing } = require('./src/core/pricing');
    event.reply('get-pricing-res', getAllPricing());
});

ipcMain.on('update-pricing', (event, modelKey, pricingData) => {
    const { updateModelPricing, getAllPricing } = require('./src/core/pricing');
    updateModelPricing(modelKey, pricingData);
    event.reply('get-pricing-res', getAllPricing());
    
    const statsTracker = require('./src/core/stats');
    event.reply('stats-updated', statsTracker.getPayload());
    addLogToBuffer(`💰 Model pricing updated for "${modelKey}": In: $${pricingData.input}/1M, Out: $${pricingData.output}/1M, Cache: $${pricingData.cached}/1M`);
});

ipcMain.on('delete-pricing', (event, modelKey) => {
    const { deleteModelPricing, getAllPricing } = require('./src/core/pricing');
    deleteModelPricing(modelKey);
    event.reply('get-pricing-res', getAllPricing());
    
    const statsTracker = require('./src/core/stats');
    event.reply('stats-updated', statsTracker.getPayload());
    addLogToBuffer(`🗑️ Model pricing deleted for "${modelKey}"`);
});

ipcMain.on('reset-pricing', (event) => {
    const { resetPricingToDefault, getAllPricing } = require('./src/core/pricing');
    resetPricingToDefault();
    event.reply('get-pricing-res', getAllPricing());
    
    const statsTracker = require('./src/core/stats');
    event.reply('stats-updated', statsTracker.getPayload());
    addLogToBuffer(`🔄 Model pricing reset to defaults`);
});

// --- 软件自动更新相关 IPC 渠道 ---
ipcMain.handle('app:check-for-updates', async (event, manual) => {
    if (!updateManager) return { error: 'Update manager not initialized' };
    try {
        return await updateManager.checkForUpdates(manual);
    } catch (err) {
        return { error: err.message || err };
    }
});

ipcMain.handle('app:start-download-update', async (event, assets) => {
    if (!updateManager) return { error: 'Update manager not initialized' };
    try {
        return await updateManager.startDownload(assets);
    } catch (err) {
        return { error: err.message || err };
    }
});

ipcMain.on('app:install-update', (event, filePath) => {
    if (updateManager) {
        updateManager.installUpdate(filePath);
    }
});

ipcMain.handle('app:get-version', () => {
    return app.getVersion();
});
// ---------------------------------

app.on('before-quit', () => {
    engine.stop();
    // 退出时触发最终写盘（持久化当前会话绑定，下次启动时继续复用）
    try {
        const sessionRouter = require('./src/core/sessionRouter');
        sessionRouter._saveToDisk();
    } catch (e) {}
    // Use synchronous operations during exit to ensure execution finishes before Electron quits
    try {
        const appData = app.getPath('appData');
        const homeDir = app.getPath('home');
        if (appData) {
            const idePath = path.join(appData, 'Antigravity IDE', 'User', 'settings.json');
            const agentPaths = [
                path.join(appData, 'Antigravity', 'User', 'settings.json'),
                path.join(appData, 'Antigravity-Agent', 'User', 'settings.json'),
                path.join(homeDir, '.antigravity', 'settings.json'),
                path.join(homeDir, '.antigravity-agent', 'settings.json'),
                path.join(homeDir, '.gemini', 'antigravity-cli', 'settings.json'),
                path.join(homeDir, '.gemini', 'settings.json')
            ];
            const cleanFile = (filePath) => {
                try {
                    if (fs.existsSync(filePath)) {
                        let data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        delete data['jetski.cloudCodeUrl'];
                        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
                    }
                } catch (e) {}
            };
            cleanFile(idePath);
            for (const p of agentPaths) {
                cleanFile(p);
            }
        }
    } catch (e) {
        console.error('Failed to restore settings synchronously:', e);
    }
    patchManager.updateAgentapiBat(false, app.getPath('appData'), app.getPath('home'), path.join(settings.getActiveDataDirectory(), 'certs', 'certs', 'ca.pem'));    // Restore agentapi.bat on exit
    patchManager.patchAgentAsarSync(false, app.getPath('home'));   // Restore app.asar on exit
});

function setupTrayMenu(lang) {
    const systemLocale = app.getLocale();
    const isZh = lang ? lang.startsWith('zh') : (systemLocale && systemLocale.startsWith('zh'));
    
    const showDashboardLabel = isZh ? '显示控制面板' : 'Show Dashboard';
    const quitLabel = isZh ? '退出代理引擎' : 'Quit Proxy Engine';

    const contextMenu = Menu.buildFromTemplate([
        { label: showDashboardLabel, click: () => mainWindow.show() },
        { type: 'separator' },
        { label: quitLabel, click: () => {
            isQuitting = true;
            app.quit();
        }}
    ]);

    if (tray) {
        tray.setToolTip('Antigravity Proxy');
        tray.setContextMenu(contextMenu);
    }
}

ipcMain.on('settings:language-changed', (event, lang) => {
    setupTrayMenu(lang);
});
