/**
 * Antigravity Proxy - Global Settings and Data Migration Module
 */

const fs = require('fs');
const path = require('path');

const CONFIG_FILE_NAME = 'config.json';
const DATA_FILES = ['accounts.json', 'stats.json', 'pricing.json'];
const DATA_DIRS = ['certs'];

class SettingsManager {
    constructor() {
        this.defaultUserDataPath = '';
        this.activeDataDirectory = '';
        this.customDataDirectory = null;
        this.config = {
            dataDirectory: null,
            enableSystemLog: false,
            isInterceptMode: false,
            autoStart: false,
            silentStart: false
        };
    }

    /**
     * Initialize settings with default userData path
     * @param {string} defaultPath 
     */
    init(defaultPath) {
        this.defaultUserDataPath = defaultPath;
        this.loadConfig();
    }

    /**
     * Load config.json from the default userData directory
     */
    loadConfig() {
        if (!this.defaultUserDataPath) {
            console.error('[Settings] Cannot load config: defaultUserDataPath is not set');
            return;
        }

        const configPath = path.join(this.defaultUserDataPath, CONFIG_FILE_NAME);
        try {
            if (fs.existsSync(configPath)) {
                const content = fs.readFileSync(configPath, 'utf8');
                const parsed = JSON.parse(content);
                if (parsed) {
                    this.config.dataDirectory = parsed.dataDirectory || null;
                    this.config.enableSystemLog = parsed.enableSystemLog === true;
                    this.config.isInterceptMode = parsed.isInterceptMode === true;
                    this.config.autoStart = parsed.autoStart === true;
                    this.config.silentStart = parsed.silentStart === true;
                }
                
                if (this.config.dataDirectory && fs.existsSync(this.config.dataDirectory)) {
                    this.customDataDirectory = this.config.dataDirectory;
                    this.activeDataDirectory = this.config.dataDirectory;
                    console.log(`[Settings] Using custom data directory: ${this.activeDataDirectory}`);
                    return;
                }
            }
        } catch (err) {
            console.error('[Settings] Failed to parse config.json, resetting to defaults:', err);
        }

        // Fallback to default
        this.customDataDirectory = null;
        this.activeDataDirectory = this.defaultUserDataPath;
        console.log(`[Settings] Using default data directory: ${this.activeDataDirectory}`);
    }

    /**
     * Get the current active data directory path
     * @returns {string}
     */
    getActiveDataDirectory() {
        return this.activeDataDirectory;
    }

    /**
     * Get custom data directory from settings (could be null)
     * @returns {string|null}
     */
    getCustomDataDirectory() {
        return this.customDataDirectory;
    }

    /**
     * Check if system log is enabled
     * @returns {boolean}
     */
    getEnableSystemLog() {
        return this.config.enableSystemLog;
    }

    /**
     * Set whether system log is enabled and save configuration
     * @param {boolean} enable 
     */
    setEnableSystemLog(enable) {
        this.config.enableSystemLog = !!enable;
        this.saveConfig(this.customDataDirectory);
    }

    /**
     * Check if intercept mode is enabled by default
     * @returns {boolean}
     */
    getIsInterceptMode() {
        return this.config.isInterceptMode;
    }

    /**
     * Set intercept mode state
     * @param {boolean} mode 
     */
    setIsInterceptMode(mode) {
        this.config.isInterceptMode = !!mode;
        this.saveConfig(this.customDataDirectory);
    }

    /**
     * Check if auto start is enabled
     * @returns {boolean}
     */
    getAutoStart() {
        return this.config.autoStart;
    }

    /**
     * Set auto start state
     * @param {boolean} enabled 
     */
    setAutoStart(enabled) {
        this.config.autoStart = !!enabled;
        this.saveConfig(this.customDataDirectory);
    }

    /**
     * Check if silent start is enabled
     * @returns {boolean}
     */
    getSilentStart() {
        return this.config.silentStart;
    }

    /**
     * Set silent start state
     * @param {boolean} enabled 
     */
    setSilentStart(enabled) {
        this.config.silentStart = !!enabled;
        this.saveConfig(this.customDataDirectory);
    }

