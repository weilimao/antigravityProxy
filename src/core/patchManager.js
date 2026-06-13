/**
 * Antigravity Proxy - Patching Manager for Agent app.asar and script files
 */

const fs = require('fs');
const path = require('path');
const originalFs = require('original-fs');
const asar = require('asar');

/**
 * Hot patch http-mitm-proxy dependency for Windows compatibility before loading ProxyEngine
 * @param {string} projectRoot 
 */
function hotPatchMitmProxy(projectRoot) {
    try {
        const targetFile = path.join(projectRoot, 'node_modules', 'http-mitm-proxy', 'dist', 'lib', 'proxy.js');
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

/**
 * Async patcher for startup
 * @param {boolean} enable 
 * @param {string} homeDir 
 * @param {string} tempDir 
 * @param {string} caPath 
 * @param {function} logCallback 
 */
async function patchAgentAsar(enable, homeDir, tempDir, caPath, logCallback) {
    let asarPath = '';
    
    if (process.platform === 'win32') {
        asarPath = path.join(homeDir, 'AppData', 'Local', 'Programs', 'antigravity', 'resources', 'app.asar');
    } else if (process.platform === 'darwin') {
        asarPath = '/Applications/Antigravity.app/Contents/Resources/app.asar';
    }
    
    if (!asarPath || !fs.existsSync(asarPath)) {
        logCallback('⚠️ Antigravity Agent app.asar not found. Skipping auto-patch.');
        return;
    }
    
    const bakPath = asarPath + '.bak';
    
    try {
        if (enable) {
            logCallback('⚙️ Auto-patching Antigravity Agent app.asar...');
            
            process.noAsar = true; // Disable Electron's ASAR interception
            try {
                if (!originalFs.existsSync(bakPath)) {
                    originalFs.copyFileSync(asarPath, bakPath);
                    logCallback('💾 Created backup of original app.asar.');
                } else {
                    // If backup already exists, restore it first to ensure we work on a clean original app.asar
                    originalFs.copyFileSync(bakPath, asarPath);
                    logCallback('⏪ Restored original app.asar from backup before patching.');
                }

                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
                asar.extractAll(asarPath, tempDir);
                logCallback('📂 Extracted app.asar.');
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
            const fs = require('fs');
            const defaultUserData = process.platform === 'win32'
                ? path.join(os.homedir(), 'AppData', 'Roaming', 'antigravity-proxy-desktop')
                : path.join(os.homedir(), 'Library', 'Application Support', 'antigravity-proxy-desktop');
            let caPath = path.join(defaultUserData, 'certs', 'certs', 'ca.pem');
            try {
                const configPath = path.join(defaultUserData, 'config.json');
                if (fs.existsSync(configPath)) {
                    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    if (config.dataDirectory) {
                        caPath = path.join(config.dataDirectory, 'certs', 'certs', 'ca.pem');
                    }
                }
            } catch (err) {}
            env['SSL_CERT_FILE'] = caPath;
        } catch (e) {}`;
                    
                    content = content.replace(match[0], injectStr);
                    fs.writeFileSync(targetJs, content, 'utf8');
                    logCallback('📝 Injected proxy env vars into languageServer.js.');
                } else {
                    throw new Error("Could not find insertion point 'setupNodeWrapper(env)' in languageServer.js");
                }
            } else {
                logCallback('ℹ️ languageServer.js already contains patch, skipping write.');
            }
            
            process.noAsar = true; // Disable Electron's ASAR interception
            try {
                await asar.createPackage(tempDir, asarPath);
                logCallback('📦 Repacked app.asar.');
                fs.rmSync(tempDir, { recursive: true, force: true });
            } finally {
                process.noAsar = false; // Re-enable ASAR interception
            }
            
            logCallback('✅ Antigravity Agent patched successfully.');
        }
    } catch (err) {
        logCallback(`❌ ASAR Patching failed: ${err.message}`);
        console.error(err);
        try { if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    }
}

/**
 * Sync restore for shutdown
 * @param {boolean} enable 
 * @param {string} homeDir 
 */
function patchAgentAsarSync(enable, homeDir) {
    if (enable) return; // Only support restore in sync mode
    
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

/**
 * Function to inject/restore HTTP_PROXY in agentapi.bat for CLI interception
 * @param {boolean} enable 
 * @param {string} appData 
 * @param {string} homeDir 
 * @param {string} caPath 
 * @returns {boolean}
 */
function updateAgentapiBat(enable, appData, homeDir, caPath) {
    const batCandidates = [
        path.join(appData, 'antigravity', 'bin', 'agentapi.bat'),
        path.join(appData, 'Antigravity', 'bin', 'agentapi.bat'),
        path.join(homeDir, '.antigravity', 'bin', 'agentapi.bat'),
    ];
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
                const patched = original.replace(/^(@echo off\s*[\r\n]+)/i, `$1${inject}`);
                fs.writeFileSync(filePath, patched, 'utf8');
            } else {
                if (!original.includes(BAT_MARKER)) return true; // already clean
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

module.exports = {
    hotPatchMitmProxy,
    patchAgentAsar,
    patchAgentAsarSync,
    updateAgentapiBat
};
