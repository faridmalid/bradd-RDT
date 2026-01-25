import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { BrowserRouter, Routes, Route, useNavigate, useParams, Link } from 'react-router-dom';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { API_URL, SOCKET_URL } from './config';

const socket = io(SOCKET_URL);
socket.on('connect', () => console.log('Frontend Socket Connected:', socket.id));
socket.on('connect_error', (err) => console.error('Frontend Socket Connection Error:', err));

// --- Types ---
interface Client {
  id: string;
  hostname: string;
  platform: string;
  status: 'online' | 'offline';
  group_id: number;
  group_name: string;
  last_seen: string;
  socketId?: string;
}

interface Group {
    id: number;
    name: string;
}

interface User {
    id: number;
    username: string;
}

interface FileItem {
    name: string;
    isDirectory: boolean;
    size: number;
}

// --- Components ---

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
        const res = await fetch(`${API_URL}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        if (res.ok) {
          localStorage.setItem('bradd_auth', 'true');
          onLogin();
          navigate('/');
        } else {
          alert('Invalid credentials');
        }
    } catch (error) {
        console.error("Login error:", error);
        alert('Connection failed. Please check if the server is running.');
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-gray-100">
      <form onSubmit={handleLogin} className="p-6 bg-white rounded shadow-md w-80">
        <h2 className="mb-4 text-xl font-bold">Login</h2>
        <input className="w-full p-2 mb-2 border rounded" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
        <input className="w-full p-2 mb-4 border rounded" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
        <button className="w-full p-2 text-white bg-blue-500 rounded hover:bg-blue-600">Login</button>
      </form>
    </div>
  );
}

function Sidebar() {
    return (
        <div className="w-64 bg-gray-800 text-white h-screen flex flex-col">
            <div className="p-4 text-xl font-bold border-b border-gray-700">Bradd RDT</div>
            <nav className="flex-1 p-4">
                <Link to="/" className="block py-2 px-4 hover:bg-gray-700 rounded mb-1">Dashboard</Link>
                <Link to="/users" className="block py-2 px-4 hover:bg-gray-700 rounded mb-1">User Management</Link>
                <Link to="/builder" className="block py-2 px-4 hover:bg-gray-700 rounded mb-1">Client Builder</Link>
            </nav>
            <div className="p-4 border-t border-gray-700">
                <button onClick={() => {
                    localStorage.removeItem('bradd_auth');
                    window.location.reload();
                }} className="text-sm text-gray-400 hover:text-white">Logout</button>
            </div>
        </div>
    );
}

function Dashboard() {
  const [clients, setClients] = useState<Client[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const navigate = useNavigate();

  const fetchData = async () => {
       const res = await fetch(`${API_URL}/api/clients`);
       const data = await res.json();
       setClients(data);

       const gRes = await fetch(`${API_URL}/api/groups`);
       const gData = await gRes.json();
       setGroups(gData);
  };

  useEffect(() => {
    fetchData();
    socket.emit('register-admin');
    socket.on('client-update', (list) => {
        // We might need to refetch to get group names correct if just list passed
        // Or updated backend to send full object. Backend sends full object now.
        setClients(list);
    });

    return () => {
      socket.off('client-update');
    };
  }, []);

  const createGroup = async () => {
      if(!newGroupName) return;
      await fetch(`${API_URL}/api/groups`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ name: newGroupName })
      });
      setNewGroupName('');
      fetchData();
  };

  const moveClient = async (clientId: string, groupId: number) => {
      await fetch(`${API_URL}/api/clients/${clientId}`, {
          method: 'PUT',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ group_id: groupId })
      });
      fetchData();
  };
  
  const deleteClient = async (clientId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if(!confirm('Are you sure you want to delete this client?')) return;
      await fetch(`${API_URL}/api/clients/${clientId}`, {
          method: 'DELETE'
      });
      fetchData();
  };
  
  const renameClient = async (clientId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const newName = prompt("Enter new name:");
      if(newName) {
        await fetch(`${API_URL}/api/clients/${clientId}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ hostname: newName })
        });
        fetchData();
      }
  };

  // Group clients by group name
  const groupedClients: Record<string, Client[]> = {};
  groups.forEach(g => groupedClients[g.name] = []);
  clients.forEach(c => {
      const gName = c.group_name || 'Default';
      if(!groupedClients[gName]) groupedClients[gName] = [];
      groupedClients[gName].push(c);
  });

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-auto p-8">
          <div className="flex justify-between items-center mb-6">
              <h1 className="text-3xl font-bold">Dashboard</h1>
              <div className="flex gap-2">
                  <input 
                    className="border p-2 rounded" 
                    placeholder="New Group Name" 
                    value={newGroupName} 
                    onChange={e => setNewGroupName(e.target.value)} 
                  />
                  <button className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600" onClick={createGroup}>Create Group</button>
              </div>
          </div>

          {Object.entries(groupedClients).map(([groupName, groupClients]) => (
              <div key={groupName} className="mb-8">
                  <h2 className="text-xl font-semibold mb-4 text-gray-700 border-b pb-2">{groupName}</h2>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
                    {groupClients.map(client => (
                      <div key={client.id} className="bg-white border rounded-lg shadow-sm hover:shadow-md transition overflow-hidden group relative">
                        <div className="p-4 cursor-pointer" onClick={() => navigate(`/client/${client.id}`)}>
                            <div className="flex items-center mb-2">
                                <div className={`w-3 h-3 rounded-full mr-2 ${client.status === 'online' ? 'bg-green-500' : 'bg-gray-400'}`} />
                                <h3 className="font-bold truncate" title={client.hostname}>{client.hostname}</h3>
                            </div>
                            <p className="text-sm text-gray-500">{client.platform}</p>
                            <p className="text-xs text-gray-400 mt-1 truncate">{client.id}</p>
                        </div>
                        
                        {/* Context Menu / Actions (Visible on hover or via button) */}
                        <div className="bg-gray-50 p-2 border-t flex justify-end gap-2">
                             <select 
                                className="text-xs border rounded p-1"
                                value={client.group_id} 
                                onChange={(e) => moveClient(client.id, Number(e.target.value))}
                                onClick={(e) => e.stopPropagation()}
                             >
                                 {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                             </select>
                             <button className="text-xs text-blue-600 hover:underline" onClick={(e) => renameClient(client.id, e)}>Rename</button>
                             <button className="text-xs text-red-600 hover:underline" onClick={(e) => deleteClient(client.id, e)}>Delete</button>
                        </div>
                      </div>
                    ))}
                    {groupClients.length === 0 && <div className="text-gray-400 text-sm italic p-2">No clients in this group</div>}
                  </div>
              </div>
          ))}
      </div>
    </div>
  );
}

