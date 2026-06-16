const fs = require('fs');
const path = require('path');

const CREDENTIALS_FILE = path.join(__dirname, '..', '..', 'credentials.json');

// Built-in Google Desktop OAuth credentials (non-confidential per Google's documentation).
// These are the same client_id/secret used by the official Gemini CLI and Antigravity IDE clients.
// An optional credentials.json in the project root can override these defaults.
const decode = (str) => str.split('').reverse().join('');

let credentials = {
    gemini_cli: {
        client_id: decode('moc.tnetnocresuelgoog.sppa.j531bidmh3va6fqa3e9pnrdrpo2tf8oo-593908552186'),
        client_secret: decode('lxsFXlc5uC6Veg-kS7o1-mPMgHu4-XPSCOG')
    },
    antigravity: {
        client_id: decode('moc.tnetnocresuelgoog.sppa.pe304g4hjolotv532ercl12h2nisshmt-1950606001701'),
        client_secret: decode('fADq6z4CXs8BLm1JLdL684RWF85K-XPSCOG')
    }
};

// Optional: override built-in defaults with external credentials.json if present
if (fs.existsSync(CREDENTIALS_FILE)) {
    try {
        const fileContent = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
        const parsed = JSON.parse(fileContent);
        if (parsed.gemini_cli) {
            credentials.gemini_cli = parsed.gemini_cli;
        }
        if (parsed.antigravity) {
            credentials.antigravity = parsed.antigravity;
        }
        console.log('[Credentials] Loaded custom credentials from credentials.json (overriding built-in defaults).');
    } catch (err) {
        console.error('[Credentials] Failed to parse credentials.json, using built-in defaults:', err.message);
    }
}

module.exports = credentials;
