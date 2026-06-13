const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

function cleanVersion(ver) {
    if (!ver) return '0.0.0';
    return ver.trim().replace(/^v/i, '');
}

function isNewerVersion(current, latest) {
    try {
        const parse = (v) => v.split('.').map(Number);
        const [cMajor, cMinor, cPatch] = parse(cleanVersion(current));
        const [lMajor, lMinor, lPatch] = parse(cleanVersion(latest));
        
        if (lMajor > cMajor) return true;
        if (lMajor < cMajor) return false;
        
        if (lMinor > cMinor) return true;
        if (lMinor < cMinor) return false;
        
        return lPatch > cPatch;
    } catch (err) {
        console.error('Failed to parse version strings:', err);
        return false;
    }
}

function fetchLatestRelease(owner, repo) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${owner}/${repo}/releases/latest`,
            headers: {
                'User-Agent': 'AntigravityProxy-Updater'
            },
            timeout: 6000
        };

        https.get(options, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`GitHub API returned status code ${res.statusCode}`));
                return;
            }

            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (err) {
                    reject(err);
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

function findPlatformAsset(assets) {
    if (!assets || !Array.isArray(assets)) return null;
    const platform = process.platform;
    const arch = process.arch;
    if (platform === 'win32') {
        // Windows: Find .exe, exclude .blockmap
        return assets.find(asset => {
            const name = asset.name.toLowerCase();
            return name.endsWith('.exe') && !name.endsWith('.blockmap');
        });
    } else if (platform === 'darwin') {
        // macOS: 优先寻找带有当前架构的 .dmg，其次是通用 .dmg，然后是 .zip
        const dmgAsset = assets.find(asset => {
            const name = asset.name.toLowerCase();
            return name.endsWith('.dmg') && name.includes(arch);
        }) || assets.find(asset => asset.name.toLowerCase().endsWith('.dmg'));

        if (dmgAsset) return dmgAsset;

        return assets.find(asset => {
            const name = asset.name.toLowerCase();
            return name.endsWith('.zip') && name.includes(arch);
        }) || assets.find(asset => asset.name.toLowerCase().endsWith('.zip'));
    }
    return null;
}

function downloadFileWithProgress(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        const headers = {
            'User-Agent': 'AntigravityProxy-Updater-Downloader'
        };

        https.get(url, { headers }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                if (res.headers.location) {
                    downloadFileWithProgress(res.headers.location, destPath, onProgress)
                        .then(resolve)
                        .catch(reject);
                } else {
                    reject(new Error(`Redirect status ${res.statusCode} without location header.`));
                }
                return;
            }

            if (res.statusCode !== 200) {
                reject(new Error(`Failed to download file. Status code: ${res.statusCode}`));
                return;
            }

            const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
            let downloadedBytes = 0;
            const fileStream = fs.createWriteStream(destPath);

            res.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                fileStream.write(chunk);

                if (totalBytes > 0) {
                    const percent = Math.round((downloadedBytes / totalBytes) * 100);
                    onProgress(percent, downloadedBytes, totalBytes);
                }
            });

            res.on('end', () => {
                fileStream.end();
                resolve();
            });

            res.on('error', (err) => {
                fileStream.destroy();
                fs.unlink(destPath, () => {});
                reject(err);
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

class UpdateManager extends EventEmitter {
    constructor({ logger, appVersion, tempDir, appQuitCallback, owner = 'weilimao', repo = 'antigravityProxy' }) {
        super();
        this.logger = logger || console;
        this.appVersion = appVersion;
        this.tempDir = tempDir;
        this.appQuitCallback = appQuitCallback;
        this.owner = owner;
        this.repo = repo;
        this.isDownloading = false;
    }

    async checkForUpdates(manual = false) {
        try {
            this.logger.log(`[Update] Checking for updates. Current version: ${this.appVersion}`);
            const release = await fetchLatestRelease(this.owner, this.repo);
            const latestVersion = release.tag_name;
            const downloadUrl = release.html_url;
            const releaseNotes = release.body || 'No release notes provided.';

            const hasUpdate = isNewerVersion(this.appVersion, latestVersion);
            if (hasUpdate) {
                this.logger.log(`[Update] Found newer version: ${latestVersion}`);
                this.emit('update-available', {
                    currentVersion: this.appVersion,
                    latestVersion,
                    releaseNotes,
                    downloadUrl,
                    assets: release.assets
                });
                return true;
            } else {
                this.logger.log(`[Update] Current version is up to date.`);
                this.emit('update-not-available', {
                    currentVersion: this.appVersion
                });
                return false;
            }
        } catch (err) {
            this.logger.error('[Update] Check for updates failed:', err.message);
            this.emit('error', err);
            throw err;
        }
    }

    async startDownload(assets) {
        if (this.isDownloading) {
            this.logger.log('[Update] Download already in progress.');
            return false;
        }

        const asset = findPlatformAsset(assets);
        if (!asset) {
            const err = new Error('No matching installer asset found for the current platform.');
            this.logger.error('[Update]', err.message);
            this.emit('error', err);
            return false;
        }

        this.isDownloading = true;
        const destPath = path.join(this.tempDir, asset.name);
        this.logger.log(`[Update] Downloading installer. URL: ${asset.browser_download_url}, Dest: ${destPath}`);

        try {
            await downloadFileWithProgress(
                asset.browser_download_url,
                destPath,
                (percent, downloaded, total) => {
                    this.emit('download-progress', {
                        percent,
                        downloaded,
                        total
                    });
                }
            );

            this.isDownloading = false;
            this.logger.log(`[Update] Download completed: ${destPath}`);
            this.emit('download-complete', destPath);
            return true;
        } catch (err) {
            this.isDownloading = false;
            this.logger.error('[Update] Download failed:', err.message);
            this.emit('error', err);
            return false;
        }
    }

    installUpdate(filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                throw new Error(`Installer file not found at: ${filePath}`);
            }

            this.logger.log(`[Update] Launching installer and quitting. File: ${filePath}`);
            const platform = process.platform;

            if (platform === 'win32') {
                // Windows silent install /S, and --force-run to auto-launch after install completes
                const child = spawn(filePath, ['/S', '--force-run'], {
                    detached: true,
                    stdio: 'ignore'
                });
                child.unref();

                setTimeout(() => {
                    if (this.appQuitCallback) {
                        this.appQuitCallback();
                    } else {
                        process.exit(0);
                    }
                }, 500);
            } else if (platform === 'darwin') {
                // macOS: 调用 system 默认方式挂载/解压安装包，并安全退出原进程
                const { shell } = require('electron');
                shell.openPath(filePath).then(() => {
                    setTimeout(() => {
                        if (this.appQuitCallback) {
                            this.appQuitCallback();
                        } else {
                            process.exit(0);
                        }
                    }, 500);
                }).catch(err => {
                    this.logger.error('[Update] macOS failed to open installer:', err.message);
                });
            } else {
                this.logger.error('[Update] Auto install only supported on Windows and macOS.');
            }
        } catch (err) {
            this.logger.error('[Update] Failed to execute installer:', err.message);
            this.emit('error', err);
        }
    }
}

module.exports = UpdateManager;
