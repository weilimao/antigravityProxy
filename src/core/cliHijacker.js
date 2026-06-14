/**
 * CLI Hijacker - Intercepts native 'agy' CLI by creating script wrappers
 * that inject HTTP_PROXY and SSL_CERT_FILE, and forwards commands to the renamed real binary.
 */

const fs = require('fs');
const path = require('path');

function getCliCandidates(appData, homeDir) {
    const candidates = [];
    
    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA || path.join(path.dirname(appData), 'Local');
        candidates.push(path.join(localAppData, 'agy', 'bin'));
        candidates.push(path.join(localAppData, 'Programs', 'antigravity', 'resources', 'bin'));
        // 扩充的常见用户目录
        candidates.push(path.join(homeDir, '.gemini', 'antigravity-cli', 'bin'));
        candidates.push(path.join(homeDir, '.gemini', 'antigravity', 'bin'));
    } else {
        // Unix (macOS / Linux) 常见安装路径
        candidates.push(path.join(homeDir, '.gemini', 'antigravity-cli', 'bin'));
        candidates.push(path.join(homeDir, '.gemini', 'antigravity', 'bin'));
        candidates.push(path.join(homeDir, 'Library', 'Application Support', 'agy', 'bin'));
    }

    return candidates;
}

/**
 * Perform CLI hijacking or restoration
 * @param {boolean} enable true to hijack (inject wrapper), false to restore (remove wrapper)
 * @param {string} appData Path to user local/roaming app data
 * @param {string} homeDir Path to user home directory
 * @param {string} caPath Path to local proxy root certificate ca.pem
 * @param {function} logCallback Logger function
 */
function hijackCli(enable, appData, homeDir, caPath, logCallback = console.log) {
    const binDirs = getCliCandidates(appData, homeDir);
    const exeName = process.platform === 'win32' ? 'agy.exe' : 'agy';
    const realExeName = process.platform === 'win32' ? 'agy_real.exe' : 'agy_real';

    for (const dir of binDirs) {
        if (!fs.existsSync(dir)) continue;

        const originalPath = path.join(dir, exeName);
        const renamedPath = path.join(dir, realExeName);
        const batWrapperPath = path.join(dir, 'agy.bat');
        const shWrapperPath = path.join(dir, 'agy'); // Unix wrapper or Git Bash wrapper on Windows

        try {
            if (enable) {
                // --- 启用劫持 ---
                let realExeExists = fs.existsSync(renamedPath);
                let originalExeExists = fs.existsSync(originalPath);

                // 如果 real 也不存在，且 original 也不存在，说明此候选路径无效
                if (!realExeExists && !originalExeExists) continue;

                // 如果 original 存在且并非被我们之前替换成的 wrapper 脚本本身（我们通过文件大小判断，真实的可执行二进制 > 10MB）
                if (originalExeExists) {
                    const stats = fs.lstatSync(originalPath);
                    if (stats.isFile() && stats.size > 1024 * 1024) { 
                        fs.renameSync(originalPath, renamedPath);
                        logCallback(`[CliHijacker] Renamed ${exeName} to ${realExeName} in ${dir}`);
                        realExeExists = true;
                    }
                }

                if (realExeExists) {
                    // 1. 写入 Windows Bat Wrapper
                    const batContent = `@echo off\r\n` +
                        `set HTTP_PROXY=http://127.0.0.1:18443\r\n` +
                        `set HTTPS_PROXY=http://127.0.0.1:18443\r\n` +
                        `set NO_PROXY=localhost,127.0.0.1\r\n` +
                        `set SSL_CERT_FILE=${caPath}\r\n` +
                        `"%~dp0${realExeName}" %*\r\n`;
                    fs.writeFileSync(batWrapperPath, batContent, 'utf8');

                    // 2. 写入 Unix Shell Wrapper (支持 Git Bash / Cygwin / macOS / Linux)
                    const shContent = `#!/bin/bash\n` +
                        `export HTTP_PROXY=http://127.0.0.1:18443\n` +
                        `export HTTPS_PROXY=http://127.0.0.1:18443\n` +
                        `export NO_PROXY=localhost,127.0.0.1\n` +
                        `export SSL_CERT_FILE="${caPath}"\n` +
                        `exec "$(dirname "$0")/${realExeName}" "$@"\n`;
                    fs.writeFileSync(shWrapperPath, shContent, { encoding: 'utf8', mode: 0o755 });

                    logCallback(`[CliHijacker] Successfully hijacked agy CLI in ${dir}`);
                }
            } else {
                // --- 恢复还原 ---
                const realExeExists = fs.existsSync(renamedPath);

                // 删除 Bat 和 Bash wrapper 脚本
                if (fs.existsSync(batWrapperPath)) {
                    fs.unlinkSync(batWrapperPath);
                }
                
                if (process.platform === 'win32') {
                    if (fs.existsSync(shWrapperPath)) {
                        fs.unlinkSync(shWrapperPath);
                    }
                } else {
                    if (fs.existsSync(originalPath)) {
                        const stats = fs.lstatSync(originalPath);
                        // 如果原路径被创建成脚本了，先清理掉它
                        if (stats.size < 1024 * 1024) {
                            fs.unlinkSync(originalPath);
                        }
                    }
                }

                // 将真实二进制文件恢复为原文件名
                if (realExeExists) {
                    if (!fs.existsSync(originalPath)) {
                        fs.renameSync(renamedPath, originalPath);
                        logCallback(`[CliHijacker] Restored ${realExeName} to ${exeName} in ${dir}`);
                    } else {
                        // 如果由于某些异常原始名字已存在，则只删除备份以防止报错
                        fs.unlinkSync(renamedPath);
                    }
                }
            }
        } catch (e) {
            logCallback(`[CliHijacker] Error processing hijacking in ${dir}: ${e.message}`);
        }
    }
}

module.exports = {
    hijackCli
};
