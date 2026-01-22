import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const CLIENT_DIR = path.resolve(__dirname, '../../client');
const DIST_INDEX = path.join(CLIENT_DIR, 'dist/index.js');

let isBuilding = false;

export async function buildClientExe(name: string, serverUrl: string): Promise<string> {
    if (isBuilding) throw new Error('Build in progress');
    isBuilding = true;

    try {
        console.log(`Starting build for ${name} with URL ${serverUrl}`);

        // 1. Run TSC to ensure clean dist
        await runCommand('npx', ['tsc'], CLIENT_DIR);

        // 2. Read dist/index.js
        let content = fs.readFileSync(DIST_INDEX, 'utf-8');
        
        // 3. Replace URL
        // We look for the line: const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
        // Note: The quotes might vary or whitespace.
        // In the read file it was: const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
        
        // We will use a regex that matches the variable assignment
        const regex = /const SERVER_URL = process\.env\.SERVER_URL \|\| ['"`].*['"`];/;
        if (!regex.test(content)) {
            throw new Error('Could not find SERVER_URL definition in dist/index.js');
        }

        const newContent = content.replace(
            regex,
            `const SERVER_URL = '${serverUrl}';`
        );
        fs.writeFileSync(DIST_INDEX, newContent);

        // 4. Copy InputHelper (if not already done by tsc or if we need to ensure it)
        // package.json build script does: copy src\InputHelper.exe dist\InputHelper.exe
        // We should do it here manually to be safe
        const srcHelper = path.join(CLIENT_DIR, 'src/InputHelper.exe');
        const distHelper = path.join(CLIENT_DIR, 'dist/InputHelper.exe');
        fs.copyFileSync(srcHelper, distHelper);

        // 5. Run pkg
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '');
        // pkg automatically adds .exe for windows targets
        
        await runCommand('npx', ['pkg', '.', '--targets', 'node18-win-x64', '--output', `build/${safeName}`], CLIENT_DIR);

        const exePath = path.join(CLIENT_DIR, 'build', `${safeName}.exe`);

        // Patch EXE to be a Windows GUI application (suppress console)
        try {
            console.log('Patching EXE to be silent (Windows GUI subsystem)...');
            const fd = fs.openSync(exePath, 'r+');
            const buffer = Buffer.alloc(4);
            
            // Read PE Header offset at 0x3C
            fs.readSync(fd, buffer, 0, 4, 0x3C);
            const peOffset = buffer.readUInt32LE(0);
            
            // Read Optional Header Magic Number (at PE + 24)
            // PE Signature (4) + File Header (20) = 24 bytes offset
            fs.readSync(fd, buffer, 0, 2, peOffset + 24);
            const magic = buffer.readUInt16LE(0);
            
            let subsystemOffset = -1;
            
            if (magic === 0x10b) { // PE32 (32-bit)
                // Subsystem is at offset 68 (0x44) in Optional Header
                subsystemOffset = peOffset + 24 + 68;
            } else if (magic === 0x20b) { // PE32+ (64-bit)
                // Subsystem is at offset 68 (0x44) in Optional Header
                subsystemOffset = peOffset + 24 + 68;
            }
            
            if (subsystemOffset !== -1) {
                // Read current subsystem
                fs.readSync(fd, buffer, 0, 2, subsystemOffset);
                const currentSubsystem = buffer.readUInt16LE(0);
                
                if (currentSubsystem === 3) { // IMAGE_SUBSYSTEM_WINDOWS_CUI
                    buffer.writeUInt16LE(2, 0); // IMAGE_SUBSYSTEM_WINDOWS_GUI
                    fs.writeSync(fd, buffer, 0, 2, subsystemOffset);
                    console.log('Successfully patched EXE to Windows GUI subsystem.');
                } else {
                    console.log(`EXE is already subsystem ${currentSubsystem}, skipping patch.`);
                }
            } else {
                console.warn('Unknown PE format, could not patch subsystem.');
            }
            
            fs.closeSync(fd);
        } catch (patchErr) {
            console.error('Failed to patch EXE subsystem:', patchErr);
            // Don't fail the build, just warn
        }

        return exePath;

    } finally {
        isBuilding = false;
    }
}

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, shell: true, stdio: 'inherit' });
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Command ${command} failed with code ${code}`));
        });
    });
}
