// ===== Servers — zarządzanie zdalnymi serwerami =====

const useStore = window.useStore;
const storeSet = window.storeSet;
const Icon     = window.Icon;

// ─── Helper: formatowanie bajtów ───────────────────────────────────────────
function fmtBytes(mb) {
  if (!mb && mb !== 0) return '—';
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
  return Math.round(mb) + ' MB';
}

// ─── StatusBadge ────────────────────────────────────────────────────────────
const SrvBadge = ({ status }) => {
  if (status === 'online')      return <span className="badge ok"><span className="dot pulse"/>ONLINE</span>;
  if (status === 'offline')     return <span className="badge"><span className="dot"/>OFFLINE</span>;
  if (status === 'connecting')  return <span className="badge warn"><span className="dot pulse"/>ŁĄCZENIE…</span>;
  if (status === 'connected')   return <span className="badge ok"><span className="dot pulse"/>POŁĄCZONO</span>;
  return <span className="badge dim"><span className="dot"/>NIEZNANY</span>;
};

// ─── Donut mini ─────────────────────────────────────────────────────────────
const MiniDonut = ({ pct, color = 'var(--accent)', size = 54 }) => {
  const r = (size - 7) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, (pct || 0) / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} stroke="var(--bg-3)" strokeWidth={7} fill="none"/>
      <circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={7} fill="none"
        strokeDasharray={`${c*p} ${c}`} strokeDashoffset={c*0.25}
        transform={`rotate(-90 ${size/2} ${size/2})`} strokeLinecap="round"/>
      <text x="50%" y="54%" textAnchor="middle" fontSize="11" fontFamily="var(--font-mono)"
        fill="var(--fg)" fontWeight="600">{Math.round(p*100)}%</text>
    </svg>
  );
};

// ─── Modal pomocniczy ────────────────────────────────────────────────────────
const SrvModal = ({ title, sub, onClose, width = 560, children, footer }) => (
  <div style={{position:'fixed',inset:0,zIndex:900,display:'flex',alignItems:'center',justifyContent:'center',
    background:'rgba(0,0,0,.55)',backdropFilter:'blur(3px)'}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{width,maxWidth:'95vw',maxHeight:'90vh',display:'flex',flexDirection:'column',
      background:'var(--bg-1)',border:'1px solid var(--line-strong)',borderRadius:14,
      boxShadow:'0 32px 80px rgba(0,0,0,.6)',overflow:'hidden'}}>
      <div style={{padding:'16px 20px',borderBottom:'1px solid var(--line)',display:'flex',alignItems:'center',gap:10}}>
        <div style={{flex:1}}>
          <div style={{fontWeight:600,fontSize:'var(--fs-lg)'}}>{title}</div>
          {sub && <div style={{color:'var(--fg-muted)',fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)',marginTop:2}}>{sub}</div>}
        </div>
        <button className="btn ghost icon-only" onClick={onClose}><Icon name="close" size={14}/></button>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'20px'}}>{children}</div>
      {footer && <div style={{padding:'12px 20px',borderTop:'1px solid var(--line)',display:'flex',gap:8,justifyContent:'flex-end'}}>{footer}</div>}
    </div>
  </div>
);