function UserManagement() {
    const [users, setUsers] = useState<User[]>([]);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    const fetchUsers = async () => {
        const res = await fetch(`${API_URL}/api/users`);
        setUsers(await res.json());
    };

    useEffect(() => { fetchUsers(); }, []);

    const addUser = async () => {
        if(!username || !password) return;
        await fetch(`${API_URL}/api/users`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ username, password })
        });
        setUsername('');
        setPassword('');
        fetchUsers();
    };

    const deleteUser = async (id: number) => {
        if(!confirm('Delete user?')) return;
        await fetch(`${API_URL}/api/users/${id}`, { method: 'DELETE' });
        fetchUsers();
    };


    return (
        <div className="flex h-screen bg-gray-100">
            <Sidebar />
            <div className="flex-1 p-8">
                <h1 className="text-3xl font-bold mb-6">User Management</h1>
                
                <div className="bg-white p-6 rounded shadow mb-6 max-w-md">
                    <h3 className="font-bold mb-4">Add User</h3>
                    <div className="flex flex-col gap-3">
                        <input className="border p-2 rounded" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
                        <input className="border p-2 rounded" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
                        <button className="bg-green-500 text-white p-2 rounded" onClick={addUser}>Add User</button>
                    </div>
                </div>

                <div className="bg-white rounded shadow overflow-hidden max-w-2xl">
                    <table className="w-full">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="p-4 text-left">ID</th>
                                <th className="p-4 text-left">Username</th>
                                <th className="p-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(u => (
                                <tr key={u.id} className="border-t">
                                    <td className="p-4">{u.id}</td>
                                    <td className="p-4">{u.username}</td>
                                    <td className="p-4 text-right">
                                        <button className="text-red-500 hover:text-red-700" onClick={() => deleteUser(u.id)}>Delete</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

function Builder() {
    const [name, setName] = useState('bradd-client');
    const [serverUrl, setServerUrl] = useState('');
    const [building, setBuilding] = useState(false);
    const [downloadUrl, setDownloadUrl] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const isDev = import.meta.env.MODE === 'development';
        // In dev, server is usually on 5000. In prod, it's same origin/port.
        const port = isDev ? '5000' : window.location.port;
        const portSuffix = port ? `:${port}` : '';
        setServerUrl(`${protocol}//${hostname}${portSuffix}`);
    }, []);

    const handleBuild = async () => {
        setBuilding(true);
        setError('');
        setDownloadUrl('');
        
        try {
            const res = await fetch(`${API_URL}/api/build`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, serverUrl })
            });
            const data = await res.json();
            if (res.ok) {
                setDownloadUrl(data.downloadUrl);
            } else {
                setError(data.error || 'Build failed');
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setBuilding(false);
        }
    };

    return (
        <div className="flex h-screen bg-gray-100">
            <Sidebar />
            <div className="flex-1 p-8">
                <h1 className="text-3xl font-bold mb-6">Client Builder</h1>
                <div className="bg-white p-6 rounded shadow max-w-2xl">
                    <div className="mb-4">
                        <label className="block mb-2 font-bold">Client Name (Executable Name)</label>
                        <input className="w-full border p-2 rounded" value={name} onChange={e => setName(e.target.value)} />
                    </div>
                    <div className="mb-6">
                        <label className="block mb-2 font-bold">Server URL</label>
                        <input className="w-full border p-2 rounded" value={serverUrl} onChange={e => setServerUrl(e.target.value)} />
                    </div>
                    
                    <button 
                        className={`w-full p-3 text-white rounded font-bold ${building ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
                        onClick={handleBuild}
                        disabled={building}
                    >
                        {building ? 'Building...' : 'Build Client'}
                    </button>

                    {error && <div className="mt-4 p-3 bg-red-100 text-red-700 rounded">{error}</div>}
                    
                    {downloadUrl && (
                        <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded text-center">
                            <p className="mb-2 text-green-800 font-bold">Build Successful!</p>
                            <a href={`${API_URL}${downloadUrl}`} className="inline-block bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 font-bold" target="_blank" rel="noreferrer">
                                Download {name}.exe
                            </a>
                        </div>
                    )}

                    <div className="mt-8 border-t pt-4">
                         <h3 className="font-bold mb-2">Installation</h3>
                         <p className="mb-2 text-sm text-gray-600">
                            1. Download the executable.<br/>
                            2. Run it on the target machine.<br/>
                            3. Ideally place it in <code>%APPDATA%</code> or a permanent location.
                         </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

function TerminalModal({ client, socket, onClose }: { client: Client, socket: any, onClose: () => void }) {
    const termRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);

    useEffect(() => {
        if (!termRef.current) return;

        const term = new Terminal({
            cursorBlink: true,
            theme: {
                background: '#1e1e1e',
                foreground: '#ffffff'
            }
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        
        term.open(termRef.current);
        fitAddon.fit();
        xtermRef.current = term;

        // Start shell on client
        socket.emit('start-term', { target: client.id });

        // Handle input
        term.onData((data) => {
            // Send to server, targeting the client
            // Note: Server expects { target: clientDBId, data: string } for admin->client
            socket.emit('term-data', { target: client.id, data });
        });

        // Handle output
        const handleTermData = (data: { source: string, data: string }) => {
            // Check if data comes from our target client
            // The server broadcasts { source: socketId, data: string } for client->admin
            // We should check if source matches client.socketId
            if (client.socketId && data.source !== client.socketId) return;
            
            term.write(data.data);
        };

        socket.on('term-data', handleTermData);

        // Resize observer
        const resizeObserver = new ResizeObserver(() => {
            try { fitAddon.fit(); } catch(e) {}
        });
        resizeObserver.observe(termRef.current);

        return () => {
            term.dispose();
            socket.off('term-data', handleTermData);
            resizeObserver.disconnect();
        };
    }, [client.id, client.socketId]);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-900 rounded-lg shadow-xl w-3/4 h-3/4 flex flex-col overflow-hidden">
                <div className="flex justify-between items-center p-2 bg-gray-800 border-b border-gray-700">
                    <h3 className="text-white font-bold px-2">Terminal - {client.hostname}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white px-2">✕</button>
                </div>
                <div className="flex-1 p-2 overflow-hidden bg-black" ref={termRef}></div>
            </div>
        </div>
    );
}

function SystemInfoModal({ client, socket, onClose }: { client: Client, socket: any, onClose: () => void }) {
    const [info, setInfo] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        socket.emit('get-sys-info', { target: client.id });
        
        const handleInfo = (data: { data: any, source: string }) => {
             setInfo(data.data);
             setLoading(false);
        };
        
        socket.on('sys-info', handleInfo);
        return () => { socket.off('sys-info', handleInfo); };
    }, [client.id]);

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-1/2 max-h-[80vh] flex flex-col overflow-hidden">
                <div className="flex justify-between items-center p-4 border-b">
                    <h3 className="text-xl font-bold">System Information - {client.hostname}</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-black text-xl">✕</button>
                </div>
                <div className="flex-1 p-6 overflow-auto">
                    {loading ? (
                        <div className="text-center p-4">Loading system info...</div>
                    ) : info ? (
                        <div className="space-y-6">
                            <div>
                                <h4 className="font-bold text-gray-700 border-b pb-1 mb-2">Operating System</h4>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="text-gray-600">Platform:</div>
                                    <div>{info.osInfo.platform} ({info.osInfo.distro} {info.osInfo.release})</div>
                                    <div className="text-gray-600">Architecture:</div>
                                    <div>{info.osInfo.arch}</div>
                                    <div className="text-gray-600">Hostname:</div>
                                    <div>{info.osInfo.hostname}</div>
                                </div>
                            </div>
                            
                            <div>
                                <h4 className="font-bold text-gray-700 border-b pb-1 mb-2">CPU</h4>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="text-gray-600">Manufacturer:</div>
                                    <div>{info.cpu.manufacturer}</div>
                                    <div className="text-gray-600">Brand:</div>
                                    <div>{info.cpu.brand}</div>
                                    <div className="text-gray-600">Cores:</div>
                                    <div>{info.cpu.cores} ({info.cpu.physicalCores} Physical)</div>
                                    <div className="text-gray-600">Speed:</div>
                                    <div>{info.cpu.speed} GHz</div>
                                </div>
                            </div>

                            <div>
                                <h4 className="font-bold text-gray-700 border-b pb-1 mb-2">Memory</h4>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="text-gray-600">Total:</div>
                                    <div>{formatBytes(info.mem.total)}</div>
                                    <div className="text-gray-600">Free:</div>
                                    <div>{formatBytes(info.mem.free)}</div>
                                    <div className="text-gray-600">Used:</div>
                                    <div>{formatBytes(info.mem.used)}</div>
                                </div>
                            </div>

                            <div>
                                <h4 className="font-bold text-gray-700 border-b pb-1 mb-2">Storage</h4>
                                {info.disk.map((d: any, i: number) => (
                                    <div key={i} className="mb-2 p-2 bg-gray-50 rounded">
                                        <div className="font-semibold">{d.fs} ({d.type})</div>
                                        <div className="text-sm">Mount: {d.mount}</div>
                                        <div className="text-sm">
                                            {formatBytes(d.used)} / {formatBytes(d.size)} ({(d.use || 0).toFixed(1)}%)
                                        </div>
                                        <div className="w-full bg-gray-200 rounded-full h-2.5 mt-1">
                                            <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${d.use}%` }}></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-red-500">Failed to load system info.</div>
                    )}
                </div>
            </div>
        </div>
    );
}

