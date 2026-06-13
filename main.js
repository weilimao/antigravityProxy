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

// Hot patch http-mitm-proxy dependency for Windows compatibility before loading ProxyEngine
function hotPatchMitmProxy() {
    try {
        const targetFile = path.join(__dirname, 'node_modules', 'http-mitm-proxy', 'dist', 'lib', 'proxy.js');
        if (fs.existsSync(targetFile)) {
            let content = fs.readFileSync(targetFile, 'utf8');
            if (content.includes('host: "0.0.0.0",')) {
                content = content.replace('host: "0.0.0.0",', 'host: "127.0.0.1",');
                fs.writeFileSync(targetFile, content, 'utf8');
            }
        }
    } catch (e) {
        console.error('[HotPatch] Failed to patch http-mitm-proxy:', e);
    }
}
hotPatchMitmProxy();

const ProxyEngine = require('./engine');

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
async function patchAgentAsar(enable) {
    const homeDir = app.getPath('home');
    let asarPath = '';
    
    if (process.platform === 'win32') {
        asarPath = path.join(homeDir, 'AppData', 'Local', 'Programs', 'antigravity', 'resources', 'app.asar');
    } else if (process.platform === 'darwin') {
        asarPath = '/Applications/Antigravity.app/Contents/Resources/app.asar';
    }
    
    if (!asarPath || !fs.existsSync(asarPath)) {
        addLogToBuffer('⚠️ Antigravity Agent app.asar not found. Skipping auto-patch.');
        return;
    }
    
    const bakPath = asarPath + '.bak';
    const tempDir = path.join(app.getPath('temp'), 'antigravity-agent-asar-temp');
    
    try {
        if (enable) {
            addLogToBuffer('⚙️ Auto-patching Antigravity Agent app.asar...');
            
            process.noAsar = true; // Disable Electron's ASAR interception
            try {
                if (!originalFs.existsSync(bakPath)) {
                    originalFs.copyFileSync(asarPath, bakPath);
                    addLogToBuffer('💾 Created backup of original app.asar.');
                } else {
                    // If backup already exists, restore it first to ensure we work on a clean original app.asar
                    originalFs.copyFileSync(bakPath, asarPath);
                    addLogToBuffer('⏪ Restored original app.asar from backup before patching.');
                }

                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
                asar.extractAll(asarPath, tempDir);
                addLogToBuffer('📂 Extracted app.asar.');
            } finally {
                process.noAsar = false; // Re-enable ASAR interception
            }
            
            const targetJs = path.join(tempDir, 'dist', 'languageServer.js');
            if (!fs.existsSync(targetJs)) {
                throw new Error('dist/languageServer.js not found inside app.asar');
            }
            
            let content = fs.readFileSync(targetJs, 'utf8');
            if (!content.includes("env['HTTP_PROXY'] = 'http://127.0.0.1:18443'")) {
                const match = content.match(/(\(0,\s*\w+\.setupNodeWrapper\)\(env\);?)/);
                if (match) {
                    const injectStr = `${match[0]}
        // INJECTED BY ANTIGRAVITY PROXY DESKTOP
        env['HTTP_PROXY']  = 'http://127.0.0.1:18443';
        env['HTTPS_PROXY'] = 'http://127.0.0.1:18443';
        env['http_proxy']  = 'http://127.0.0.1:18443';
        env['https_proxy'] = 'http://127.0.0.1:18443';
        env['NO_PROXY']    = 'localhost,127.0.0.1';
        env['no_proxy']    = 'localhost,127.0.0.1';
        try {
            const os = require('os');
            const path = require('path');
            const caPath = process.platform === 'win32'
                ? path.join(os.homedir(), 'AppData', 'Roaming', 'antigravity-proxy-desktop', 'certs', 'certs', 'ca.pem')
                : path.join(os.homedir(), 'Library', 'Application Support', 'antigravity-proxy-desktop', 'certs', 'certs', 'ca.pem');
            env['SSL_CERT_FILE'] = caPath;
        } catch (e) {}`;
                    
                    content = content.replace(match[0], injectStr);
                    fs.writeFileSync(targetJs, content, 'utf8');
                    addLogToBuffer('📝 Injected proxy env vars into languageServer.js.');
                } else {
                    throw new Error("Could not find insertion point 'setupNodeWrapper(env)' in languageServer.js");
                }
            } else {
                addLogToBuffer('ℹ️ languageServer.js already contains patch, skipping write.');
            }
            
            process.noAsar = true; // Disable Electron's ASAR interception
            try {
                await asar.createPackage(tempDir, asarPath);
                addLogToBuffer('📦 Repacked app.asar.');
                fs.rmSync(tempDir, { recursive: true, force: true });
            } finally {
                process.noAsar = false; // Re-enable ASAR interception
            }
            
            addLogToBuffer('✅ Antigravity Agent patched successfully.');
        }
    } catch (err) {
        addLogToBuffer(`❌ ASAR Patching failed: ${err.message}`);
        console.error(err);
        try { if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    }
}

// Sync restore for shutdown
function patchAgentAsarSync(enable) {
    if (enable) return; // Only support restore in sync mode
    
    const homeDir = app.getPath('home');
    let asarPath = '';
    
    if (process.platform === 'win32') {
        asarPath = path.join(homeDir, 'AppData', 'Local', 'Programs', 'antigravity', 'resources', 'app.asar');
    } else if (process.platform === 'darwin') {
        asarPath = '/Applications/Antigravity.app/Contents/Resources/app.asar';
    }
    
    if (!asarPath || !fs.existsSync(asarPath)) return;
    
    const bakPath = asarPath + '.bak';
    
    try {
        console.log('[ASAR Patcher] Restoring original app.asar...');
        
        process.noAsar = true; // Disable Electron's ASAR interception
        try {
            if (originalFs.existsSync(bakPath)) {
                originalFs.copyFileSync(bakPath, asarPath);
                originalFs.unlinkSync(bakPath);
                console.log('[ASAR Patcher] Restored app.asar from backup.');
            }
        } finally {
            process.noAsar = false; // Re-enable ASAR interception
        }
    } catch (err) {
        console.error('[ASAR Patcher] Sync restore failed:', err);
    }
}

let mainWindow;
let tray;
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
    const caCertPath = path.join(app.getPath('userData'), 'certs', 'certs', 'ca.pem');
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
    const timestamp = new Date().toISOString().split('T')[1].replace('Z', '');
    const formatted = `[${timestamp}] ${msg}`;
    logBuffer.push(formatted);
    if (logBuffer.length > 50) logBuffer.shift();
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('log', formatted);
    }
    writeToFileLog(formatted);
}

