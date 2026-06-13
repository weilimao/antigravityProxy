// A true 16x16 standard PNG icon representing a server/proxy
const fs = require('fs');

// 16x16 PNG Base64 (A visible dark blue/grey icon)
const validIconBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACmSURBVDhPrZDRDcQgCEQ9wH73v3m/O1vbpI1WQpRmH14MGBFR8T9R2RkzxvB34E5e1jHG8HfAnbwse1iWhQyIqkHGAEhE52AOGIBd1w2Ygy5qj8TMAHruXl5H1P7I9Zl6GqL2R67P1NMQ1X5T/yZzGqL2R67P1NMQ1X5T/yZzGqL2R67P1NMQ1X5T/yZzGuJ1/b7j2eT1R65/qKchqt0f+X/w2eT1R65/qKchqt0f+X/w2XwD8i5t4uU27wAAAABJRU5ErkJggg==';

const buffer = Buffer.from(validIconBase64, 'base64');
fs.writeFileSync('E:\\GPT\\antigravity-proxy-desktop\\icon.png', buffer);