// ─── Formularz dodawania/edycji serwera ─────────────────────────────────────
const ServerForm = ({ initial, onSave, onClose }) => {
  const [form, setForm] = React.useState(initial || { name:'', host:'', port:22, username:'root', password:'', key_path:'' });
  const [busy, setBusy] = React.useState(false);
  const [err,  setErr]  = React.useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name || !form.host) { setErr('Nazwa i adres IP są wymagane'); return; }
    setBusy(true); setErr('');
    try {
      const method = initial?.id ? 'PUT' : 'POST';
      const url    = initial?.id ? `/api/servers/${initial.id}` : '/api/servers';
      const r = await fetch(url, {
        method, credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, port: parseInt(form.port) || 22 }),
      });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      onSave({ ...form, id: d.id || initial?.id, port: parseInt(form.port) || 22 });
    } catch (e) {
      setErr('Błąd zapisu: ' + e.message);
    } finally { setBusy(false); }
  };

  const field = (label, key, type='text', ph='') => (
    <div style={{display:'flex',flexDirection:'column',gap:5,marginBottom:14}}>
      <label style={{fontSize:'var(--fs-xs)',color:'var(--fg-muted)',fontWeight:500,
        letterSpacing:'.04em',textTransform:'uppercase'}}>{label}</label>
      <input type={type} value={form[key]} onChange={e=>set(key,e.target.value)} placeholder={ph}
        style={{height:36,padding:'0 12px',background:'var(--bg-2)',border:'1px solid var(--line-strong)',
          borderRadius:7,color:'var(--fg)',fontSize:'var(--fs-base)',outline:'none',fontFamily:'var(--font-ui)'}}/>
    </div>
  );

  return (
    <SrvModal
      title={initial?.id ? 'Edytuj serwer' : 'Dodaj serwer'}
      sub="Połączenie SSH do zdalnego hosta"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Anuluj</button>
        <button className="btn primary" onClick={save} disabled={busy}>{busy?'Zapisywanie…':'Zapisz serwer'}</button>
      </>}
    >
      {field('Nazwa serwera', 'name', 'text', 'np. Homelab #1')}
      <div style={{display:'grid',gridTemplateColumns:'1fr 100px',gap:12}}>
        <div style={{display:'flex',flexDirection:'column',gap:5,marginBottom:14}}>
          <label style={{fontSize:'var(--fs-xs)',color:'var(--fg-muted)',fontWeight:500,
            letterSpacing:'.04em',textTransform:'uppercase'}}>Adres IP / hostname</label>
          <input type="text" value={form.host} onChange={e=>set('host',e.target.value)} placeholder="192.168.1.100"
            style={{height:36,padding:'0 12px',background:'var(--bg-2)',border:'1px solid var(--line-strong)',
              borderRadius:7,color:'var(--fg)',fontSize:'var(--fs-base)',outline:'none',fontFamily:'var(--font-mono)'}}/>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:5,marginBottom:14}}>
          <label style={{fontSize:'var(--fs-xs)',color:'var(--fg-muted)',fontWeight:500,
            letterSpacing:'.04em',textTransform:'uppercase'}}>Port SSH</label>
          <input type="number" value={form.port} onChange={e=>set('port',e.target.value)} placeholder="22"
            style={{height:36,padding:'0 12px',background:'var(--bg-2)',border:'1px solid var(--line-strong)',
              borderRadius:7,color:'var(--fg)',fontSize:'var(--fs-base)',outline:'none',fontFamily:'var(--font-mono)'}}/>
        </div>
      </div>
      {field('Użytkownik SSH', 'username', 'text', 'root')}
      {field('Hasło SSH', 'password', 'password', '(opcjonalne jeśli używasz klucza)')}
      {field('Ścieżka do klucza SSH', 'key_path', 'text', '/home/user/.ssh/id_rsa')}
      {err && <div style={{padding:'10px 14px',background:'color-mix(in oklch,var(--err) 12%,transparent)',
        border:'1px solid color-mix(in oklch,var(--err) 30%,transparent)',borderRadius:6,
        color:'var(--err)',fontSize:'var(--fs-sm)'}}>{err}</div>}
    </SrvModal>
  );
};