// Base64 generic proxy icon (16x16 standard system tray size)
const iconBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAC0SURBVDhPzZExDoQwDATz/x9NQUFDR0FDRUv/v0BDQ0v/P0BDRXvvvS2yItnZ2M4s2yN/5xOQYg2eYI1c8ARrrA3f8IE1vMMHFuQEH/CBE1yQE/wA4zMccEFO8AOMz3DABTkh11f4gROs4R0+sIY1fMMH1mCNXPAEa1CDP/ADz1CDP/ADD7jBE6zBGn7gB56hBnf4gQfc4AlW5IQf+IFnqMEdftA11OQOP/AONciyH/gT/0C+/QO82g2f9kYc4QAAAABJRU5ErkJggg==';

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
function updateAgentapiBat(enable) {
    const appData = app.getPath('appData');
    const homeDir = app.getPath('home');
    
    const caPath = process.platform === 'win32'
        ? path.join(app.getPath('userData'), 'certs', 'certs', 'ca.pem')
        : path.join(homeDir, 'Library', 'Application Support', 'antigravity-proxy-desktop', 'certs', 'certs', 'ca.pem');

    // bat 文件的可能路径（兼容 Windows AppData 和 macOS ~/Library/Application Support）
    const batCandidates = [
        path.join(appData, 'antigravity', 'bin', 'agentapi.bat'),
        path.join(appData, 'Antigravity', 'bin', 'agentapi.bat'),
        path.join(homeDir, '.antigravity', 'bin', 'agentapi.bat'),
    ];
    // shell script 路径（macOS）
    const shCandidates = [
        path.join(appData, 'antigravity', 'bin', 'agentapi'),
        path.join(appData, 'Antigravity', 'bin', 'agentapi'),
        path.join(homeDir, '.antigravity', 'bin', 'agentapi'),
    ];

    const PROXY_URL = 'http://127.0.0.1:18443';
    const BAT_MARKER = ':: ANTIGRAVITY_PROXY_INJECT';

    const patchBat = (filePath) => {
        try {
            if (!fs.existsSync(filePath)) return false;
            const original = fs.readFileSync(filePath, 'utf8');
            if (enable) {
                if (original.includes(BAT_MARKER)) return true; // already patched
                const inject = `${BAT_MARKER}\r\nset HTTP_PROXY=${PROXY_URL}\r\nset HTTPS_PROXY=${PROXY_URL}\r\nset NO_PROXY=localhost,127.0.0.1\r\nset SSL_CERT_FILE=${caPath}\r\n`;
                // Insert after @echo off (first line)
                const patched = original.replace(/^(@echo off\s*[\r\n]+)/i, `$1${inject}`);
                fs.writeFileSync(filePath, patched, 'utf8');
            } else {
                if (!original.includes(BAT_MARKER)) return true; // already clean
                // Remove injected block
                const cleaned = original.replace(new RegExp(`${BAT_MARKER}\\r?\\n(?:set [^\\r\\n]+\\r?\\n){1,6}`), '');
                fs.writeFileSync(filePath, cleaned, 'utf8');
            }
            return true;
        } catch (e) {
            console.error(`Failed to patch ${filePath}:`, e);
            return false;
        }
    };

    const SH_MARKER = '# ANTIGRAVITY_PROXY_INJECT';
    const patchSh = (filePath) => {
        try {
            if (!fs.existsSync(filePath)) return false;
            const original = fs.readFileSync(filePath, 'utf8');
            if (enable) {
                if (original.includes(SH_MARKER)) return true;
                const inject = `${SH_MARKER}\nexport HTTP_PROXY=${PROXY_URL}\nexport HTTPS_PROXY=${PROXY_URL}\nexport NO_PROXY=localhost,127.0.0.1\nexport SSL_CERT_FILE="${caPath}"\n`;
                const patched = original.replace(/^(#![^\n]+\n)/m, `$1${inject}`);
                fs.writeFileSync(filePath, patched, 'utf8');
            } else {
                if (!original.includes(SH_MARKER)) return true;
                const cleaned = original.replace(new RegExp(`${SH_MARKER}\\n(?:export [^\\n]+\\n){1,6}`), '');
                fs.writeFileSync(filePath, cleaned, 'utf8');
            }
            return true;
        } catch (e) {
            console.error(`Failed to patch ${filePath}:`, e);
            return false;
        }
    };

    let batPatched = false;
    for (const p of batCandidates) {
        if (patchBat(p)) { batPatched = true; break; }
    }
    for (const p of shCandidates) {
        if (patchSh(p)) break;
    }
    return batPatched;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 850,
        height: 700,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        autoHideMenuBar: true,
        title: "Antigravity Proxy Desktop"
    });

    mainWindow.loadFile('index.html');

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
}

