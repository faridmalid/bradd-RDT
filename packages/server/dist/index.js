"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const db_1 = require("./db");
const path_1 = __importDefault(require("path"));
const builder_1 = require("./builder");
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: '*', // Allow all for dev
        methods: ['GET', 'POST']
    }
});
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/downloads', express_1.default.static(path_1.default.join(__dirname, '../../client/build')));
// Serve static frontend files (production)
const webBuildPath = path_1.default.join(__dirname, '../../web/dist');
app.use(express_1.default.static(webBuildPath));
const PORT = process.env.PORT || 3000;
// Initialize DB
(0, db_1.initDB)().then(() => console.log('Database initialized'));
// Build API
app.post('/api/build', async (req, res) => {
    const { name, serverUrl } = req.body;
    if (!name || !serverUrl) {
        res.status(400).json({ error: 'Missing name or serverUrl' });
        return;
    }
    try {
        const exePath = await (0, builder_1.buildClientExe)(name, serverUrl);
        const fileName = path_1.default.basename(exePath);
        res.json({ downloadUrl: `/downloads/${fileName}` });
    }
    catch (e) {
        console.error('Build failed:', e);
        res.status(500).json({ error: e.message });
    }
});
const activeClients = {}; // SocketID -> Session
const clientSocketMap = {}; // DB ID -> SocketID
// API Routes
// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const db = (0, db_1.getDB)();
    const user = await db.get('SELECT * FROM users WHERE username = ? AND password = ?', username, password);
    if (user) {
        res.json({ token: 'mock-token', user: { id: user.id, username: user.username } });
    }
    else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});