// ─── Panel po połączeniu: stats + procesy + terminal ────────────────────────
const ServerDetail = ({ srv, onClose }) => {
  const [tab,     setTab]     = React.useState('stats');
  const [stats,   setStats]   = React.useState(null);
  const [procs,   setProcs]   = React.useState([]);
  const [disks,   setDisks]   = React.useState([]);
  const [logs,    setLogs]    = React.useState([]);
  const [termCmd, setTermCmd] = React.useState('');
  const [termOut, setTermOut] = React.useState([]);
  const [termBusy,setTermBusy]= React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [err,     setErr]     = React.useState('');
  const [killPid, setKillPid] = React.useState(null);
  const termRef = React.useRef(null);

  const api = (path) => fetch(`/api/servers/${srv.id}/${path}`, { credentials:'include' });

  const loadStats = async () => {
    setLoading(true); setErr('');
    try {
      // CPU+RAM via SSH stats
      const [sRes, dRes, pRes, lRes] = await Promise.all([
        api('stats'), api('disks'), api('processes'), api('logs?n=30')
      ]);
      const s = sRes.ok ? await sRes.json() : null;
      const d = dRes.ok ? await dRes.json() : null;
      const p = pRes.ok ? await pRes.json() : null;
      const l = lRes.ok ? await lRes.json() : null;

      // Parse uptime/load from uptime output
      if (s?.uptime) {
        const m = s.uptime.match(/load average:\s*([\d.]+)/);
        const load = m ? parseFloat(m[1]) : null;
        // Attempt CPU% from load (rough: load*100/nproc)
        const memMatch = s.memory?.match(/Mem:\s+(\d+)\s+(\d+)\s+(\d+)/);
        setStats({
          load,
          cpuPct: load ? Math.min(100, Math.round(load * 25)) : null,
          memTotal: memMatch ? parseInt(memMatch[1]) : null,
          memUsed:  memMatch ? parseInt(memMatch[2]) : null,
          uptime: s.uptime,
        });
      }

      // Parse df -h output
      if (d?.raw) {
        const lines = d.raw.split('\n').slice(1).filter(Boolean);
        const parsed = lines.map(l => {
          const parts = l.split(/\s+/);
          return { fs: parts[0], size: parts[1], used: parts[2], avail: parts[3], pct: parseInt(parts[4])||0, mount: parts[5] };
        }).filter(x => x.mount && !x.fs.startsWith('tmpfs') && !x.fs.startsWith('devtmpfs'));
        setDisks(parsed);
      }

      // Parse ps output
      if (p?.raw) {
        const lines = p.raw.split('\n').slice(1).filter(Boolean);
        const parsed = lines.map(l => {
          const parts = l.trim().split(/\s+/);
          return {
            user: parts[0], pid: parts[1], cpu: parts[2], mem: parts[3],
            cmd: parts.slice(10).join(' ') || parts[10] || '—'
          };
        }).filter(x => x.pid);
        setProcs(parsed);
      }

      if (l?.logs) setLogs(l.logs.filter(Boolean));
    } catch (e) {
      setErr('Błąd pobierania danych: ' + e.message);
    } finally { setLoading(false); }
  };

  React.useEffect(() => { loadStats(); const t = setInterval(loadStats, 8000); return () => clearInterval(t); }, [srv.id]);

  const killProcess = async (pid) => {
    await fetch(`/api/servers/${srv.id}/processes/${pid}/kill`, { method:'POST', credentials:'include' });
    setKillPid(null);
    setTimeout(loadStats, 1000);
  };

  const runTermCmd = async () => {
    if (!termCmd.trim()) return;
    const cmd = termCmd;
    setTermCmd('');
    setTermBusy(true);
    setTermOut(o => [...o, { type:'cmd', text: '$ ' + cmd }]);
    try {
      // Use a generic "exec" via the services endpoint (custom approach)
      const r = await api(`logs?n=1`); // fallback: show that we can't exec arbitrary
      // Since there's no arbitrary exec endpoint, we simulate terminal-like with known commands
      const cmdMap = {
        'uptime': 'stats', 'df -h': 'disks', 'ps aux': 'processes',
        'who': 'users', 'hostname': 'hostname',
      };
      const ep = cmdMap[cmd.toLowerCase()];
      if (ep) {
        const res = await api(ep);
        const j = await res.json();
        const out = j.raw || j.hostname || j.uptime || JSON.stringify(j, null, 2);
        setTermOut(o => [...o, { type:'out', text: out }]);
      } else {
        setTermOut(o => [...o, { type:'err', text: `Dostępne komendy: uptime, df -h, ps aux, who, hostname` }]);
      }
    } catch (e) {
      setTermOut(o => [...o, { type:'err', text: e.message }]);
    } finally { setTermBusy(false); setTimeout(() => { if(termRef.current) termRef.current.scrollTop = 9999; }, 50); }
  };

  const TABS = [
    { id:'stats',    icon:'dashboard', label:'Zasoby'   },
    { id:'procs',    icon:'process',   label:'Procesy'  },
    { id:'disks',    icon:'disk',      label:'Dyski'    },
    { id:'logs',     icon:'log',       label:'Logi'     },
    { id:'terminal', icon:'terminal',  label:'Terminal' },
  ];

  const cpuColor  = pct => pct > 80 ? 'var(--err)' : pct > 60 ? 'oklch(0.75 0.16 65)' : 'var(--ok)';
  const memPct    = stats ? Math.round((stats.memUsed / stats.memTotal) * 100) : 0;
  const memColor  = memPct > 85 ? 'var(--err)' : memPct > 65 ? 'oklch(0.75 0.16 65)' : 'oklch(0.7 0.16 200)';

  return (
    <SrvModal
      title={`${srv.name}`}
      sub={`${srv.host}:${srv.port} · ${srv.username}`}
      onClose={onClose}
      width={860}
      footer={<>
        <button className="btn" onClick={loadStats}><Icon name="refresh" size={12}/> Odśwież</button>
        <button className="btn" onClick={onClose}>Zamknij</button>
      </>}
    >
      {/* Tabs */}
      <div style={{display:'flex',gap:4,marginBottom:18,borderBottom:'1px solid var(--line)',paddingBottom:0}}>
        {TABS.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{display:'flex',alignItems:'center',gap:6,padding:'7px 14px',
              background:'none',border:'none',cursor:'pointer',
              color: tab===t.id ? 'var(--fg)' : 'var(--fg-dim)',
              borderBottom: tab===t.id ? '2px solid var(--accent)' : '2px solid transparent',
              fontSize:'var(--fs-sm)',fontFamily:'var(--font-ui)',fontWeight: tab===t.id?600:400,
              marginBottom:-1,borderRadius:'4px 4px 0 0',transition:'color .15s'}}>
            <Icon name={t.icon} size={13}/>{t.label}
          </button>
        ))}
      </div>

      {loading && tab !== 'terminal' && (
        <div style={{textAlign:'center',padding:'40px 0',color:'var(--fg-dim)',fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)'}}>
          <div style={{width:16,height:16,border:'2px solid var(--line-strong)',borderTopColor:'var(--accent)',
            borderRadius:'50%',animation:'_spin .6s linear infinite',margin:'0 auto 12px'}}/>
          Pobieranie danych…
        </div>
      )}

      {err && <div style={{padding:'10px 14px',background:'color-mix(in oklch,var(--err) 12%,transparent)',
        border:'1px solid color-mix(in oklch,var(--err) 30%,transparent)',borderRadius:6,
        color:'var(--err)',fontSize:'var(--fs-sm)',marginBottom:16}}>{err}</div>}

      {/* STATS TAB */}
      {!loading && tab==='stats' && (
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:16}}>
            {/* CPU */}
            <div className="kpi" style={{textAlign:'center'}}>
              <div className="kpi-label" style={{justifyContent:'center'}}>CPU</div>
              <div style={{display:'flex',justifyContent:'center',margin:'10px 0 6px'}}>
                <MiniDonut pct={stats?.cpuPct||0} color={cpuColor(stats?.cpuPct||0)} size={64}/>
              </div>
              <div style={{color:'var(--fg-muted)',fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)'}}>
                load: {stats?.load?.toFixed(2) ?? '—'}
              </div>
            </div>
            {/* RAM */}
            <div className="kpi" style={{textAlign:'center'}}>
              <div className="kpi-label" style={{justifyContent:'center'}}>RAM</div>
              <div style={{display:'flex',justifyContent:'center',margin:'10px 0 6px'}}>
                <MiniDonut pct={memPct} color={memColor} size={64}/>
              </div>
              <div style={{color:'var(--fg-muted)',fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)'}}>
                {fmtBytes(stats?.memUsed)} / {fmtBytes(stats?.memTotal)}
              </div>
            </div>
            {/* Uptime */}
            <div className="kpi" style={{textAlign:'center',display:'flex',flexDirection:'column',justifyContent:'center'}}>
              <div className="kpi-label" style={{justifyContent:'center'}}>Uptime</div>
              <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',marginTop:10,
                color:'var(--fg)',lineHeight:1.6,wordBreak:'break-word'}}>
                {stats?.uptime ? stats.uptime.replace(/.*up\s+/,'').replace(/,\s+\d+ user.*/,'').trim() : '—'}
              </div>
            </div>
          </div>

          {/* Dyski summary */}
          {disks.length > 0 && (
            <div className="card" style={{marginTop:8}}>
              <div className="card-head"><div className="card-title">Dyski</div></div>
              <div className="card-body flush">
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'var(--fs-sm)',fontFamily:'var(--font-mono)'}}>
                  <thead>
                    <tr style={{borderBottom:'1px solid var(--line)'}}>
                      {['Filesystem','Rozmiar','Użyte','Wolne','%','Punkt montowania'].map(h=>(
                        <th key={h} style={{padding:'8px 14px',textAlign:'left',color:'var(--fg-muted)',
                          fontSize:'var(--fs-xs)',fontWeight:500,textTransform:'uppercase',letterSpacing:'.04em'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {disks.slice(0,6).map((d,i) => (
                      <tr key={i} style={{borderBottom:'1px solid var(--line)'}}>
                        <td style={{padding:'8px 14px',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.fs}</td>
                        <td style={{padding:'8px 14px'}}>{d.size}</td>
                        <td style={{padding:'8px 14px'}}>{d.used}</td>
                        <td style={{padding:'8px 14px'}}>{d.avail}</td>
                        <td style={{padding:'8px 14px'}}>
                          <div style={{display:'flex',alignItems:'center',gap:8}}>
                            <div style={{width:60,height:5,background:'var(--bg-3)',borderRadius:3}}>
                              <div style={{width:`${d.pct}%`,height:'100%',borderRadius:3,
                                background:d.pct>85?'var(--err)':d.pct>65?'oklch(0.75 0.16 65)':'var(--ok)'}}/>
                            </div>
                            <span>{d.pct}%</span>
                          </div>
                        </td>
                        <td style={{padding:'8px 14px',color:'var(--fg-muted)'}}>{d.mount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PROCS TAB */}
      {!loading && tab==='procs' && (
        <div>
          <div style={{marginBottom:10,color:'var(--fg-muted)',fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)'}}>
            Top procesy wg CPU · {procs.length} wpisów
          </div>
          <div className="card">
            <div className="card-body flush">
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)'}}>
                <thead>
                  <tr style={{borderBottom:'1px solid var(--line)'}}>
                    {['PID','Użytkownik','CPU%','MEM%','Komenda',''].map(h=>(
                      <th key={h} style={{padding:'8px 12px',textAlign:'left',color:'var(--fg-muted)',
                        fontWeight:500,textTransform:'uppercase',letterSpacing:'.04em',fontSize:'10px'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {procs.slice(0,25).map((p,i) => (
                    <tr key={i} style={{borderBottom:'1px solid var(--line)',transition:'background .1s'}}
                      onMouseEnter={e=>e.currentTarget.style.background='var(--bg-2)'}
                      onMouseLeave={e=>e.currentTarget.style.background=''}>
                      <td style={{padding:'7px 12px',color:'var(--accent)'}}>{p.pid}</td>
                      <td style={{padding:'7px 12px',color:'var(--fg-muted)'}}>{p.user}</td>
                      <td style={{padding:'7px 12px'}}>
                        <span style={{color: parseFloat(p.cpu)>50?'var(--err)':parseFloat(p.cpu)>20?'oklch(0.75 0.16 65)':'var(--fg)'}}>{p.cpu}%</span>
                      </td>
                      <td style={{padding:'7px 12px'}}>{p.mem}%</td>
                      <td style={{padding:'7px 12px',maxWidth:280,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'var(--fg-muted)'}}>
                        {p.cmd}
                      </td>
                      <td style={{padding:'7px 12px'}}>
                        {killPid === p.pid ? (
                          <div style={{display:'flex',gap:4}}>
                            <button className="btn sm danger" onClick={()=>killProcess(p.pid)}>Zabij</button>
                            <button className="btn sm" onClick={()=>setKillPid(null)}>Anuluj</button>
                          </div>
                        ) : (
                          <button className="btn sm ghost" onClick={()=>setKillPid(p.pid)}
                            style={{color:'var(--err)',opacity:.6}} title="Zakończ proces">
                            <Icon name="close" size={11}/>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* DISKS TAB */}
      {!loading && tab==='disks' && (
        <div>
          <div style={{marginBottom:10,color:'var(--fg-muted)',fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)'}}>
            Partycje i punkty montowania
          </div>
          {disks.length === 0
            ? <div style={{color:'var(--fg-dim)',textAlign:'center',padding:40}}>Brak danych o dyskach</div>
            : disks.map((d,i) => (
              <div key={i} className="card" style={{marginBottom:10}}>
                <div style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:16}}>
                  <Icon name="disk" size={18} style={{color:'var(--fg-muted)',flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                      <span style={{fontWeight:600,fontSize:'var(--fs-sm)'}}>{d.mount}</span>
                      <span style={{fontFamily:'var(--font-mono)',fontSize:'var(--fs-xs)',color:'var(--fg-muted)'}}>{d.used} / {d.size}</span>
                    </div>
                    <div style={{height:6,background:'var(--bg-3)',borderRadius:3}}>
                      <div style={{width:`${d.pct}%`,height:'100%',borderRadius:3,transition:'width .3s',
                        background:d.pct>85?'var(--err)':d.pct>65?'oklch(0.75 0.16 65)':'var(--ok)'}}/>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',marginTop:5,
                      fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)',color:'var(--fg-muted)'}}>
                      <span>{d.fs}</span>
                      <span>{d.avail} wolne · {d.pct}% użyte</span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          }
        </div>
      )}

      {/* LOGS TAB */}
      {!loading && tab==='logs' && (
        <div>
          <div style={{background:'var(--bg)',borderRadius:8,padding:'12px 14px',
            fontFamily:'var(--font-mono)',fontSize:'var(--fs-xs)',lineHeight:1.7,
            maxHeight:420,overflowY:'auto',color:'var(--fg-muted)',border:'1px solid var(--line)'}}>
            {logs.length === 0
              ? <span style={{color:'var(--fg-dim)'}}>Brak logów</span>
              : logs.map((l,i) => {
                  const isErr = /error|fail|crit/i.test(l);
                  const isWarn = /warn/i.test(l);
                  return (
                    <div key={i} style={{color:isErr?'var(--err)':isWarn?'oklch(0.75 0.16 65)':'var(--fg-muted)',
                      borderBottom:'1px solid var(--line)',paddingBottom:3,marginBottom:3}}>{l}</div>
                  );
                })
            }
          </div>
        </div>
      )}

      {/* TERMINAL TAB */}
      {tab==='terminal' && (
        <div>
          <div style={{marginBottom:10,color:'var(--fg-muted)',fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)'}}>
            Dostępne komendy: <code style={{color:'var(--accent)'}}>uptime</code>,&nbsp;
            <code style={{color:'var(--accent)'}}>df -h</code>,&nbsp;
            <code style={{color:'var(--accent)'}}>ps aux</code>,&nbsp;
            <code style={{color:'var(--accent)'}}>who</code>,&nbsp;
            <code style={{color:'var(--accent)'}}>hostname</code>
          </div>
          <div ref={termRef} style={{background:'var(--bg)',borderRadius:8,padding:'12px 14px',
            fontFamily:'var(--font-mono)',fontSize:'var(--fs-xs)',lineHeight:1.7,
            height:340,overflowY:'auto',color:'var(--fg-muted)',border:'1px solid var(--line)',marginBottom:10}}>
            <div style={{color:'var(--fg-dim)',marginBottom:8}}>
              {`# Terminal SSH → ${srv.username}@${srv.host}:${srv.port}`}
            </div>
            {termOut.map((o,i) => (
              <div key={i} style={{
                color: o.type==='cmd'?'var(--accent)':o.type==='err'?'var(--err)':'var(--fg-muted)',
                whiteSpace:'pre-wrap',wordBreak:'break-all',marginBottom:4
              }}>{o.text}</div>
            ))}
            {termBusy && <div style={{color:'var(--fg-dim)',animation:'_nb-pulse 1s ease infinite'}}>▋</div>}
          </div>
          <div style={{display:'flex',gap:8}}>
            <input value={termCmd} onChange={e=>setTermCmd(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter')runTermCmd();}}
              placeholder="$ wpisz komendę…"
              style={{flex:1,height:36,padding:'0 12px',background:'var(--bg)',
                border:'1px solid var(--line-strong)',borderRadius:7,color:'var(--accent)',
                fontSize:'var(--fs-sm)',outline:'none',fontFamily:'var(--font-mono)'}}/>
            <button className="btn primary" onClick={runTermCmd} disabled={termBusy}>
              <Icon name="upload" size={12}/> Wyślij
            </button>
            <button className="btn" onClick={()=>setTermOut([])}>Wyczyść</button>
          </div>
        </div>
      )}
    </SrvModal>
  );
};

// ─── Główny ekran Serwery ────────────────────────────────────────────────────
const Servers = () => {
  const [servers,  setServers]  = React.useState([]);
  const [statuses, setStatuses] = React.useState({});
  const [loading,  setLoading]  = React.useState(true);
  const [addOpen,  setAddOpen]  = React.useState(false);
  const [editSrv,  setEditSrv]  = React.useState(null);
  const [connSrv,  setConnSrv]  = React.useState(null);  // connected server detail
  const [pinging,  setPinging]  = React.useState({});
  const [delConfirm, setDelConfirm] = React.useState(null);

  const loadServers = async () => {
    try {
      const r = await fetch('/api/servers', { credentials:'include' });
      if (r.ok) {
        const d = await r.json();
        setServers(d.servers || []);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  const pingAll = async (srvList) => {
    for (const s of srvList) {
      setPinging(p => ({ ...p, [s.id]: true }));
      try {
        const r = await fetch(`/api/servers/${s.id}/simple-ping`, { credentials:'include' });
        const d = await r.json();
        setStatuses(st => ({ ...st, [s.id]: d.reachable ? 'online' : 'offline' }));
      } catch {
        setStatuses(st => ({ ...st, [s.id]: 'offline' }));
      } finally {
        setPinging(p => ({ ...p, [s.id]: false }));
      }
    }
  };

  React.useEffect(() => { loadServers(); }, []);
  React.useEffect(() => { if (servers.length) pingAll(servers); }, [servers.length]);

  const handleSaved = (srv) => {
    setServers(prev => {
      const idx = prev.findIndex(s => s.id === srv.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = srv; return n; }
      return [...prev, srv];
    });
    setAddOpen(false); setEditSrv(null);
    pingAll([srv]);
  };

  const handleDelete = async (id) => {
    await fetch(`/api/servers/${id}`, { method:'DELETE', credentials:'include' });
    setServers(prev => prev.filter(s => s.id !== id));
    setDelConfirm(null);
  };

  const handleConnect = async (srv) => {
    setStatuses(st => ({ ...st, [srv.id]: 'connecting' }));
    try {
      const r = await fetch(`/api/servers/${srv.id}/connect`, { credentials:'include' });
      if (r.ok) {
        setStatuses(st => ({ ...st, [srv.id]: 'connected' }));
        setConnSrv(srv);
      } else {
        setStatuses(st => ({ ...st, [srv.id]: 'offline' }));
      }
    } catch {
      setStatuses(st => ({ ...st, [srv.id]: 'offline' }));
    }
  };

  const handleRefreshStatus = (srv) => pingAll([srv]);

  React.useEffect(() => {
    const onAdd = () => setAddOpen(true);
    const onRefresh = () => loadServers().then(() => pingAll(servers));
    document.addEventListener('nimbus:add-server', onAdd);
    document.addEventListener('nimbus:refresh-servers', onRefresh);
    return () => {
      document.removeEventListener('nimbus:add-server', onAdd);
      document.removeEventListener('nimbus:refresh-servers', onRefresh);
    };
  }, [servers]);

  return (
    <div>
      {/* Status info */}
      <div style={{marginBottom:16,color:'var(--fg-muted)',fontSize:'var(--fs-sm)',fontFamily:'var(--font-mono)'}}>
        {servers.length} {servers.length===1?'serwer':'serwerów'} ·&nbsp;
        {Object.values(statuses).filter(s=>s==='online'||s==='connected').length} online
      </div>

      {/* Loading */}
      {loading && (
        <div style={{textAlign:'center',padding:'60px 0',color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>
          <div style={{width:18,height:18,border:'2px solid var(--line-strong)',borderTopColor:'var(--accent)',
            borderRadius:'50%',animation:'_spin .6s linear infinite',margin:'0 auto 12px'}}/>
          Ładowanie serwerów…
        </div>
      )}

      {/* Empty state */}
      {!loading && servers.length===0 && (
        <div style={{textAlign:'center',padding:'80px 0',color:'var(--fg-dim)'}}>
          <Icon name="network" size={48} style={{opacity:.2,marginBottom:16,display:'block',margin:'0 auto 16px'}}/>
          <div style={{fontSize:'var(--fs-lg)',fontWeight:600,marginBottom:8}}>Brak serwerów</div>
          <div style={{fontSize:'var(--fs-sm)',color:'var(--fg-muted)',marginBottom:24}}>
            Dodaj pierwsze zdalne połączenie SSH
          </div>
          <button className="btn primary" onClick={()=>setAddOpen(true)}>
            <Icon name="plus" size={12}/> Dodaj serwer
          </button>
        </div>
      )}

      {/* Server cards grid */}
      {!loading && servers.length > 0 && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))',gap:14}}>
          {servers.map(srv => {
            const status = statuses[srv.id] || 'unknown';
            const isPinging = pinging[srv.id];
            const isConnected = status === 'connected';
            return (
              <div key={srv.id} className="card" style={{transition:'box-shadow .2s'}}
                onMouseEnter={e=>e.currentTarget.style.boxShadow='0 4px 20px rgba(0,0,0,.2)'}
                onMouseLeave={e=>e.currentTarget.style.boxShadow=''}>
                {/* Card header */}
                <div style={{padding:'14px 16px',borderBottom:'1px solid var(--line)',
                  display:'flex',alignItems:'center',gap:12}}>
                  {/* Server icon */}
                  <div style={{width:40,height:40,borderRadius:10,flexShrink:0,
                    background:'linear-gradient(135deg,var(--accent),oklch(from var(--accent) calc(l - 0.1) c h))',
                    display:'grid',placeItems:'center',
                    boxShadow:'0 4px 12px color-mix(in oklch,var(--accent) 30%,transparent)'}}>
                    <Icon name="network" size={18} style={{color:'#fff'}}/>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:600,fontSize:'var(--fs-base)',
                      whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{srv.name}</div>
                    <div style={{color:'var(--fg-muted)',fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)',marginTop:1}}>
                      {srv.username}@{srv.host}
                    </div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    {isPinging
                      ? <span className="badge warn"><span className="dot pulse"/>PING…</span>
                      : <SrvBadge status={status}/>
                    }
                  </div>
                </div>

                {/* Card body */}
                <div style={{padding:'14px 16px'}}>
                  {/* Info rows */}
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px 12px',marginBottom:14}}>
                    {[
                      ['Adres IP', srv.host],
                      ['Port SSH', srv.port],
                      ['Użytkownik', srv.username],
                      ['Auth', srv.key_path ? 'Klucz SSH' : 'Hasło'],
                    ].map(([k,v]) => (
                      <div key={k}>
                        <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',textTransform:'uppercase',
                          letterSpacing:'.04em',marginBottom:2}}>{k}</div>
                        <div style={{fontSize:'var(--fs-sm)',fontFamily:'var(--font-mono)',color:'var(--fg)'}}>{v}</div>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    <button className="btn primary" style={{flex:1}}
                      onClick={()=>handleConnect(srv)}
                      disabled={status==='connecting'}>
                      <Icon name="terminal" size={12}/>
                      {status==='connecting'?'Łączenie…':isConnected?'Otwórz panel':'Połącz z serwerem'}
                    </button>
                    <button className="btn" title="Sprawdź status" onClick={()=>handleRefreshStatus(srv)}>
                      <Icon name="refresh" size={12}/>
                    </button>
                    <button className="btn" title="Edytuj" onClick={()=>setEditSrv(srv)}>
                      <Icon name="settings" size={12}/>
                    </button>
                    <button className="btn danger" title="Usuń" onClick={()=>setDelConfirm(srv.id)}>
                      <Icon name="close" size={12}/>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {addOpen  && <ServerForm onSave={handleSaved} onClose={()=>setAddOpen(false)}/>}
      {editSrv  && <ServerForm initial={editSrv} onSave={handleSaved} onClose={()=>setEditSrv(null)}/>}
      {connSrv  && <ServerDetail srv={connSrv} onClose={()=>{ setConnSrv(null); setStatuses(st=>({...st,[connSrv.id]:'online'})); }}/>}

      {/* Delete confirmation */}
      {delConfirm && (
        <SrvModal title="Usuń serwer" sub="Ta operacja jest nieodwracalna" onClose={()=>setDelConfirm(null)} width={400}
          footer={<>
            <button className="btn" onClick={()=>setDelConfirm(null)}>Anuluj</button>
            <button className="btn danger" onClick={()=>handleDelete(delConfirm)}>Usuń serwer</button>
          </>}>
          <p style={{color:'var(--fg-muted)',fontSize:'var(--fs-sm)'}}>
            Czy na pewno chcesz usunąć serwer <strong style={{color:'var(--fg)'}}>
              {servers.find(s=>s.id===delConfirm)?.name}
            </strong>? Konfiguracja połączenia zostanie trwale usunięta.
          </p>
        </SrvModal>
      )}
    </div>
  );
};

window.Servers = Servers;