function FileManagerModal({ client, socket, onClose }: { client: Client, socket: any, onClose: () => void }) {
    const [path, setPath] = useState('');
    const [files, setFiles] = useState<FileItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchFiles = (dirPath?: string) => {
        setLoading(true);
        setError('');
        socket.emit('fs-list', { target: client.id, path: dirPath });
    };

    useEffect(() => {
        fetchFiles();

        const handleList = (data: { path: string, files: FileItem[] }) => {
            setPath(data.path);
            setFiles(data.files.sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;
                return a.name.localeCompare(b.name);
            }));
            setLoading(false);
        };

        const handleFile = (data: { name: string, data: ArrayBuffer }) => {
             const blob = new Blob([data.data]);
             const url = window.URL.createObjectURL(blob);
             const a = document.createElement('a');
             a.href = url;
             a.download = data.name;
             document.body.appendChild(a);
             a.click();
             window.URL.revokeObjectURL(url);
             document.body.removeChild(a);
        };

        const handleError = (data: { error: string }) => {
            setError(data.error);
            setLoading(false);
        };

        socket.on('fs-list-result', handleList);
        socket.on('fs-file', handleFile);
        socket.on('fs-error', handleError);

        return () => {
            socket.off('fs-list-result', handleList);
            socket.off('fs-file', handleFile);
            socket.off('fs-error', handleError);
        };
    }, [client.id]);

    const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (evt) => {
                if (evt.target?.result) {
                    // Normalize path separator for target OS (assume Windows for now or use / which works mostly)
                    // Better: construct path on client side or send dir + filename
                    // Sending full path for now.
                    const sep = path.includes('\\') ? '\\' : '/';
                    const targetPath = path.endsWith(sep) ? path + file.name : path + sep + file.name;
                    
                    socket.emit('fs-write', { 
                        target: client.id, 
                        path: targetPath, 
                        data: evt.target.result 
                    });
                    
                    // Optimistic refresh
                    setTimeout(() => fetchFiles(path), 1000);
                }
            };
            reader.readAsArrayBuffer(file);
        }
    };

    const goUp = () => {
        // Simple string manipulation for parent dir
        const sep = path.includes('\\') ? '\\' : '/';
        const parts = path.split(sep).filter(p => p);
        if (parts.length > 0) parts.pop();
        const newPath = parts.join(sep) || (sep === '\\' ? 'C:\\' : '/');
        // Handle C: vs C:\ issue
        const finalPath = newPath.endsWith(':') ? newPath + sep : newPath;
        fetchFiles(finalPath);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-3/4 h-3/4 flex flex-col overflow-hidden">
                <div className="flex justify-between items-center p-3 border-b bg-gray-50">
                    <h3 className="text-lg font-bold">File Manager</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-black px-2">✕</button>
                </div>
                
                <div className="p-3 border-b bg-gray-100 flex gap-2 items-center">
                    <button onClick={goUp} className="px-3 py-1 bg-white border rounded hover:bg-gray-200">↑ Up</button>
                    <input 
                        className="flex-1 border p-1 rounded px-2" 
                        value={path} 
                        readOnly // Editable later maybe
                    />
                    <button 
                        className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        Upload
                    </button>
                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleUpload} />
                </div>

                <div className="flex-1 overflow-auto p-2">
                    {loading && <div className="text-center p-4">Loading...</div>}
                    {error && <div className="text-red-500 p-2 border border-red-200 bg-red-50 rounded mb-2">{error}</div>}
                    
                    <div className="grid grid-cols-1 gap-1">
                        {!loading && files.map((f, i) => (
                            <div 
                                key={i} 
                                className="flex items-center p-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100"
                                onClick={() => {
                                    if (f.isDirectory) {
                                        const sep = path.includes('\\') ? '\\' : '/';
                                        const newPath = path.endsWith(sep) ? path + f.name : path + sep + f.name;
                                        fetchFiles(newPath);
                                    } else {
                                        const sep = path.includes('\\') ? '\\' : '/';
                                        const filePath = path.endsWith(sep) ? path + f.name : path + sep + f.name;
                                        socket.emit('fs-read', { target: client.id, path: filePath });
                                    }
                                }}
                            >
                                <span className="mr-3 text-2xl text-yellow-500">{f.isDirectory ? '📁' : '📄'}</span>
                                <span className="flex-1 font-medium">{f.name}</span>
                                <span className="text-sm text-gray-500">
                                    {f.isDirectory ? '' : (f.size > 1024 * 1024 ? (f.size / 1024 / 1024).toFixed(1) + ' MB' : (f.size / 1024).toFixed(1) + ' KB')}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function ClientView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const imgRef = useRef<HTMLImageElement>(null);
  const [loading, setLoading] = useState(true);
  const [fitToScreen, setFitToScreen] = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showSysInfo, setShowSysInfo] = useState(false);
  const [showFileManager, setShowFileManager] = useState(false);
  const [clientInfo, setClientInfo] = useState<Client | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const candidatesQueue = useRef<RTCIceCandidate[]>([]);

  // Fetch client info for socketId
  useEffect(() => {
      fetch(`${API_URL}/api/clients`)
        .then(res => res.json())
        .then((data: Client[]) => {
            const c = data.find(c => c.id === id);
            if (c) setClientInfo(c);
        });
  }, [id]);

  useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
             if (!id) return;
             e.preventDefault();
             socket.emit('input', { target: id, type: 'keydown', keyCode: e.keyCode });
        };

        const onKeyUp = (e: KeyboardEvent) => {
             if (!id) return;
             e.preventDefault();
             socket.emit('input', { target: id, type: 'keyup', keyCode: e.keyCode });
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, [id]);

    useEffect(() => {
    const startStream = () => {
        console.log('ClientView: Requesting stream');
        socket.emit('start-stream', { target: id });
    };

    if (socket.connected) startStream();
    socket.on('connect', startStream);

    const onOffer = async (data: { sdp: any, source: string }) => {
         console.log('Received offer from', data.source);
         if (pcRef.current) pcRef.current.close();
         
         const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
         pcRef.current = pc;

         pc.onicecandidate = (event) => {
             if (event.candidate) {
                 socket.emit('ice-candidate', { target: data.source, candidate: event.candidate });
             }
         };

         pc.ondatachannel = (event) => {
             const dc = event.channel;
             console.log('Received DataChannel', dc.label);
             dc.onmessage = (msg) => {
                 if (imgRef.current) {
                     const blob = new Blob([msg.data], { type: 'image/jpeg' });
                     const url = URL.createObjectURL(blob);
                     if (imgRef.current.src.startsWith('blob:')) {
                         URL.revokeObjectURL(imgRef.current.src);
                     }
                     imgRef.current.src = url;
                     setLoading(false);
                 }
            };
        };

         try {
             await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
             
             // Process queued candidates
             while (candidatesQueue.current.length > 0) {
                 const cand = candidatesQueue.current.shift();
                 if (cand) {
                     console.log('Adding queued candidate');
                     await pc.addIceCandidate(cand);
                 }
             }

             const answer = await pc.createAnswer();
             await pc.setLocalDescription(answer);
             socket.emit('answer', { target: data.source, sdp: answer });
         } catch (e) {
             console.error('Error handling offer:', e);
         }
    };

    const onCandidate = async (data: { candidate: any }) => {
        const candidate = new RTCIceCandidate(data.candidate);
        if (pcRef.current && pcRef.current.remoteDescription) {
            try {
                await pcRef.current.addIceCandidate(candidate);
            } catch (e) {
                console.error('Error adding candidate', e);
            }
        } else {
            console.log('Queueing candidate (remote desc not ready)');
            candidatesQueue.current.push(candidate);
        }
    };

    socket.on('offer', onOffer);
    socket.on('ice-candidate', onCandidate);

    return () => {
      socket.off('connect', startStream);
      socket.off('offer', onOffer);
      socket.off('ice-candidate', onCandidate);
      socket.emit('stop-stream', { target: id });
      if (pcRef.current) {
          pcRef.current.close();
          pcRef.current = null;
      }
    };
  }, [id]);

  const getNormalizedCoords = (e: React.MouseEvent) => {
      if (!imgRef.current) return null;
      
      const img = imgRef.current;
      const rect = img.getBoundingClientRect();
      
      let displayedWidth = rect.width;
      let displayedHeight = rect.height;
      let offsetX = 0;
      let offsetY = 0;

      if (fitToScreen && img.naturalWidth && img.naturalHeight) {
          const ratio = img.naturalWidth / img.naturalHeight;
          const containerRatio = rect.width / rect.height;

          if (ratio > containerRatio) {
              displayedWidth = rect.width;
              displayedHeight = rect.width / ratio;
              offsetY = (rect.height - displayedHeight) / 2;
          } else {
              displayedHeight = rect.height;
              displayedWidth = rect.height * ratio;
              offsetX = (rect.width - displayedWidth) / 2;
          }
      }

      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      if (
          clientX < offsetX || 
          clientX > offsetX + displayedWidth || 
          clientY < offsetY || 
          clientY > offsetY + displayedHeight
      ) {
          return null;
      }

      const x = (clientX - offsetX) / displayedWidth;
      const y = (clientY - offsetY) / displayedHeight;
      return { x, y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      const coords = getNormalizedCoords(e);
      if (coords) {
          socket.emit('input', { target: id, type: 'move', x: coords.x, y: coords.y });
      }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
      const coords = getNormalizedCoords(e);
      if (!coords) return;
      
      const button = e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'left';
      
      // Send move first to ensure we are at correct start position
      socket.emit('input', { target: id, type: 'move', x: coords.x, y: coords.y });
      socket.emit('input', { target: id, type: 'mousedown', button });
  };
  
  const handleMouseUp = (e: React.MouseEvent) => {
      const button = e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'left';
      socket.emit('input', { target: id, type: 'mouseup', button });
  };

  const handleContextMenu = (e: React.MouseEvent) => {
      e.preventDefault();
  };

  const handleWheel = (e: React.WheelEvent) => {
      // Prevent default scrolling of the page
      // Note: React's synthetic event might happen after default? 
      // It's better to prevent default on the container if possible, but let's try here.
      // e.preventDefault(); // React synthetic events might not support this for passive listeners
      
      const amount = e.deltaY > 0 ? -120 : 120;
      socket.emit('input', { target: id, type: 'scroll', amount });
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
      e.preventDefault();
      let text = e.key;
      const keyMap: {[key: string]: string} = {
          'Enter': '{ENTER}',
          'Backspace': '{BACKSPACE}',
          'Tab': '{TAB}',
          'Escape': '{ESC}',
          'ArrowUp': '{UP}',
          'ArrowDown': '{DOWN}',
          'ArrowLeft': '{LEFT}',
          'ArrowRight': '{RIGHT}',
          'Delete': '{DELETE}',
          'Home': '{HOME}',
          'End': '{END}',
          'PageUp': '{PGUP}',
          'PageDown': '{PGDN}'
      };

      if (keyMap[text]) {
          text = keyMap[text];
      } else if (text.length > 1) {
          return; // Ignore unmapped special keys
      } else {
          // Escape special characters for SendKeys
          if (['+', '^', '%', '~', '(', ')', '{', '}', '[', ']'].includes(text)) {
              text = '{' + text + '}';
          }
      }

      socket.emit('input', { target: id, type: 'type', text });
  };

  return (
    <div className="flex flex-col h-screen bg-black" onKeyDown={handleKeyDown} tabIndex={0}>
      <div className="bg-gray-800 p-2 flex justify-between items-center text-white">
          <div className="flex items-center gap-4">
            <button className="hover:bg-gray-700 p-2 rounded" onClick={() => navigate('/')}>← Back</button>
            <span className="font-bold">{clientInfo?.hostname || id}</span>
          </div>
          <div className="flex items-center gap-4">
             <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={fitToScreen} onChange={e => setFitToScreen(e.target.checked)} />
                Fit to Screen
             </label>
             <button 
                className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded border border-gray-600"
                onClick={() => setShowTerminal(true)}
             >
                &gt;_ Shell
             </button>
             <button 
                className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded border border-gray-600"
                onClick={() => setShowSysInfo(true)}
             >
                ℹ Info
             </button>
             <button 
                className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded border border-gray-600"
                onClick={() => setShowFileManager(true)}
             >
                📁 Files
             </button>
             <span className={`w-3 h-3 rounded-full ${loading ? 'bg-red-500' : 'bg-green-500'}`} title={loading ? 'Disconnected/Loading' : 'Connected'} />
          </div>
      </div>
      
      <div className="flex-1 bg-gray-900 relative overflow-hidden flex items-center justify-center">
         {loading && <div className="text-white">Waiting for stream...</div>}
         <img 
            ref={imgRef} 
            className="max-w-full max-h-full"
            style={{ 
                objectFit: fitToScreen ? 'contain' : 'none',
                width: fitToScreen ? '100%' : 'auto',
                height: fitToScreen ? '100%' : 'auto'
            }}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onContextMenu={handleContextMenu}
            onWheel={handleWheel}
         />
      </div>

      {showTerminal && clientInfo && (
          <TerminalModal 
            client={clientInfo} 
            socket={socket} 
            onClose={() => setShowTerminal(false)} 
          />
      )}
      
      {showSysInfo && clientInfo && (
          <SystemInfoModal 
            client={clientInfo} 
            socket={socket} 
            onClose={() => setShowSysInfo(false)} 
          />
      )}

      {showFileManager && clientInfo && (
          <FileManagerModal 
            client={clientInfo} 
            socket={socket} 
            onClose={() => setShowFileManager(false)} 
          />
      )}
    </div>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
      return localStorage.getItem('bradd_auth') === 'true';
  });

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login onLogin={() => setIsAuthenticated(true)} />} />
        <Route path="/" element={isAuthenticated ? <Dashboard /> : <Login onLogin={() => setIsAuthenticated(true)} />} />
        <Route path="/users" element={isAuthenticated ? <UserManagement /> : <Login onLogin={() => setIsAuthenticated(true)} />} />
        <Route path="/builder" element={isAuthenticated ? <Builder /> : <Login onLogin={() => setIsAuthenticated(true)} />} />
        <Route path="/client/:id" element={isAuthenticated ? <ClientView /> : <Login onLogin={() => setIsAuthenticated(true)} />} />
      </Routes>
    </BrowserRouter>
  );
}
