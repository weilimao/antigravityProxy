const fs = require('fs');
const path = require('path');

const CREDENTIALS_FILE = path.join(__dirname, '..', '..', 'credentials.json');

let credentials = {
    gemini_cli: {
        client_id: '',
        client_secret: ''
    },
    antigravity: {
        client_id: '',
        client_secret: ''
    }
};

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
    } catch (err) {
        console.error('[Credentials] Failed to parse credentials.json:', err.message);
    }
} else {
    console.error('[Credentials] CRITICAL ERROR: credentials.json not found! Please create credentials.json in the project root directory.');
}

module.exports = credentials;
