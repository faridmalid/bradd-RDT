import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { initDB, getDB } from './db';
import path from 'path';
import { buildClientExe } from './builder';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*', // Allow all for dev
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());
app.use('/downloads', express.static(path.join(__dirname, '../../client/build')));

// Serve static frontend files (production)
const webBuildPath = path.join(__dirname, '../../web/dist');
app.use(express.static(webBuildPath));

const PORT = process.env.PORT || 3000;

// Initialize DB
initDB().then(() => console.log('Database initialized'));

// Build API
app.post('/api/build', async (req, res) => {
    const { name, serverUrl } = req.body;
    if (!name || !serverUrl) {
         res.status(400).json({ error: 'Missing name or serverUrl' });
         return;
    }
    
    try {
        const exePath = await buildClientExe(name, serverUrl);
        const fileName = path.basename(exePath);
        res.json({ downloadUrl: `/downloads/${fileName}` });
    } catch (e: any) {
        console.error('Build failed:', e);
        res.status(500).json({ error: e.message });
    }
});

// In-memory mapping for socket routing
interface ClientSession {
    socketId: string;
    dbId: string; // The ID in the database
}
const activeClients: Record<string, ClientSession> = {}; // SocketID -> Session
const clientSocketMap: Record<string, string> = {}; // DB ID -> SocketID

// API Routes

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const db = getDB();
  const user = await db.get('SELECT * FROM users WHERE username = ? AND password = ?', username, password);
  
  if (user) {
    res.json({ token: 'mock-token', user: { id: user.id, username: user.username } });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Users
app.get('/api/users', async (req, res) => {
    const db = getDB();
    const users = await db.all('SELECT id, username FROM users');
    res.json(users);
});

app.post('/api/users', async (req, res) => {
    const { username, password } = req.body;
    const db = getDB();
    try {
        await db.run('INSERT INTO users (username, password) VALUES (?, ?)', username, password);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: 'User exists or error' });
    }
});

app.delete('/api/users/:id', async (req, res) => {
    const db = getDB();
    await db.run('DELETE FROM users WHERE id = ?', req.params.id);
    res.json({ success: true });
});

// Groups
app.get('/api/groups', async (req, res) => {
    const db = getDB();
    const groups = await db.all('SELECT * FROM groups');
    res.json(groups);
});

app.post('/api/groups', async (req, res) => {
    const { name } = req.body;
    const db = getDB();
    try {
        await db.run('INSERT INTO groups (name) VALUES (?)', name);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: 'Group exists' });
    }
});

// Clients (API)
// Client interface for DB result
interface DBClient {
    id: string;
    hostname: string;
    platform: string;
    group_id: number;
    last_seen: string;
    group_name?: string;
}

app.get('/api/clients', async (req, res) => {
    const db = getDB();
    const clients = await db.all<DBClient[]>(`
        SELECT c.*, g.name as group_name 
        FROM clients c 
        LEFT JOIN groups g ON c.group_id = g.id
    `);
    
    // Merge online status
    const clientsWithStatus = clients.map((c: DBClient) => ({
        ...c,
        status: clientSocketMap[c.id] ? 'online' : 'offline',
        socketId: clientSocketMap[c.id]
    }));
    
    res.json(clientsWithStatus);
});

app.put('/api/clients/:id', async (req, res) => {
    const { hostname, group_id } = req.body;
    const db = getDB();
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
    const db = getDB();
    await db.run('DELETE FROM clients WHERE id = ?', req.params.id);
    notifyAdmins();
    res.json({ success: true });
});

async function notifyAdmins() {
    // Re-fetch all clients and broadcast
    const db = getDB();
    if (!db) return;
    
    const clients = await db.all<DBClient[]>(`
        SELECT c.*, g.name as group_name 
        FROM clients c 
        LEFT JOIN groups g ON c.group_id = g.id
    `);
     const clientsWithStatus = clients.map((c: DBClient) => ({
        ...c,
        status: clientSocketMap[c.id] ? 'online' : 'offline',
        socketId: clientSocketMap[c.id]
    }));
    io.to('admins').emit('client-update', clientsWithStatus);
}


// Socket.io
io.on('connection', (socket) => {
  // Identify as Client (The Remote Machine)
  socket.on('register-client', async (data: { hostname: string, platform: string, id?: string }) => {
    const db = getDB();
    
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
            await db.run('UPDATE clients SET hostname = ?, platform = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?', 
                data.hostname, data.platform, clientId);
        } else {
            // Assign to default group
            const defaultGroup = await db.get('SELECT id FROM groups WHERE name = ?', 'Default');
            await db.run('INSERT INTO clients (id, hostname, platform, group_id, last_seen) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
                clientId, data.hostname, data.platform, defaultGroup.id);
        }
    } catch (e) {
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
  socket.on('offer', (data: { target: string, sdp: any }) => {
      // Target could be Admin Socket ID (if from Client) or Client DB ID
      const targetSocket = clientSocketMap[data.target] || data.target;
      if (targetSocket) {
          console.log(`Relaying offer from ${socket.id} to ${targetSocket}`);
          io.to(targetSocket).emit('offer', { sdp: data.sdp, source: socket.id });
      } else {
          console.warn(`Offer target not found: ${data.target}`);
      }
  });

  socket.on('answer', (data: { target: string, sdp: any }) => {
       // Target is the source of the offer (Socket ID)
       console.log(`Relaying answer from ${socket.id} to ${data.target}`);
       io.to(data.target).emit('answer', { sdp: data.sdp, source: socket.id });
  });

  socket.on('ice-candidate', (data: { target: string, candidate: any }) => {
      // Target could be client ID (if from admin) or admin socket ID (if from client)
      const targetSocket = clientSocketMap[data.target] || data.target;
      if (targetSocket) {
          io.to(targetSocket).emit('ice-candidate', { candidate: data.candidate, source: socket.id });
      }
  });

  // Legacy / Hybrid Input (Forwarding to client)
  socket.on('input', (data: { target: string, type: string, x?: number, y?: number, button?: string, text?: string }) => {
      const targetSocket = clientSocketMap[data.target];
      if (targetSocket) {
          io.to(targetSocket).emit('input', data);
      }
  });

  socket.on('command', (data: { target: string, command: string }) => {
      const targetSocket = clientSocketMap[data.target];
      if (targetSocket) {
          io.to(targetSocket).emit('command', { command: data.command, source: socket.id });
      }
  });

  // Start/Stop Stream (Trigger WebRTC negotiation or fallback)
  socket.on('start-stream', (data: { target: string }) => {
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
    
    const indexHtml = path.join(webBuildPath, 'index.html');
    if (require('fs').existsSync(indexHtml)) {
        res.sendFile(indexHtml);
    } else {
        res.status(404).send('Web client not found. Did you run `npm run build`?');
    }
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
