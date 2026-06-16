const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// 1. 读取工作区下的 .env 文件
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  // 解析 GH_TOKEN
  const lines = envContent.split('\n');
  for (const line of lines) {
    const parts = line.split('=');
    if (parts[0].trim() === 'GH_TOKEN') {
      process.env.GH_TOKEN = parts.slice(1).join('=').trim();
      break;
    }
  }
}

// 2. 检查 GH_TOKEN 是否已设置
if (!process.env.GH_TOKEN) {
  console.error('Error: GH_TOKEN is not set in environment or local .env file.');
  process.exit(1);
}

// 3. 执行编译与发布命令
const isWin = process.platform === 'win32';
const shell = isWin ? 'powershell.exe' : true;
const command = 'npx electron-builder --publish always';

console.log('Starting build and publish...');
const child = spawn(command, { 
  stdio: 'inherit', 
  shell: shell,
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false'
  }
});

child.on('close', (code) => {
  process.exit(code);
});
