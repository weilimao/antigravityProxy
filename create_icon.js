// Create a dummy transparent icon to prevent Tray crash if not found
const fs = require('fs');
const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
fs.writeFileSync('E:\\GPT\\antigravity-proxy-desktop\\icon.png', buffer);