const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

function checkCertStatus(callback) {
    let settled = false;
    const done = (value) => {
        if (settled) return;
        settled = true;
        callback(value);
    };

    const timeout = setTimeout(() => done(false), 4000);
    timeout.unref && timeout.unref();

    if (process.platform === 'win32') {
        exec('certutil -user -store ROOT NodeMITMProxyCA', { timeout: 3500, windowsHide: true }, (err, stdout) => {
            clearTimeout(timeout);
            if (!err && stdout && stdout.includes('NodeMITMProxyCA')) {
                done(true);
            } else {
                done(false);
            }
        });
    } else if (process.platform === 'darwin') {
        exec('security find-certificate -c "NodeMITMProxyCA"', { timeout: 3500 }, (err) => {
            clearTimeout(timeout);
            done(!err);
        });
    } else {
        clearTimeout(timeout);
        done(false);
    }
}

function installCert(callback) {
    const caCertPath = path.join(settings.getActiveDataDirectory(), 'certs', 'certs', 'ca.pem');
    if (!fs.existsSync(caCertPath)) {
        callback(false, 'Certificate file ca.pem not found. Please start proxy first.');
        return;
    }

    if (process.platform === 'win32') {
        exec(`certutil -user -addstore -f ROOT "${caCertPath}"`, (err) => {
            if (err) {
                callback(false, err.message);
            } else {
                checkCertStatus(callback);
            }
        });
    } else if (process.platform === 'darwin') {
        const command = `security add-trusted-cert -d -r trustRoot -k "$HOME/Library/Keychains/login.keychain-db" "${caCertPath}"`;
        exec(command, (err) => {
            if (err) {
                const fallbackCommand = `security add-trusted-cert -d -r trustRoot "${caCertPath}"`;
                exec(fallbackCommand, (fallbackErr) => {
                    if (fallbackErr) {
                        callback(false, fallbackErr.message);
                    } else {
                        checkCertStatus(callback);
                    }
                });
            } else {
                checkCertStatus(callback);
            }
        });
    } else {
        callback(false, 'Only Windows and macOS are supported for automatic installation.');
    }
}

function uninstallCert(callback) {
    if (process.platform === 'win32') {
        exec('certutil -user -delstore ROOT NodeMITMProxyCA', (err) => {
            if (err) {
                callback(false, err.message);
            } else {
                checkCertStatus(callback);
            }
        });
    } else if (process.platform === 'darwin') {
        const command = `security delete-certificate -c "NodeMITMProxyCA" "$HOME/Library/Keychains/login.keychain-db"`;
        exec(command, (err) => {
            if (err) {
                const fallbackCommand = `security delete-certificate -c "NodeMITMProxyCA"`;
                exec(fallbackCommand, (fallbackErr) => {
                    if (fallbackErr) {
                        callback(false, fallbackErr.message);
                    } else {
                        checkCertStatus(callback);
                    }
                });
            } else {
                checkCertStatus(callback);
            }
        });
    } else {
        callback(false, 'Only Windows and macOS are supported for automatic uninstallation.');
    }
}

module.exports = {
    checkCertStatus,
    installCert,
    uninstallCert
};