// Users
app.get('/api/users', async (req, res) => {
    const db = (0, db_1.getDB)();
    const users = await db.all('SELECT id, username FROM users');
    res.json(users);
});
app.post('/api/users', async (req, res) => {
    const { username, password } = req.body;
    const db = (0, db_1.getDB)();
    try {
        await db.run('INSERT INTO users (username, password) VALUES (?, ?)', username, password);
        res.json({ success: true });
    }
    catch (e) {
        res.status(400).json({ error: 'User exists or error' });
    }
});
app.delete('/api/users/:id', async (req, res) => {
    const db = (0, db_1.getDB)();
    await db.run('DELETE FROM users WHERE id = ?', req.params.id);
    res.json({ success: true });
});
// Groups
app.get('/api/groups', async (req, res) => {
    const db = (0, db_1.getDB)();
    const groups = await db.all('SELECT * FROM groups');
    res.json(groups);
});
app.post('/api/groups', async (req, res) => {
    const { name } = req.body;
    const db = (0, db_1.getDB)();
    try {
        await db.run('INSERT INTO groups (name) VALUES (?)', name);
        res.json({ success: true });
    }
    catch (e) {
        res.status(400).json({ error: 'Group exists' });
    }
});
app.get('/api/clients', async (req, res) => {
    const db = (0, db_1.getDB)();
    const clients = await db.all(`
        SELECT c.*, g.name as group_name 
        FROM clients c 
        LEFT JOIN groups g ON c.group_id = g.id
    `);
    // Merge online status
    const clientsWithStatus = clients.map((c) => ({
        ...c,
        status: clientSocketMap[c.id] ? 'online' : 'offline',
        socketId: clientSocketMap[c.id]
    }));
    res.json(clientsWithStatus);
});
app.put('/api/clients/:id', async (req, res) => {
    const { hostname, group_id } = req.body;
    const db = (0, db_1.getDB)();
    if (group_id) {
        await db.run('UPDATE clients SET group_id = ? WHERE id = ?', group_id, req.params.id);
    }
    if (hostname) {
        await db.run('UPDATE clients SET hostname = ? WHERE id = ?', hostname, req.params.id);
    }
    notifyAdmins();
    res.json({ success: true });
});
app.delete('/api/clients/:id', async (req, res) => {
    const db = (0, db_1.getDB)();
    await db.run('DELETE FROM clients WHERE id = ?', req.params.id);
    notifyAdmins();
    res.json({ success: true });
});
async function notifyAdmins() {
    // Re-fetch all clients and broadcast
    const db = (0, db_1.getDB)();
    if (!db)
        return;
    const clients = await db.all(`
        SELECT c.*, g.name as group_name 
        FROM clients c 
        LEFT JOIN groups g ON c.group_id = g.id
    `);
    const clientsWithStatus = clients.map((c) => ({
        ...c,
        status: clientSocketMap[c.id] ? 'online' : 'offline',
        socketId: clientSocketMap[c.id]
    }));
    io.to('admins').emit('client-update', clientsWithStatus);
}
// Socket.io
io.on('connection', (socket) => {
    // Identify as Client (The Remote Machine)
    socket.on('register-client', async (data) => {
        const db = (0, db_1.getDB)();
        // ID generation or usage
        let clientId = data.id;
        // If no ID provided (first run), or ID not in DB, create/upsert
        // Ideally client sends a UUID it generated and stored locally. 
        // If not, we generate one, but client needs to store it. 
        // For now, let's assume client sends a stable UUID or we use hostname + platform (weak)
        // Let's rely on client generating a UUID if possible, or fallback to socket ID (bad for persistence)
        // Better: Client generates UUID on first run and saves it. 
        // Current client implementation: Sends nothing or undefined for ID.
        // We will generate one and send it back if needed, but for now let's just use socket ID if no ID? 
        // No, we need persistence.
        // Let's assume the client sends a mac address or unique ID.
        // Update: Client code currently sends { hostname, platform }.
        // We should update client to generate/store a UUID.
        // For now, let's use a temporary ID logic if missing:
        if (!clientId) {
            // This should not happen with updated client, but fallback
            clientId = `temp-${socket.id}`;
        }
        // Upsert into DB
        try {
            const existing = await db.get('SELECT * FROM clients WHERE id = ?', clientId);
            if (existing) {
                await db.run('UPDATE clients SET hostname = ?, platform = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?', data.hostname, data.platform, clientId);
            }
            else {
                // Assign to default group
                const defaultGroup = await db.get('SELECT id FROM groups WHERE name = ?', 'Default');
                await db.run('INSERT INTO clients (id, hostname, platform, group_id, last_seen) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)', clientId, data.hostname, data.platform, defaultGroup.id);
            }
        }
        catch (e) {
            console.error('Error registering client:', e);
        }
        // Track session
        activeClients[socket.id] = { socketId: socket.id, dbId: clientId };
        clientSocketMap[clientId] = socket.id;
        console.log(`Client registered: ${clientId} (${data.hostname})`);
        notifyAdmins();
    });
    socket.on('disconnect', () => {
        const session = activeClients[socket.id];
        if (session) {
            console.log(`Client disconnected: ${session.dbId}`);
            delete clientSocketMap[session.dbId];
            delete activeClients[socket.id];
            notifyAdmins();
        }
    });
    // Admin Events
    socket.on('register-admin', () => {
        socket.join('admins');
    });
    // Signaling (WebRTC)
    socket.on('offer', (data) => {
        // Target could be Admin Socket ID (if from Client) or Client DB ID
        const targetSocket = clientSocketMap[data.target] || data.target;
        if (targetSocket) {
            console.log(`Relaying offer from ${socket.id} to ${targetSocket}`);
            io.to(targetSocket).emit('offer', { sdp: data.sdp, source: socket.id });
        }
        else {
            console.warn(`Offer target not found: ${data.target}`);
        }
    });
    socket.on('answer', (data) => {
        // Target is the source of the offer (Socket ID)
        console.log(`Relaying answer from ${socket.id} to ${data.target}`);
        io.to(data.target).emit('answer', { sdp: data.sdp, source: socket.id });
    });
    socket.on('ice-candidate', (data) => {
        // Target could be client ID (if from admin) or admin socket ID (if from client)
        const targetSocket = clientSocketMap[data.target] || data.target;
        if (targetSocket) {
            io.to(targetSocket).emit('ice-candidate', { candidate: data.candidate, source: socket.id });
        }
    });
    // Legacy / Hybrid Input (Forwarding to client)
    socket.on('input', (data) => {
        const targetSocket = clientSocketMap[data.target];
        if (targetSocket) {
            io.to(targetSocket).emit('input', data);
        }
    });
    socket.on('command', (data) => {
        const targetSocket = clientSocketMap[data.target];
        if (targetSocket) {
            io.to(targetSocket).emit('command', { command: data.command, source: socket.id });
        }
    });
    // Start/Stop Stream (Trigger WebRTC negotiation or fallback)
    socket.on('start-stream', (data) => {
        const targetSocket = clientSocketMap[data.target];
        if (targetSocket) {
            io.to(targetSocket).emit('start-stream', { requester: socket.id });
        }
    });
});
// SPA Fallback (Must be last)
app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
        return res.status(404).send('Not Found');
    }
    const indexHtml = path_1.default.join(webBuildPath, 'index.html');
    if (require('fs').existsSync(indexHtml)) {
        res.sendFile(indexHtml);
    }
    else {
        res.status(404).send('Web client not found. Did you run `npm run build`?');
    }
});
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
