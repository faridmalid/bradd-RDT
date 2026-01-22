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
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:5174';
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
            const tempPath = path_1.default.join(os_1.default.tmpdir(), 'bradd-rdt-input-helper.exe');
            // Always overwrite to ensure latest version
            fs_1.default.writeFileSync(tempPath, fs_1.default.readFileSync(internalPath));
            return tempPath;
        }
        catch (e) {
            console.error('Failed to extract InputHelper:', e);
            // Fallback
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
let inputHelperPath = getInputHelperPath();
console.log(`Input Helper Path: ${inputHelperPath}`);
// Persistent InputHelper Process
let inputProcess = null;
function ensureInputProcess() {
    if (!inputProcess || inputProcess.killed) {
        try {
            console.log('Spawning persistent InputHelper process...');
            inputProcess = (0, child_process_1.spawn)(inputHelperPath, [], { stdio: ['pipe', 'inherit', 'inherit'] });
            inputProcess.on('error', (err) => {
                console.error('InputHelper process error:', err);
                inputProcess = null;
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
async function main() {
    let hostname = 'Unknown';
    let platform = 'Unknown';
    try {
        const osInfo = await systeminformation_1.default.osInfo();
        hostname = osInfo.hostname;
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
        hostname = require('os').hostname();
        platform = require('os').platform();
    }
    console.log(`Identifying as ${hostname} (${platform})`);
    if (socket.connected) {
        register();
    }
    socket.on('connect', () => {
        console.log('Connected to server ID:', socket.id);
        register();
    });
    function register() {
        socket.emit('register-client', {
            id: clientId,
            hostname: hostname,
            platform: platform
        });
    }
    let pc = null;
    let streamInterval = null;
    let currentStreamId = 0;
    socket.on('start-stream', async (data) => {
        const { requester } = data;
        console.log('Starting WebRTC stream for', requester);
        const myStreamId = ++currentStreamId;
        if (pc) {
            try {
                pc.close();
            }
            catch (e) { }
        }
        if (streamInterval)
            clearInterval(streamInterval);
        const newPc = new werift_1.RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        pc = newPc;
        const dc = newPc.createDataChannel('screen');
        // Start sending frames when channel is open
        dc.stateChanged.subscribe((state) => {
            // console.log('DataChannel state:', state);
            if (state === 'open' && myStreamId === currentStreamId) {
                streamInterval = setInterval(async () => {
                    if (myStreamId !== currentStreamId) {
                        if (streamInterval)
                            clearInterval(streamInterval);
                        return;
                    }
                    try {
                        const img = await (0, screenshot_desktop_1.default)({ format: 'jpg' });
                        // console.log('Sending frame:', img.length);
                        dc.send(img);
                    }
                    catch (err) {
                        console.error('Screenshot error:', err);
                    }
                }, 200); // 5 FPS
            }
        });
        newPc.iceConnectionStateChange.subscribe((state) => {
            console.log('ICE State:', state);
            if (state === 'disconnected' || state === 'failed' || state === 'closed') {
                if (streamInterval && myStreamId === currentStreamId)
                    clearInterval(streamInterval);
            }
        });
        newPc.onIceCandidate.subscribe((candidate) => {
            if (candidate && myStreamId === currentStreamId) {
                socket.emit('ice-candidate', { target: requester, candidate });
            }
        });
        // Create Offer
        try {
            const offer = await newPc.createOffer();
            if (myStreamId !== currentStreamId)
                return; // Abort if cancelled
            await newPc.setLocalDescription(offer);
            socket.emit('offer', { target: requester, sdp: offer });
        }
        catch (e) {
            console.error('Error creating offer:', e);
            return;
        }
        // Handle signaling
        const onAnswer = async (ansData) => {
            if (ansData.source === requester && myStreamId === currentStreamId) {
                try {
                    await newPc.setRemoteDescription(ansData.sdp);
                }
                catch (e) {
                    console.error('Error setting remote description:', e);
                }
            }
        };
        const onCandidate = async (candData) => {
            if (candData.source === requester && myStreamId === currentStreamId) {
                try {
                    await newPc.addIceCandidate(candData.candidate);
                }
                catch (e) {
                    console.error('Error adding candidate:', e);
                }
            }
        };
        socket.off('answer');
        socket.off('ice-candidate');
        socket.on('answer', onAnswer);
        socket.on('ice-candidate', onCandidate);
    });
    socket.on('stop-stream', () => {
        console.log('Stopping stream');
        currentStreamId++; // Invalidate pending
        if (streamInterval)
            clearInterval(streamInterval);
        if (pc) {
            try {
                pc.close();
            }
            catch (e) { }
            pc = null;
        }
    });
    socket.on('input', (data) => {
        handleInput(data);
    });
    // Handle remote commands
    socket.on('command', (data) => {
        console.log('Received command:', data.command);
        if (data.command === 'uninstall') {
            // Uninstall logic: Create a cleanup script and exit
            const scriptPath = path_1.default.join(os_1.default.tmpdir(), 'cleanup.bat');
            const exePath = process.execPath;
            // Basic self-delete script
            const scriptContent = `
@echo off
timeout /t 2 /nobreak > NUL
del "${exePath}"
del "${CONFIG_FILE}"
del "%~f0"
`;
            fs_1.default.writeFileSync(scriptPath, scriptContent);
            (0, child_process_1.spawn)('cmd.exe', ['/c', scriptPath], { detached: true, stdio: 'ignore' });
            process.exit(0);
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
    if (args.length > 0) {
        // spawn(inputHelperPath, args);
        ensureInputProcess();
        if (inputProcess && inputProcess.stdin) {
            const commandLine = args.join(' ') + '\n';
            try {
                inputProcess.stdin.write(commandLine);
            }
            catch (e) {
                console.error('Error writing to InputHelper stdin:', e);
                // Try restarting
                inputProcess.kill();
                inputProcess = null;
            }
        }
    }
}
main();
