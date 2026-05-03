// ===== Network Services: SSH, Samba, FTP/SFTP, WebDAV =====

const Icon = window.Icon;
const Network = window.Network;

const inputSt = {
  background:'var(--bg-2)', border:'1px solid var(--line-strong)', borderRadius:5,
  padding:'5px 10px', color:'var(--fg)', fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)',
  outline:'none', width:'100%'
};

// ---- SSH ----
const SshService = () => {
  const [running, setRunning] = React.useState(false);
  const [port, setPort] = React.useState('22');
  const [passAuth, setPassAuth] = React.useState(false);
  const [rootLogin, setRootLogin] = React.useState(false);
  const [sftp, setSftp] = React.useState(true);
  const [x11, setX11] = React.useState(false);
  const [keys, setKeys] = React.useState([]);
  const [sessions, setSessions] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [showAddKey, setShowAddKey] = React.useState(false);
  const [newKey, setNewKey] = React.useState('');

  // Ładuj dane z API
  React.useEffect(() => {
    const load = async () => {
      try {
        const [statusR, keysR, connR] = await Promise.all([
          fetch('/services/ssh/status', {credentials:'include'}),
          fetch('/services/ssh/keys', {credentials:'include'}),
          fetch('/services/ssh/connections', {credentials:'include'}),
        ]);
        
        if (statusR.ok) {
          const d = await statusR.json();
          setRunning(d.active);
          setPort(d.port || '22');
          setPassAuth(d.password_auth);
          setRootLogin(d.root_login);
          setSftp(d.sftp_enabled);
          setX11(d.x11_forwarding);
        }
        
        if (keysR.ok) {
          const d = await keysR.json();
          setKeys(d.keys || []);
        }
        
        if (connR.ok) {
          const d = await connR.json();
          // Mapuj dane z API na format oczekiwany przez UI
          const mapped = (d.connections || []).map(conn => ({
            user: conn.user,
            ip: conn.ip,
            since: conn.since || '—',
            cmd: conn.user === 'root' ? 'bash' : 'sshd',
            pid: conn.pid
          }));
          setSessions(mapped);
        }
      } catch(e) {
        console.error('SSH load error:', e);
      } finally {
        setLoading(false);
      }
    };
    
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  const toggleService = async (enable) => {
    await fetch('/services/ssh/toggle', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({enable}),
    });
    setRunning(enable);
  };

  const saveConfig = async (field, value) => {
    await fetch('/services/ssh/config', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({[field]: value}),
    });
  };

  const addKey = async () => {
    if (!newKey.trim()) return;
    await fetch('/services/ssh/keys', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({user: 'root', key: newKey.trim()}),
    });
    setNewKey('');
    setShowAddKey(false);
    const r = await fetch('/services/ssh/keys', {credentials:'include'});
    if (r.ok) setKeys((await r.json()).keys || []);
  };

  const deleteKey = async (key) => {
    await fetch('/services/ssh/keys/delete', {
      method: 'DELETE',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({user: key.user, key_prefix: key.raw.substring(0, 20)}),
    });
    setKeys(prev => prev.filter(k => k.raw !== key.raw));
  };

  const killSession = async (pid) => {
    if (!confirm('Zakończyć tę sesję SSH?')) return;
    await fetch('/api/storage/exec-command', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({command: `kill ${pid}`}),
    });
    setSessions(prev => prev.filter(s => s.pid !== pid));
  };

  if (loading) return <div className="card"><div style={{padding:40,textAlign:'center'}}>Ładowanie...</div></div>;

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="grid grid-4">
        <div className="kpi">
          <div className="kpi-label">STATUS</div>
          <div className="kpi-value" style={{fontSize:20,color:running?'var(--ok)':'var(--fg-dim)'}}>{running?'ONLINE':'STOPPED'}</div>
          <div className="kpi-foot"><span>port {port}/tcp</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">SESJE</div>
          <div className="kpi-value" style={{color:'var(--accent)'}}>{sessions.length}</div>
          <div className="kpi-foot"><span>aktywne połączenia</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">KLUCZE</div>
          <div className="kpi-value">{keys.length}</div>
          <div className="kpi-foot"><span>authorized_keys</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">FAIL2BAN</div>
          <div className="kpi-value" style={{fontSize:20,color:'var(--ok)'}}>OK</div>
          <div className="kpi-foot"><span>aktywny</span></div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Konfiguracja SSHD</div><div className="card-sub">/etc/ssh/sshd_config</div></div>
            <div className="card-actions">
              <span className="dim" style={{fontSize:'var(--fs-xs)',color:'var(--fg-muted)'}}>usługa</span>
              <div className={"toggle "+(running?'on':'')} onClick={()=>toggleService(!running)}/>
            </div>
          </div>
          <div className="card-body col" style={{gap:12}}>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Port</div>
              <input style={{...inputSt,width:120}} value={port} onChange={e=>{setPort(e.target.value);saveConfig('port', e.target.value);}}/>
            </div>
            <hr className="div"/>
            <div className="row" style={{justifyContent:'space-between'}}>
              <div>
                <div style={{fontWeight:500}}>Uwierzytelnianie hasłem</div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>PasswordAuthentication</div>
              </div>
              <div className={"toggle "+(passAuth?'on':'')} onClick={()=>{setPassAuth(v=>!v);saveConfig('password_auth', !passAuth);}}/>
            </div>
            <div className="row" style={{justifyContent:'space-between'}}>
              <div>
                <div style={{fontWeight:500}}>Login jako root</div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>PermitRootLogin</div>
              </div>
              <div className={"toggle "+(rootLogin?'on':'')} onClick={()=>{setRootLogin(v=>!v);saveConfig('root_login', !rootLogin);}}/>
            </div>
            <div className="row" style={{justifyContent:'space-between'}}>
              <div>
                <div style={{fontWeight:500}}>Podsystem SFTP</div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>Subsystem sftp</div>
              </div>
              <div className={"toggle "+(sftp?'on':'')} onClick={()=>{setSftp(v=>!v);saveConfig('sftp_enabled', !sftp);}}/>
            </div>
            <div className="row" style={{justifyContent:'space-between'}}>
              <div>
                <div style={{fontWeight:500}}>Przekierowanie X11</div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>X11Forwarding</div>
              </div>
              <div className={"toggle "+(x11?'on':'')} onClick={()=>{setX11(v=>!v);saveConfig('x11_forwarding', !x11);}}/>
            </div>
          </div>
        </div>

        <div className="col" style={{gap:'var(--gutter)'}}>
          <div className="card">
            <div className="card-head">
              <div><div className="card-title">Klucze publiczne</div></div>
              <div className="card-actions">
                <button className="btn sm" onClick={()=>setShowAddKey(s=>!s)}><Icon name="plus" size={12}/> Dodaj klucz</button>
              </div>
            </div>
            <div className="card-body col" style={{gap:8}}>
              {showAddKey && (
                <div style={{marginBottom:4}}>
                  <textarea style={{...inputSt,height:60,resize:'vertical',fontFamily:'var(--font-mono)',fontSize:10}}
                    placeholder="ssh-ed25519 AAAA… user@host"
                    value={newKey} onChange={e=>setNewKey(e.target.value)}/>
                  <div className="row gap-sm" style={{marginTop:6}}>
                    <button className="btn sm primary" onClick={addKey}>Dodaj</button>
                    <button className="btn sm" onClick={()=>setShowAddKey(false)}>Anuluj</button>
                  </div>
                </div>
              )}
              {keys.map((k,i) => (
                <div key={i} className="row" style={{padding:'10px 12px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:6,gap:10}}>
                  <Icon name="key" size={15} style={{color:'var(--accent)',flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:500}}>{k.user} <span className="chip" style={{marginLeft:4}}>{k.type}</span></div>
                    <div className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{k.fingerprint}</div>
                  </div>
                  <button className="icon-btn" onClick={()=>deleteKey(k)}><Icon name="trash" size={13}/></button>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Aktywne sesje SSH</div></div>
            {sessions.length === 0
              ? <div style={{padding:'20px',textAlign:'center',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>Brak aktywnych sesji</div>
              : <table className="table">
                  <thead><tr><th>Użytkownik</th><th>Adres</th><th>Czas</th><th>Polecenie</th><th></th></tr></thead>
                  <tbody>
                    {sessions.map((s,i) => (
                      <tr key={i}>
                        <td style={{fontWeight:500}}>{s.user}</td>
                        <td className="mono">{s.ip}</td>
                        <td className="mono dim">{s.since}</td>
                        <td className="mono dim">{s.cmd}</td>
                        <td><button className="btn sm danger" onClick={()=>killSession(s.pid)}><Icon name="close" size={11}/> Kill</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            }
          </div>
        </div>
      </div>
    </div>
  );
};

// ---- Samba ----
const SambaService = () => {
  const [running, setRunning] = React.useState(false);
  const [workgroup, setWorkgroup] = React.useState('WORKGROUP');
  const [netbios, setNetbios] = React.useState('NIMBUS');
  const [guestOk, setGuestOk] = React.useState(false);
  const [shares, setShares] = React.useState([]);
  const [connections, setConnections] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [showAdd, setShowAdd] = React.useState(false);
  const [usersList, setUsersList] = React.useState([]);
  const [groupsList, setGroupsList] = React.useState([]);
  const [presets, setPresets] = React.useState(['wszyscy']);
  const [form, setForm] = React.useState({
    name: '', 
    path: '/mnt/', 
    access: 'wszyscy', 
    rw: true, 
    browseable: true
  });
  const [accessInput, setAccessInput] = React.useState('');
  const [showAccessDropdown, setShowAccessDropdown] = React.useState(false);

  // Ładuj dane z API
  React.useEffect(() => {
    const load = async () => {
      try {
        const [statusR, sharesR, connR, usersR] = await Promise.all([
          fetch('/services/samba/status', {credentials:'include'}),
          fetch('/services/samba/shares', {credentials:'include'}),
          fetch('/services/samba/connections', {credentials:'include'}),
          fetch('/services/samba/users-list', {credentials:'include'}),
        ]);
        
        if (statusR.ok) {
          const d = await statusR.json();
          setRunning(d.active);
          if (d.workgroup) setWorkgroup(d.workgroup);
          if (d.netbios_name) setNetbios(d.netbios_name);
          if (d.guest_ok !== undefined) setGuestOk(d.guest_ok);
        }
        
        if (sharesR.ok) {
          const d = await sharesR.json();
          if (d.shares && d.shares.length > 0) {
            setShares(d.shares.map(s => ({
              name: s.name,
              path: s.path || '/mnt/',
              access: s.valid_users || 'wszyscy',
              rw: !s.read_only,
              browseable: s.browseable !== false,
              clients: 0
            })));
          }
        }
        
        if (usersR.ok) {
          const d = await usersR.json();
          setUsersList(d.users || []);
          setGroupsList(d.groups || []);
          setPresets(d.presets || ['wszyscy']);
        }
        
        if (connR.ok) {
          const d = await connR.json();
          setConnections(d.connections || []);
        }
      } catch(e) {
        console.error('Samba load error:', e);
      } finally {
        setLoading(false);
      }
    };
    
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  const addAccessItem = (item) => {
    const currentAccess = form.access.split(',').map(s => s.trim()).filter(Boolean);
    if (!currentAccess.includes(item)) {
      const newAccess = [...currentAccess, item].join(', ');
      setForm(f => ({...f, access: newAccess}));
    }
    setAccessInput('');
    setShowAccessDropdown(false);
  };
  
  const removeAccessItem = (item) => {
    const currentAccess = form.access.split(',').map(s => s.trim()).filter(Boolean);
    const newAccess = currentAccess.filter(i => i !== item).join(', ');
    setForm(f => ({...f, access: newAccess}));
  };
  
  const filteredAccessItems = [
    ...presets.map(p => ({name: p, type: 'preset'})),
    ...usersList.map(u => ({name: u.username, type: 'user', fullname: u.fullname})),
    ...groupsList.map(g => ({name: '@' + g.groupname, type: 'group'})),
  ].filter(item => 
    !accessInput || 
    item.name.toLowerCase().includes(accessInput.toLowerCase())
  ).slice(0, 10);

  const toggleSamba = async () => {
    await fetch('/services/samba/toggle', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({enable: !running}),
    });
    setRunning(!running);
  };

  const saveSettings = async () => {
    await fetch('/services/samba/settings', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({workgroup, netbios, guest_ok: guestOk}),
    });
  };

  const addShare = async () => {
    if (!form.name || !form.path) return;
    await fetch('/services/samba/shares/' + encodeURIComponent(form.name), {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        path: form.path,
        browseable: form.browseable,
        read_only: !form.rw,
        valid_users: form.access,
        guest_ok: false,
      }),
    });
    setShowAdd(false);
    setForm({name:'', path:'/mnt/', access:'wszyscy', rw:true, browseable:true});
    // Odśwież
    const r = await fetch('/services/samba/shares', {credentials:'include'});
    if (r.ok) {
      const d = await r.json();
      if (d.shares) {
        setShares(d.shares.map(s => ({
          name: s.name, path: s.path || '/mnt/', access: s.valid_users || 'wszyscy',
          rw: !s.read_only, browseable: s.browseable !== false, clients: 0
        })));
      }
    }
  };

  const deleteShare = async (name) => {
    if (!confirm('Usunąć udział ' + name + '?')) return;
    await fetch('/services/samba/shares/' + encodeURIComponent(name), {
      method: 'DELETE',
      credentials: 'include',
    });
    setShares(prev => prev.filter(s => s.name !== name));
  };

  if (loading) {
    return <div className="card" style={{padding:40, textAlign:'center'}}>
      <span className="dot pulse" style={{display:'inline-block',marginRight:8}}/>
      Ładowanie konfiguracji Samby...
    </div>;
  }

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="grid grid-4">
        <div className="kpi">
          <div className="kpi-label">STATUS</div>
          <div className="kpi-value" style={{fontSize:20,color:running?'var(--ok)':'var(--fg-dim)'}}>{running?'ONLINE':'STOPPED'}</div>
          <div className="kpi-foot"><span>SMB · port 445</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">UDZIAŁY</div>
          <div className="kpi-value">{shares.length}</div>
          <div className="kpi-foot"><span>skonfigurowane</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">KLIENCI</div>
          <div className="kpi-value" style={{color:'var(--accent)'}}>{connections.length}</div>
          <div className="kpi-foot"><span>aktywne połączenia</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">PROTOKÓŁ</div>
          <div className="kpi-value" style={{fontSize:18}}>SMB3</div>
          <div className="kpi-foot"><span>szyfrowanie AES-128</span></div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Konfiguracja globalna</div><div className="card-sub">/etc/samba/smb.conf · [global]</div></div>
            <div className="card-actions">
              <span className="dim" style={{fontSize:'var(--fs-xs)',color:'var(--fg-muted)'}}>usługa</span>
              <div className={"toggle "+(running?'on':'')} onClick={toggleSamba}/>
            </div>
          </div>
          <div className="card-body col" style={{gap:12}}>
            <div className="grid" style={{gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Workgroup</div>
                <input style={inputSt} value={workgroup} onChange={e=>setWorkgroup(e.target.value)} onBlur={saveSettings}/>
              </div>
              <div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>NetBIOS name</div>
                <input style={inputSt} value={netbios} onChange={e=>setNetbios(e.target.value)} onBlur={saveSettings}/>
              </div>
            </div>
            <hr className="div"/>
            <div className="row" style={{justifyContent:'space-between'}}>
              <div>
                <div style={{fontWeight:500}}>Dostęp gościa</div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>map to guest = bad user</div>
              </div>
              <div className={"toggle "+(guestOk?'on':'')} onClick={()=>{setGuestOk(!guestOk);}}/>
            </div>
            <hr className="div"/>
            <div style={{background:'var(--bg-2)',borderRadius:6,padding:'10px 12px',fontFamily:'var(--font-mono)',fontSize:'var(--fs-xs)',color:'var(--fg-muted)',lineHeight:1.7}}>
              <div>server min protocol = <span style={{color:'var(--fg)'}}>SMB2</span></div>
              <div>server signing = <span style={{color:'var(--ok)'}}>mandatory</span></div>
              <div>smb encrypt = <span style={{color:'var(--ok)'}}>required</span></div>
              <div>log level = <span style={{color:'var(--fg)'}}>1</span></div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title">Aktywne połączenia</div></div>
          {connections.length === 0
            ? <div style={{padding:'20px',textAlign:'center',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>Brak aktywnych połączeń</div>
            : <table className="table">
                <thead><tr><th>Użytkownik</th><th>Udział</th><th>Adres</th><th>PID</th></tr></thead>
                <tbody>
                  {connections.map((c,i) => (
                    <tr key={i}>
                      <td style={{fontWeight:500}}>{c.user}</td>
                      <td className="mono">{c.share}</td>
                      <td className="mono">{c.client}</td>
                      <td className="mono dim">{c.pid}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
          }
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div><div className="card-title">Udziały SMB</div><div className="card-sub">{shares.length} skonfigurowanych</div></div>
          <div className="card-actions">
            <button className="btn sm primary" onClick={()=>setShowAdd(s=>!s)}>
              <Icon name="plus" size={12}/> Nowy udział
            </button>
          </div>
        </div>
        
        {showAdd && (
          <div style={{padding:'12px var(--pad-card)',borderBottom:'1px solid var(--line)',background:'var(--bg-2)'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto auto auto',gap:10,alignItems:'end'}}>
              <div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Nazwa</div>
                <input style={inputSt} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="np. photos"/>
              </div>
              <div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Ścieżka</div>
                <input style={inputSt} value={form.path} onChange={e=>setForm(f=>({...f,path:e.target.value}))}/>
              </div>
              <div style={{position:'relative'}}>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Dostęp</div>
                <div style={{position:'relative'}}>
                  <input 
                    style={inputSt} 
                    value={accessInput} 
                    onChange={e=>{
                      setAccessInput(e.target.value);
                      setShowAccessDropdown(true);
                    }}
                    onFocus={()=>setShowAccessDropdown(true)}
                    placeholder="Szukaj użytkownika..."
                  />
                  {showAccessDropdown && (
                    <div style={{
                      position:'absolute',top:'100%',left:0,right:0,
                      background:'var(--bg-1)',border:'1px solid var(--line)',
                      borderRadius:5,maxHeight:200,overflowY:'auto',zIndex:100,
                      boxShadow:'0 4px 12px rgba(0,0,0,0.3)'
                    }}>
                      {filteredAccessItems.map((item, i) => (
                        <div 
                          key={i}
                          onClick={() => addAccessItem(item.name)}
                          style={{
                            padding:'6px 10px',cursor:'pointer',fontSize:'var(--fs-sm)',
                            display:'flex',justifyContent:'space-between',alignItems:'center',
                            borderBottom:'1px solid var(--line)',
                            background:'var(--bg-2)'
                          }}
                          onMouseEnter={e=>e.currentTarget.style.background='var(--bg-3)'}
                          onMouseLeave={e=>e.currentTarget.style.background='var(--bg-2)'}
                        >
                          <span>
                            {item.type === 'group' && '👥 '}
                            {item.type === 'user' && '👤 '}
                            {item.type === 'preset' && '⭐ '}
                            {item.name}
                          </span>
                          <span className="dim" style={{fontSize:10}}>
                            {item.type === 'user' && item.fullname}
                            {item.type === 'group' && 'grupa'}
                            {item.type === 'preset' && 'predefiniowany'}
                          </span>
                        </div>
                      ))}
                      {filteredAccessItems.length === 0 && (
                        <div style={{padding:'10px',textAlign:'center',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>
                          Brak wyników
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:4,marginTop:4}}>
                  {form.access.split(',').map(s => s.trim()).filter(Boolean).map((item, i) => (
                    <span key={i} className="chip accent" style={{cursor:'pointer',fontSize:10}}
                      onClick={() => removeAccessItem(item)}>
                      {item} ✕
                    </span>
                  ))}
                </div>
              </div>
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:6}}>Zapis</div>
                <div className={"toggle "+(form.rw?'on':'')} onClick={()=>setForm(f=>({...f,rw:!f.rw}))}/>
              </div>
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:6}}>Widoczny</div>
                <div className={"toggle "+(form.browseable?'on':'')} onClick={()=>setForm(f=>({...f,browseable:!f.browseable}))}/>
              </div>
              <div className="row gap-sm">
                <button className="btn sm primary" onClick={addShare}>Dodaj</button>
                <button className="btn sm" onClick={()=>{setShowAdd(false);setShowAccessDropdown(false);}}>✕</button>
              </div>
            </div>
          </div>
        )}
        <table className="table">
          <thead><tr><th>Nazwa</th><th>Ścieżka</th><th>Dostęp</th><th>Zapis</th><th>Widoczny</th><th>Klienci</th><th></th></tr></thead>
          <tbody>
            {shares.map((s,i) => (
              <tr key={i}>
                <td><span style={{fontWeight:500}}>{s.name}</span></td>
                <td className="mono dim">{s.path}</td>
                <td className="dim">{s.access}</td>
                <td>{s.rw ? <span className="badge ok">rw</span> : <span className="badge">ro</span>}</td>
                <td>{s.browseable ? <span className="badge ok">tak</span> : <span className="badge">ukryty</span>}</td>
                <td className="mono">{s.clients > 0 ? <span style={{color:'var(--accent)'}}>{s.clients}</span> : <span className="dim">0</span>}</td>
                <td>
                  <div className="row gap-sm">
                    <button className="icon-btn"><Icon name="edit" size={14}/></button>
                    <button className="icon-btn" onClick={()=>deleteShare(s.name)}><Icon name="trash" size={14}/></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---- FTP / SFTP ----
const FtpAddUserDialog = ({ onClose, onAdd }) => {
  const [form, setForm] = React.useState({ name:'', password:'', root:'/mnt/tank', upload:true, download:true, del:false });
  const [saving, setSaving] = React.useState(false);
  
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const valid = form.name.trim().length > 0 && form.password.length > 0;
  const permStr = [form.upload&&'upload', form.download&&'download', form.del&&'delete'].filter(Boolean).join(',');

  const handleAdd = async () => {
    if (!valid) return;
    setSaving(true);
    
    try {
      const resp = await fetch('/api/services/ftp-sftp/create-user', {
        method: 'POST',
        credentials: 'include',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(form),
      });
      
      if (resp.ok) {
        const data = await resp.json();
        onAdd({
          name: form.name,
          root: form.root,
          perm: permStr,
          last: 'nigdy',
        });
        onClose();
      } else {
        alert('Błąd tworzenia użytkownika');
      }
    } catch(e) {
      alert('Błąd: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-back" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal" style={{width:480}} onClick={e=>e.stopPropagation()}>
        <div className="modal-head">
          <div style={{flex:1}}>
            <div style={{fontWeight:600}}>Nowy użytkownik FTP</div>
            <div className="dim" style={{fontSize:'var(--fs-xs)',marginTop:2}}>vsftpd · local_users</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="close"/></button>
        </div>
        
        <div className="modal-body col" style={{gap:14}}>
          <div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Nazwa użytkownika</div>
            <input style={inputSt} value={form.name} onChange={e=>set('name',e.target.value)} placeholder="np. jan"/>
          </div>
          <div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Hasło</div>
            <input style={inputSt} type="password" value={form.password} onChange={e=>set('password',e.target.value)} placeholder="••••••••"/>
          </div>
          <div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Katalog główny (chroot)</div>
            <input style={inputSt} value={form.root} onChange={e=>set('root',e.target.value)} placeholder="/mnt/tank"/>
          </div>
          <div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:6}}>Uprawnienia</div>
            <div className="col" style={{gap:8}}>
              {[
                ['upload','Wgrywanie plików (upload)'],
                ['download','Pobieranie plików (download)'],
                ['del','Usuwanie plików (delete)']
              ].map(([k,label])=>(
                <label key={k} style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer',fontSize:'var(--fs-sm)'}}>
                  <input type="checkbox" checked={form[k]} onChange={e=>set(k,e.target.checked)}
                    style={{accentColor:'var(--accent)',width:15,height:15}}/>
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>
        
        <div className="modal-foot">
          <button className="btn sm ghost" onClick={onClose}>Anuluj</button>
          <button className="btn sm primary" disabled={!valid || saving} onClick={handleAdd}>
            <Icon name="plus" size={11}/> {saving ? 'Dodawanie...' : 'Dodaj użytkownika'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Zaktualizowany FtpService
const FtpService = () => {
  const [running, setRunning] = React.useState(false);
  const [installed, setInstalled] = React.useState(true);
  const [ftps, setFtps] = React.useState(true);
  const [anonOk, setAnonOk] = React.useState(false);
  const [passMin, setPassMin] = React.useState('40000');
  const [passMax, setPassMax] = React.useState('40100');
  const [users, setUsers] = React.useState([]);
  const [sessions, setSessions] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [installing, setInstalling] = React.useState(false);
  const [showAddUser, setShowAddUser] = React.useState(false);

  React.useEffect(() => {
    const load = async () => {
      try {
        const [statusR, usersR, connR] = await Promise.all([
          fetch('/api/services/ftp-sftp/status', {credentials:'include'}),
          fetch('/api/services/ftp-sftp/users', {credentials:'include'}),
          fetch('/api/services/ftp-sftp/connections', {credentials:'include'}),
        ]);
        
        if (statusR.ok) {
          const d = await statusR.json();
          setRunning(d.active);
          setInstalled(d.installed);
          setFtps(d.ftps_enabled);
          setAnonOk(d.anon_ok);
          if (d.passive_min) setPassMin(d.passive_min);
          if (d.passive_max) setPassMax(d.passive_max);
        }
        
        if (usersR.ok) {
          const d = await usersR.json();
          setUsers(d.users || []);
        }
        
        if (connR.ok) {
          const d = await connR.json();
          setSessions(d.connections || []);
        }
      } catch(e) {
        console.error('FTP load error:', e);
      } finally {
        setLoading(false);
      }
    };
    
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  const installFTP = async () => {
    setInstalling(true);
    await fetch('/api/services/ftp-sftp/install', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({service: 'vsftpd'}),
    });
    setInstalled(true);
    setInstalling(false);
  };

  const toggleService = async () => {
    await fetch('/api/services/ftp-sftp/toggle', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({enable: !running}),
    });
    setRunning(!running);
  };

  const saveConfig = async (field, value) => {
    await fetch('/api/services/ftp-sftp/config', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({[field]: value}),
    });
  };

  const killSession = async (pid) => {
    if (!confirm('Zakończyć sesję FTP?')) return;
    await fetch('/api/services/ftp-sftp/kill-connection', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({pid}),
    });
    setSessions(prev => prev.filter(s => s.pid !== pid));
  };

  const handleAddUser = (newUser) => {
    setUsers(prev => [...prev, newUser]);
  };

  if (loading) return <div className="card" style={{padding:40,textAlign:'center'}}>Ładowanie...</div>;

  if (!installed) {
    return (
      <div className="col" style={{gap:'var(--gutter)'}}>
        <div className="card" style={{padding:40, textAlign:'center'}}>
          <div style={{fontSize:48, marginBottom:16, opacity:0.3}}>📁</div>
          <div className="card-title" style={{marginBottom:8}}>FTP / FTPS nie jest zainstalowany</div>
          <div className="card-sub" style={{marginBottom:20}}>
            Zainstaluj serwer FTP (vsftpd) aby udostępniać pliki przez FTP/FTPS
          </div>
          <button className="btn primary" onClick={installFTP} disabled={installing}>
            <Icon name="download" size={14}/> {installing ? 'Instalowanie...' : 'Zainstaluj vsftpd'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      {/* KPI */}
      <div className="grid grid-4">
        <div className="kpi">
          <div className="kpi-label">STATUS</div>
          <div className="kpi-value" style={{fontSize:20,color:running?'var(--ok)':'var(--fg-dim)'}}>{running?'ONLINE':'STOPPED'}</div>
          <div className="kpi-foot"><span>FTP/FTPS · port 21</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">TRYB</div>
          <div className="kpi-value" style={{fontSize:18,color:ftps?'var(--ok)':'var(--warn)'}}>{ftps?'FTPS':'FTP'}</div>
          <div className="kpi-foot"><span>{ftps?'TLS':'plain'}</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">UŻYTKOWNICY</div>
          <div className="kpi-value">{users.length}</div>
          <div className="kpi-foot"><span>skonfigurowanych</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">SESJE</div>
          <div className="kpi-value">{sessions.length}</div>
          <div className="kpi-foot"><span>aktywne</span></div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Konfiguracja vsftpd</div><div className="card-sub">/etc/vsftpd.conf</div></div>
            <div className="card-actions">
              <span className="dim" style={{fontSize:'var(--fs-xs)'}}>usługa</span>
              <div className={"toggle "+(running?'on':'')} onClick={toggleService}/>
            </div>
          </div>
          <div className="card-body col" style={{gap:12}}>
            <div className="row" style={{justifyContent:'space-between'}}>
              <div>
                <div style={{fontWeight:500}}>SSL/TLS (FTPS)</div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>ssl_enable</div>
              </div>
              <div className={"toggle "+(ftps?'on':'')} onClick={()=>{setFtps(!ftps);saveConfig('ftps_enabled', !ftps);}}/>
            </div>
            <div className="row" style={{justifyContent:'space-between'}}>
              <div>
                <div style={{fontWeight:500}}>Dostęp anonimowy</div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>anonymous_enable</div>
              </div>
              <div className={"toggle "+(anonOk?'on':'')} onClick={()=>{setAnonOk(!anonOk);saveConfig('anon_ok', !anonOk);}}/>
            </div>
            <hr className="div"/>
            <div className="grid" style={{gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Port pasywny min</div>
                <input style={inputSt} value={passMin} onChange={e=>{setPassMin(e.target.value);saveConfig('passive_min', e.target.value);}}/>
              </div>
              <div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Port pasywny max</div>
                <input style={inputSt} value={passMax} onChange={e=>{setPassMax(e.target.value);saveConfig('passive_max', e.target.value);}}/>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Użytkownicy FTP</div></div>
            <div className="card-actions">
              <button className="btn sm primary" onClick={()=>setShowAddUser(true)}>
                <Icon name="plus" size={12}/> Dodaj
              </button>
            </div>
          </div>
          <table className="table">
            <thead><tr><th>Użytkownik</th><th>Katalog główny</th><th>Uprawnienia</th><th>Ostatnie logowanie</th></tr></thead>
            <tbody>
              {users.length === 0 && (
                <tr><td colSpan={4} style={{textAlign:'center',padding:20,color:'var(--fg-dim)'}}>Brak użytkowników FTP</td></tr>
              )}
              {users.map((u,i) => (
                <tr key={i}>
                  <td style={{fontWeight:500}}>{u.name}</td>
                  <td className="mono dim">{u.root}</td>
                  <td style={{fontSize:'var(--fs-xs)'}}>{u.perm}</td>
                  <td className="mono dim">{u.last}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sessions.length > 0 && (
            <div style={{padding:'var(--pad-card)',borderTop:'1px solid var(--line)'}}>
              <div style={{fontWeight:500,marginBottom:8}}>Aktywne sesje</div>
              <table className="table">
                <thead><tr><th>Użytkownik</th><th>IP</th><th></th></tr></thead>
                <tbody>
                  {sessions.map((s,i) => (
                    <tr key={i}>
                      <td>{s.user}</td>
                      <td className="mono">{s.ip}</td>
                      <td><button className="btn sm danger" onClick={()=>killSession(s.pid)}>Kill</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showAddUser && (
        <FtpAddUserDialog 
          onClose={()=>setShowAddUser(false)} 
          onAdd={handleAddUser}
        />
      )}
    </div>
  );
};

// ---- WebDAV ----
// ─── InstallBanner (copy for netsvcs context) ───────────────────────────────
const InstallBannerNetSvc = ({ name, icon='download', desc, packages=[], installEndpoint, onInstalled, docsUrl }) => {
  const [installing, setInstalling] = React.useState(false);
  const [log, setLog] = React.useState([]);
  const [err, setErr] = React.useState('');
  const doInstall = async () => {
    setInstalling(true); setErr('');
    setLog([`apt install ${packages.join(' ')}…`]);
    try {
      const r = await fetch(installEndpoint, {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({packages})});
      if (r.ok) { setLog(l=>[...l,'✓ Instalacja zakończona']); setTimeout(()=>onInstalled&&onInstalled(),800); }
      else { const t = await r.text().catch(()=>''); setErr('Błąd: '+(t||r.status)); }
    } catch(e) { setErr('Błąd: '+e.message); }
    finally { setInstalling(false); }
  };
  return (
    <div className="card" style={{padding:40,textAlign:'center'}}>
      <Icon name={icon} size={48} style={{opacity:.2,display:'block',margin:'0 auto 20px'}}/>
      <div style={{fontWeight:700,fontSize:'var(--fs-lg)',marginBottom:10}}>{name} nie jest zainstalowany</div>
      <div style={{color:'var(--fg-muted)',fontSize:'var(--fs-sm)',maxWidth:560,margin:'0 auto 24px',lineHeight:1.7}}>{desc}</div>
      <div style={{display:'flex',gap:10,flexWrap:'wrap',justifyContent:'center',marginBottom:20}}>
        {packages.map(p=><span key={p} className="chip mono" style={{fontSize:13,padding:'4px 12px'}}>{p}</span>)}
      </div>
      {log.length>0&&<div style={{background:'var(--bg)',borderRadius:7,padding:'10px 14px',fontFamily:'var(--font-mono)',fontSize:'var(--fs-xs)',lineHeight:1.7,maxHeight:80,overflowY:'auto',border:'1px solid var(--line)',textAlign:'left',maxWidth:480,margin:'0 auto 16px'}}>{log.map((l,i)=><div key={i} style={{color:l.startsWith('✓')?'var(--ok)':l.startsWith('✗')?'var(--err)':'var(--fg-muted)'}}>{l}</div>)}</div>}
      {err&&<div style={{color:'var(--err)',fontSize:'var(--fs-sm)',marginBottom:12}}>{err}</div>}
      <div className="row gap-sm" style={{justifyContent:'center'}}>
        <button className="btn primary" onClick={doInstall} disabled={installing} style={{padding:'9px 24px',fontSize:'var(--fs-base)'}}>
          <Icon name="download" size={14}/> {installing?'Instalowanie…':'Zainstaluj '+name}
        </button>
        {docsUrl&&<a href={docsUrl} target="_blank" rel="noopener noreferrer" className="btn" style={{padding:'9px 16px'}}>Dokumentacja ↗</a>}
      </div>
      <div style={{marginTop:12,fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>Wymaga uprawnień root · instalacja przez apt</div>
    </div>
  );
};

const WebDavService = () => {
  const [webdavInstalled, setWebdavInstalled] = React.useState(null); // null = checking
  const [running, setRunning] = React.useState(false);
  const [ssl, setSsl] = React.useState(true);
  const [digest, setDigest] = React.useState(false);
  const [shares, setShares] = React.useState([
    { path:'/dav/media',  local:'/mnt/tank/media',   auth:'basic', rw:false, users:'wszyscy' },
    { path:'/dav/docs',   local:'/mnt/tank/docs',    auth:'basic', rw:true,  users:'kuba, ania' },
    { path:'/dav/cloud',  local:'/mnt/fast/nextcloud',auth:'digest',rw:true,  users:'nextcloud' },
  ]);
  const [showAdd, setShowAdd] = React.useState(false);
  const [form, setForm] = React.useState({path:'/dav/', local:'/mnt/', auth:'basic', rw:true, users:'wszyscy'});

  const addShare = () => {
    if (!form.path || !form.local) return;
    setShares(s => [...s, {...form}]);
    setShowAdd(false);
  };

  const baseUrl = ssl ? 'https://nimbus.lan' : 'http://nimbus.lan';

  React.useEffect(()=>{
    // Sprawdź czy apache2 + mod_dav jest zainstalowany
    fetch('/api/services/webdav/status',{credentials:'include'})
      .then(r=>{
        if(!r.ok) { setWebdavInstalled(false); return null; }
        return r.json();
      })
      .then(d=>{
        if(!d) return;
        // installed: false oznacza brak apache2
        const installed = d.installed !== false;
        setWebdavInstalled(installed);
        if(d.active !== undefined) setRunning(d.active);
      })
      .catch(()=>{
        // Brak endpointu = serwis nie istnieje w backendzie = nie zainstalowany
        setWebdavInstalled(false);
      });
  },[]);

  // Pokaż spinner podczas sprawdzania
  if (webdavInstalled === null) return (
    <div style={{padding:60,textAlign:'center',color:'var(--fg-dim)'}}>
      <div style={{width:18,height:18,border:'2px solid var(--line-strong)',borderTopColor:'var(--accent)',
        borderRadius:'50%',animation:'_spin .6s linear infinite',margin:'0 auto 12px'}}/>
      <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)'}}>Sprawdzanie WebDAV…</div>
    </div>
  );

  if (webdavInstalled === false) return (
    <InstallBannerNetSvc name="Apache WebDAV" icon="globe"
      desc="WebDAV (Web Distributed Authoring and Versioning) umożliwia udostępnianie plików przez protokół HTTP/HTTPS. Kompatybilny z Windows, macOS, Linux i aplikacjami mobilnymi."
      packages={['apache2', 'libapache2-mod-webdav']}
      installEndpoint="/api/services/webdav/install"
      onInstalled={()=>setWebdavInstalled(true)}
      docsUrl="https://httpd.apache.org/docs/current/mod/mod_dav.html"
    />
  );

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="grid grid-4">
        <div className="kpi">
          <div className="kpi-label">STATUS</div>
          <div className="kpi-value" style={{fontSize:20,color:running?'var(--ok)':'var(--fg-dim)'}}>{running?'ONLINE':'STOPPED'}</div>
          <div className="kpi-foot"><span>Apache mod_dav · port {ssl?'443':'80'}</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">SSL/TLS</div>
          <div className="kpi-value" style={{fontSize:20,color:ssl?'var(--ok)':'var(--warn)'}}>{ssl?'HTTPS':'HTTP'}</div>
          <div className="kpi-foot"><span>{ssl?'Let\'s Encrypt · 78d':'niezaszyfrowane'}</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">ŚCIEŻKI</div>
          <div className="kpi-value">{shares.length}</div>
          <div className="kpi-foot"><span>skonfigurowane</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">AUTORYZACJA</div>
          <div className="kpi-value" style={{fontSize:18}}>{digest?'Digest':'Basic'}</div>
          <div className="kpi-foot"><span>HTTP auth</span></div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Konfiguracja serwera</div><div className="card-sub">Apache mod_dav + mod_ssl</div></div>
            <div className="card-actions">
              <span className="dim" style={{fontSize:'var(--fs-xs)',color:'var(--fg-muted)'}}>usługa</span>
              <div className={"toggle "+(running?'on':'')} onClick={()=>setRunning(r=>!r)}/>
            </div>
          </div>
          <div className="card-body col" style={{gap:12}}>
            <div className="row" style={{justifyContent:'space-between'}}>
              <div>
                <div style={{fontWeight:500}}>HTTPS / SSL</div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>mod_ssl · certbot Let's Encrypt</div>
              </div>
              <div className={"toggle "+(ssl?'on':'')} onClick={()=>setSsl(v=>!v)}/>
            </div>
            <div className="row" style={{justifyContent:'space-between'}}>
              <div>
                <div style={{fontWeight:500}}>Digest auth (zamiast Basic)</div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>mod_auth_digest</div>
              </div>
              <div className={"toggle "+(digest?'on':'')} onClick={()=>setDigest(v=>!v)}/>
            </div>
            <hr className="div"/>
            <div style={{background:'var(--bg-2)',borderRadius:6,padding:'10px 12px',fontFamily:'var(--font-mono)',fontSize:'var(--fs-xs)',color:'var(--fg-muted)',lineHeight:1.7}}>
              <div>ServerName <span style={{color:'var(--fg)'}}>nimbus.lan</span></div>
              <div>DavLockDB <span style={{color:'var(--fg)'}}>/var/lock/dav</span></div>
              <div>LimitXMLRequestBody <span style={{color:'var(--fg)'}}>10M</span></div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title">Jak podłączyć klienta</div></div>
          <div className="card-body col" style={{gap:10}}>
            {[
              {label:'Windows (File Explorer)',  cmd:`\\\\nimbus.lan\\dav\\docs`},
              {label:'macOS (Finder → Połącz)', cmd:`${baseUrl}/dav/docs`},
              {label:'Linux (davfs2)',            cmd:`mount -t davfs ${baseUrl}/dav/docs /mnt/dav`},
              {label:'Android (DAVx5)',           cmd:`${baseUrl}/dav/`},
            ].map((x,i) => (
              <div key={i} style={{background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:6,padding:'8px 12px'}}>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:3}}>{x.label}</div>
                <div className="mono" style={{fontSize:'var(--fs-xs)',wordBreak:'break-all'}}>{x.cmd}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div><div className="card-title">Ścieżki WebDAV</div></div>
          <div className="card-actions">
            <button className="btn sm primary" onClick={()=>setShowAdd(s=>!s)}><Icon name="plus" size={12}/> Dodaj ścieżkę</button>
          </div>
        </div>
        {showAdd && (
          <div style={{padding:'12px var(--pad-card)',borderBottom:'1px solid var(--line)',background:'var(--bg-2)',display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto auto auto',gap:10,alignItems:'end'}}>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Ścieżka URL</div>
              <input style={inputSt} value={form.path} onChange={e=>setForm(f=>({...f,path:e.target.value}))} placeholder="/dav/..."/>
            </div>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Katalog lokalny</div>
              <input style={inputSt} value={form.local} onChange={e=>setForm(f=>({...f,local:e.target.value}))}/>
            </div>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Użytkownicy</div>
              <input style={inputSt} value={form.users} onChange={e=>setForm(f=>({...f,users:e.target.value}))}/>
            </div>
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:6}}>Zapis</div>
              <div className={"toggle "+(form.rw?'on':'')} onClick={()=>setForm(f=>({...f,rw:!f.rw}))}/>
            </div>
            <div className="row gap-sm">
              <button className="btn sm primary" onClick={addShare}>Dodaj</button>
              <button className="btn sm" onClick={()=>setShowAdd(false)}>✕</button>
            </div>
          </div>
        )}
        <table className="table">
          <thead><tr><th>URL</th><th>Katalog</th><th>Auth</th><th>Dostęp</th><th>Tryb</th><th></th></tr></thead>
          <tbody>
            {shares.map((s,i) => (
              <tr key={i}>
                <td className="mono">{baseUrl}<span style={{color:'var(--accent)'}}>{s.path}</span></td>
                <td className="mono dim">{s.local}</td>
                <td><span className="chip">{s.auth}</span></td>
                <td className="dim">{s.users}</td>
                <td>{s.rw ? <span className="badge ok">rw</span> : <span className="badge">ro</span>}</td>
                <td>
                  <div className="row gap-sm">
                    <button className="icon-btn"><Icon name="edit" size={14}/></button>
                    <button className="icon-btn" onClick={()=>setShares(sh=>sh.filter((_,j)=>j!==i))}><Icon name="trash" size={14}/></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

window.SshService = SshService;
window.SambaService = SambaService;
window.FtpService = FtpService;
window.WebDavService = WebDavService;
