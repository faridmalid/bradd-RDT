import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { BrowserRouter, Routes, Route, useNavigate, useParams, Link } from 'react-router-dom';
import { API_URL, SOCKET_URL } from './config';

const socket = io(SOCKET_URL);

// --- Types ---
interface Client {
  id: string;
  hostname: string;
  platform: string;
  status: 'online' | 'offline';
  group_id: number;
  group_name: string;
  last_seen: string;
}

interface Group {
    id: number;
    name: string;
}

interface User {
    id: number;
    username: string;
}

// --- Components ---

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${API_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (res.ok) {
      onLogin();
      navigate('/');
    } else {
      alert('Invalid credentials');
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
                <button onClick={() => window.location.reload()} className="text-sm text-gray-400 hover:text-white">Logout</button>
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
    const [serverUrl, setServerUrl] = useState('http://localhost:3000');
    const [building, setBuilding] = useState(false);
    const [downloadUrl, setDownloadUrl] = useState('');
    const [error, setError] = useState('');

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

function ClientView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const imgRef = useRef<HTMLImageElement>(null);
  const [loading, setLoading] = useState(true);
  const [fitToScreen, setFitToScreen] = useState(true);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const candidatesQueue = useRef<RTCIceCandidate[]>([]);

  useEffect(() => {
    // Request stream
    socket.emit('start-stream', { target: id });

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
      socket.off('offer', onOffer);
      socket.off('ice-candidate', onCandidate);
      socket.emit('stop-stream', { target: id });
      if (pcRef.current) {
          pcRef.current.close();
          pcRef.current = null;
      }
    };
  }, [id]);

  const handleMouseDown = (e: React.MouseEvent) => {
      if (!imgRef.current) return;
      const rect = imgRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      
      const button = e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'left';
      
      socket.emit('input', { target: id, type: 'click', button, x, y });
  };

  const handleContextMenu = (e: React.MouseEvent) => {
      e.preventDefault();
  };

  const handleWheel = (e: React.WheelEvent) => {
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
      <div className="p-2 text-white bg-gray-800 flex justify-between items-center">
          <div className="flex items-center">
             <button className="mr-4 text-gray-300 hover:text-white" onClick={() => navigate('/')}>&larr; Back</button>
             <span>Connected to {id}</span>
             <label className="ml-4 flex items-center cursor-pointer text-sm text-gray-300">
                <input 
                    type="checkbox" 
                    checked={fitToScreen} 
                    onChange={e => setFitToScreen(e.target.checked)} 
                    className="mr-2"
                />
                Fit to Screen
             </label>
          </div>
          <div>
            <button className="bg-gray-600 px-3 py-1 rounded mr-2" onClick={() => {
                const cmd = prompt("Enter shell command:");
                if(cmd) socket.emit('command', { target: id, command: cmd });
            }}>Shell</button>
            <button className="bg-red-500 px-3 py-1 rounded" onClick={() => {
                if(confirm("Uninstall client?")) {
                    socket.emit('command', { target: id, command: 'uninstall' });
                    alert('Uninstall command sent');
                }
            }}>Uninstall</button>
          </div>
      </div>
      <div className="flex-1 overflow-auto flex justify-center items-center relative bg-gray-900">
        {loading && <div className="text-white absolute">Waiting for stream (WebRTC)...</div>}
        <img 
            ref={imgRef} 
            className={`cursor-crosshair ${fitToScreen ? 'max-w-full max-h-full object-contain' : 'max-w-none'}`}
            onMouseDown={handleMouseDown}
            onContextMenu={handleContextMenu}
            onWheel={handleWheel}
            alt="Remote Desktop" 
            style={{ display: loading ? 'none' : 'block' }}
        />
      </div>
    </div>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

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