app.whenReady().then(async () => {
    createWindow();

    // Use a native standard 16x16 icon from the filesystem
    const iconPath = path.join(__dirname, 'tray-icon.png');
    tray = new Tray(iconPath);

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show Dashboard', click: () => mainWindow.show() },
        { type: 'separator' },
        { label: 'Quit Proxy Engine', click: () => {
            isQuitting = true;
            app.quit();
        }}
    ]);

    tray.setToolTip('Antigravity Proxy');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => mainWindow.show());

    // Hook up engine events to IPC
    engine.on('log', (msg) => {
        addLogToBuffer(msg);
    });

    engine.on('state', (isRunning) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('state', isRunning);
        }
    });

    engine.on('stats', (stats) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('stats', stats);
        }
    });

    addLogToBuffer('🖥️ Antigravity Proxy UI Started');

    // 核心改造：启动代理服务，但默认设为直通模式
    engine.start();
    engine.setMode(false);

    // 将系统的云端端点强行指向本地 (App 生命周期内有效)
    await updateSettings(true);
    // 改写 agentapi.bat 注入 HTTP_PROXY，让 CLI 的 language_server 也走本地代理
    const batPatched = updateAgentapiBat(true);
    // 动态原地注入用户本地 app.asar 代理环境变量
    await patchAgentAsar(true);
    addLogToBuffer(`✅ Global settings mapped. All IDE/Agent traffic is now routed through us.${batPatched ? ' CLI bat patched.' : ''}`);
    addLogToBuffer('ℹ️ CLI: HTTP_PROXY injected into agentapi.bat for language_server interception.');
    addLogToBuffer('ℹ️ Current Mode: Passthrough (Direct connection, no retries).');
});

ipcMain.on('toggle', async (event, enable) => {
    // 热切换：只需调用 Engine 的 setMode 即可瞬间生效
    engine.setMode(enable);
    if (enable) {
        addLogToBuffer('✅ Mode Switched: Intercept ON (Traffic buffering & retrying 503 errors)');
    } else {
        addLogToBuffer('✅ Mode Switched: Intercept OFF (Passthrough to Google directly)');
    }
});

ipcMain.on('get-state', (event) => {
    event.reply('state', engine.isInterceptMode);
    event.reply('stats', engine.stats);
    // Send buffered logs to the new window
    logBuffer.forEach(log => event.reply('log', log));

    // Send certificate status when UI requests it
    checkCertStatus((isInstalled) => {
        event.reply('cert-status-res', isInstalled);
    });
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

app.on('before-quit', () => {
    engine.stop();
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
    updateAgentapiBat(false);    // Restore agentapi.bat on exit
    patchAgentAsarSync(false);   // Restore app.asar on exit
});