    /**
     * Save the config.json into default userData directory
     * @param {string|null} customPath 
     */
    saveConfig(customPath) {
        if (!this.defaultUserDataPath) return;

        const configPath = path.join(this.defaultUserDataPath, CONFIG_FILE_NAME);
        try {
            this.config.dataDirectory = customPath || null;
            fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2), 'utf8');
            console.log(`[Settings] Config saved:`, this.config);
        } catch (err) {
            console.error('[Settings] Failed to write config.json:', err);
        }
    }

    /**
     * Migrate all data files and directories from current active directory to the new target path
     * @param {string} targetPath 
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async migrateData(targetPath) {
        if (!this.defaultUserDataPath) {
            return { success: false, error: 'Settings module not initialized' };
        }

        const resolvedTarget = path.resolve(targetPath);
        const resolvedCurrent = path.resolve(this.activeDataDirectory);

        if (resolvedTarget === resolvedCurrent) {
            return { success: true };
        }

        // Validate target path writable by trying to create directory
        try {
            if (!fs.existsSync(resolvedTarget)) {
                fs.mkdirSync(resolvedTarget, { recursive: true });
            }
        } catch (err) {
            return { success: false, error: `无法创建目标目录，权限不足或路径无效: ${err.message}` };
        }

        console.log(`[Settings] Migrating data from ${resolvedCurrent} to ${resolvedTarget}...`);

        const copiedItems = [];

        try {
            // 1. Copy Files
            for (const file of DATA_FILES) {
                const srcFile = path.join(resolvedCurrent, file);
                const destFile = path.join(resolvedTarget, file);
                if (fs.existsSync(srcFile)) {
                    fs.copyFileSync(srcFile, destFile);
                    copiedItems.push({ path: destFile, isDir: false, original: srcFile });
                }
            }

            // 2. Copy Directories (recursive)
            for (const dir of DATA_DIRS) {
                const srcDir = path.join(resolvedCurrent, dir);
                const destDir = path.join(resolvedTarget, dir);
                if (fs.existsSync(srcDir)) {
                    this.copyRecursiveSync(srcDir, destDir);
                    copiedItems.push({ path: destDir, isDir: true, original: srcDir });
                }
            }

            // 3. Verify copied files exist at the target location
            for (const item of copiedItems) {
                if (!fs.existsSync(item.path)) {
                    throw new Error(`文件校验失败，未能在目标位置找到已迁移的项: ${path.basename(item.path)}`);
                }
            }

            // 4. Update memory state & persist configuration
            const isTargetDefault = (resolvedTarget === path.resolve(this.defaultUserDataPath));
            const newCustomPath = isTargetDefault ? null : resolvedTarget;

            this.saveConfig(newCustomPath);
            this.customDataDirectory = newCustomPath;
            this.activeDataDirectory = resolvedTarget;

            // 5. Clean up old files to prevent redundancy
            for (const item of copiedItems) {
                try {
                    if (item.isDir) {
                        fs.rmSync(item.original, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(item.original);
                    }
                } catch (cleanupErr) {
                    console.warn(`[Settings] Warning: Failed to clean up old item: ${item.original}. Error: ${cleanupErr.message}`);
                }
            }

            console.log(`[Settings] Migration completed successfully to ${resolvedTarget}`);
            return { success: true };

        } catch (err) {
            console.error('[Settings] Migration failed:', err);
            
            // Rollback: delete newly copied items at target destination to stay clean
            for (const item of copiedItems) {
                try {
                    if (fs.existsSync(item.path)) {
                        if (item.isDir) {
                            fs.rmSync(item.path, { recursive: true, force: true });
                        } else {
                            fs.unlinkSync(item.path);
                        }
                    }
                } catch (_) {}
            }

            return { success: false, error: `迁移数据失败: ${err.message}` };
        }
    }

    /**
     * Recursively copy a directory helper
     * @param {string} src 
     * @param {string} dest 
     */
    copyRecursiveSync(src, dest) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                this.copyRecursiveSync(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }
}

module.exports = new SettingsManager();
