// ===== System: Logs, Processes, Terminal =====

// ─── Mini KPI (eksportowany też dla services) ─────────────────────────────────
const useStore = window.useStore;
const storeSet = window.storeSet;
const Icon = window.Icon;
const Modal = window.Modal;

const Mini2 = ({label, v, sub, color}) => (
  <div className="kpi">
    <div className="kpi-label">{label}</div>
    <div className="kpi-value" style={{color: color || 'var(--fg)'}}>{v}</div>
    {sub && <div className="kpi-foot"><span>{sub}</span></div>}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// LOGI
// ═══════════════════════════════════════════════════════════════════════════

const Logs = () => {
  const LOGS_STORE = useStore('LOGS');
  const [lines,  setLines]  = React.useState([]);
  const [filter, setFilter] = React.useState({ level:'all', src:'all', q:'' });
  const [paused, setPaused] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  // Załaduj przy mount ze store lub API
  React.useEffect(() => {
    if (LOGS_STORE && LOGS_STORE.length) {
      setLines(LOGS_STORE);
      setLoading(false);
    }
  }, []);

  // Strumień nowych logów co 4s
React.useEffect(() => {
  if (paused) return;
  const load = async () => {
    try {
      const r = await fetch('/api/logs?n=200', {credentials:'include'}); // Zwiększono do 200
      if (!r.ok) return;
      const raw = await r.json();
      if (!Array.isArray(raw) || !raw.length) return;
      
      const parsed = raw
        .filter(l => l && (l.msg || l.Msg || l.message || l.MESSAGE || l._TRANSPORT || l.SYSLOG_IDENTIFIER))
        .map(l => {
          // Pobierz źródło z różnych możliwych pól
          let src = l.src || l.Src || l.unit || l._SYSTEMD_UNIT || l.SYSLOG_IDENTIFIER || l._TRANSPORT || 'kernel';
          // Oczyść źródło
          if (src === 'kernel') src = 'kernel';
          else if (src.includes('.service')) src = src.replace('.service', '');
          else if (src === 'systemd') src = 'systemd';
          
          // Pobierz poziom logu
          let lvl = (l.lvl || l.Lvl || l.level || l.PRIORITY || 'INFO').toString().toUpperCase();
          if (lvl === '3') lvl = 'ERR';
          else if (lvl === '4') lvl = 'WARN';
          else if (lvl === '5' || lvl === '6') lvl = 'INFO';
          else if (lvl === '7') lvl = 'DEBUG';
          
          // Pobierz timestamp
          let ts = l.t || l.Time || l.time || l._SOURCE_REALTIME_TIMESTAMP || '';
          if (ts && ts.length > 19) ts = ts.slice(0, 19).replace('T', ' ');
          
          // Pobierz wiadomość
          let msg = l.msg || l.Msg || l.message || l.MESSAGE || '';
          // Odetnij zduplikowaną nazwę jednostki z początku wiadomości
          if (msg.startsWith(src + ': ')) msg = msg.slice(src.length + 2);
          
          return { t: ts, src: src, lvl: lvl, msg: msg };
        })
        .filter(l => l.msg && l.msg.trim() !== '');
      
      if (parsed.length) {
        setLines(parsed);
        storeSet('LOGS', parsed);
        setLoading(false);
      }
    } catch (err) {
      console.error('Log load error:', err);
    }
  };
  load();
  const id = setInterval(load, 4000);
  return () => clearInterval(id);
}, [paused]);

  // Synchronizuj ze store gdy przyjdą dane z _syncOnce
  React.useEffect(() => {
    if (!paused && LOGS_STORE && LOGS_STORE.length) {
      setLines(prev => {
        // Użyj store tylko jeśli nie mamy własnych, nowszych danych
        if (prev.length === 0) return LOGS_STORE;
        return prev;
      });
    }
  }, [LOGS_STORE, paused]);

  const sources  = React.useMemo(() => Array.from(new Set(lines.map(l => l.src))).sort(), [lines]);
  const filtered = lines.filter(l => {
    if (filter.level !== 'all' && l.lvl !== filter.level) return false;
    if (filter.src   !== 'all' && l.src !== filter.src)   return false;
    if (filter.q) {
      const q = filter.q.toLowerCase();
      if (!l.msg.toLowerCase().includes(q) && !l.src.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const counts = lines.reduce((a, l) => { a[l.lvl] = (a[l.lvl]||0) + 1; return a; }, {});

  const downloadLogs = () => {
    const text = filtered.map(l => `[${l.t}] [${l.lvl}] ${l.src}: ${l.msg}`).join('\n');
    const blob = new Blob([text], {type:'text/plain'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nimbus-logs-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.txt`;
    a.click();
  };

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="grid grid-4">
        <Mini2 label="WSZYSTKICH"  v={lines.length}/>
        <Mini2 label="OSTRZEŻENIA" v={counts.WARN||0}                           color="var(--warn)"/>
        <Mini2 label="BŁĘDY"       v={(counts.ERROR||0)+(counts.ERR||0)}         color="var(--err)"/>
        <Mini2 label="INFO"        v={counts.INFO||0}                            color="var(--info)"/>
      </div>

      <div className="card">
        <div className="card-head" style={{flexWrap:'wrap',gap:8}}>
          <div className="row gap-sm" style={{flexWrap:'wrap'}}>
            <span className="card-title" style={{marginRight:8}}>Strumień logów</span>
            {!paused
              ? <span className="badge ok"><span className="dot pulse"/>NA ŻYWO</span>
              : <span className="badge warn">WSTRZYMANO</span>}
          </div>
          <div className="row gap-sm" style={{marginLeft:'auto',flexWrap:'wrap'}}>
            <div className="topbar-search" style={{flex:'none',width:200}}>
              <Icon name="search" size={12}/>
              <input placeholder="Filtruj treść…" value={filter.q}
                onChange={e => setFilter({...filter, q:e.target.value})}/>
            </div>
            <select className="select" style={{width:'auto'}} value={filter.level}
              onChange={e => setFilter({...filter, level:e.target.value})}>
              <option value="all">Wszystkie poziomy</option>
              <option>INFO</option><option>WARN</option><option>ERROR</option>
              <option>DEBUG</option><option>OK</option>
            </select>
            <select className="select" style={{width:'auto'}} value={filter.src}
              onChange={e => setFilter({...filter, src:e.target.value})}>
              <option value="all">Wszystkie źródła</option>
              {sources.map(s => <option key={s}>{s}</option>)}
            </select>
            <button className="btn sm" onClick={() => setPaused(p => !p)}>
              {paused
                ? <><Icon name="play"   size={11}/> Wznów</>
                : <><Icon name="pause2" size={11}/> Pauza</>}
            </button>
            <button className="btn sm" onClick={downloadLogs}>
              <Icon name="download" size={11}/>
            </button>
          </div>
        </div>

        <div style={{maxHeight:520, overflow:'auto'}}>
          {/* Nagłówek sticky */}
          <div className="log-line" style={{
            background:'var(--bg-2)', position:'sticky', top:0,
            fontWeight:500, color:'var(--fg-muted)',
            textTransform:'uppercase', fontSize:10, letterSpacing:'.06em',
          }}>
            <span>Czas</span><span>Poziom</span><span>Źródło</span><span>Wiadomość</span>
          </div>

          {loading && (
            <div style={{padding:24,textAlign:'center',color:'var(--fg-dim)'}}>
              <span className="dot pulse" style={{display:'inline-block',marginRight:8}}/>
              Ładowanie logów z journald…
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div style={{padding:20,textAlign:'center',color:'var(--fg-dim)'}}>
              Brak logów spełniających kryteria
            </div>
          )}

          {filtered.map((l, i) => (
            <div key={i} className="log-line">
              <span className="log-time">{l.t}</span>
              <span className={'log-level ' + (l.lvl||'INFO')}>{l.lvl||'INFO'}</span>
              <span className="log-source">{l.src}</span>
              <span className="log-msg">{l.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// PROCESY
// ═══════════════════════════════════════════════════════════════════════════

const KillDialog = ({ proc, onClose, onKill }) => {
  const [sig, setSig] = React.useState('TERM');
  return (
    <Modal title={`Zakończ proces · ${proc.name}`} sub={`PID ${proc.pid}`} onClose={onClose} width={420}
      footer={<div className="row gap-sm" style={{marginLeft:'auto'}}>
        <button className="btn sm" onClick={onClose}>Anuluj</button>
        <button className="btn sm danger" onClick={() => { onKill(proc.pid, sig); onClose(); }}>
          Wyślij sygnał {sig}
        </button>
      </div>}
    >
      <div className="col" style={{gap:12}}>
        <div>Wysyłanie sygnału do <span className="mono" style={{fontWeight:600}}>{proc.name}</span> (PID {proc.pid})</div>
        <div className="segmented">
          {['TERM','KILL','HUP','STOP'].map(s => (
            <button key={s} className={sig===s?'active':''} onClick={()=>setSig(s)}>{s}</button>
          ))}
        </div>
        <div className="dim" style={{fontSize:'var(--fs-xs)'}}>
          {sig==='TERM' && 'SIGTERM — grzeczne zakończenie (proces może odmówić)'}
          {sig==='KILL' && 'SIGKILL — natychmiastowe zakończenie (nieodwołalne)'}
          {sig==='HUP'  && 'SIGHUP — przeładowanie konfiguracji'}
          {sig==='STOP' && 'SIGSTOP — wstrzymanie procesu (nie kończy)'}
        </div>
      </div>
    </Modal>
  );
};

const Processes = () => {
  const PROCESSES = useStore('PROCESSES');
  const [sortBy,    setSort]    = React.useState('cpu');
  const [procs,     setProcs]   = React.useState([]);
  const [killFor,   setKillFor] = React.useState(null);
  const [filter,    setFilter]  = React.useState('');
  const [loading,   setLoading] = React.useState(true);

  // Parser — normalizuje pola z /api/processes
  const parseProcs = (raw) => {
    if (!Array.isArray(raw) || !raw.length) return [];
    const maxCPU = Math.max(...raw.map(p => p.CPU || p.cpu || 0));
    const scale  = maxCPU > 200 ? 100 / maxCPU : 1;
    return raw.slice(0, 60).map(p => ({
      pid:  p.PID     || p.pid  || 0,
      user: p.User    || p.user || 'root',
      name: p.Name    || p.name || p.Command || p.command || '—',
      cmd:  p.Command || p.command || p.Name || p.name || '—',
      cpu:  Math.round((p.CPU  || p.cpu  || 0) * scale * 10) / 10,
      mem:  Math.round((p.Mem  || p.mem  || p.Memory || p.memory || 0) * 10) / 10,
    }));
  };

  // Odśwież procesy co 4s z /api/processes
  React.useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch('/api/processes', {credentials:'include'});
        if (!r.ok) return;
        const raw = await r.json();
        const parsed = parseProcs(raw);
        if (parsed.length) {
          setProcs(parsed);
          storeSet('PROCESSES', parsed);
          setLoading(false);
        }
      } catch {}
    };
    // Załaduj od razu ze store jeśli jest
    if (PROCESSES && PROCESSES.length) {
      setProcs(PROCESSES);
      setLoading(false);
    }
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, []);

  const sorted = React.useMemo(() => {
    let list = [...procs];
    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || String(p.pid).includes(q) || p.user.toLowerCase().includes(q));
    }
    return list.sort((a, b) =>
      sortBy === 'cpu' ? b.cpu - a.cpu :
      sortBy === 'mem' ? b.mem - a.mem :
      a.pid - b.pid
    );
  }, [procs, sortBy, filter]);

  const totalCpu = procs.reduce((s,p) => s + (p.cpu||0), 0);
  const totalMem = procs.reduce((s,p) => s + (p.mem||0), 0);

  const killProcess = async (pid, signal) => {
    try {
      await fetch('/diagnostics/processes/kill', {
        method: 'POST', credentials: 'include',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({pid, signal}),
      });
      // Odśwież po 1s
      setTimeout(async () => {
        const r = await fetch('/api/processes', {credentials:'include'});
        if (r.ok) {
          const raw = await r.json();
          const parsed = parseProcs(raw);
          if (parsed.length) setProcs(parsed);
        }
      }, 1000);
    } catch(e) {
      alert('Błąd: ' + e.message);
    }
  };

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      {killFor && <KillDialog proc={killFor} onClose={()=>setKillFor(null)} onKill={killProcess}/>}

      <div className="grid grid-4">
        <Mini2 label="PROCESÓW"       v={procs.length}/>
        <Mini2 label="CPU UŻYWANE"    v={Math.min(totalCpu, 100).toFixed(1)+'%'} color="var(--accent)"/>
        <Mini2 label="PAMIĘĆ UŻYWANA" v={totalMem.toFixed(1)+'%'}               color="oklch(0.7 0.15 280)"/>
        <Mini2 label="ZOMBIE"         v="0"                                       color="var(--ok)"/>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Procesy systemowe · live</div>
          <div className="card-actions">
            <div className="topbar-search" style={{width:180}}>
              <Icon name="search" size={12}/>
              <input placeholder="Filtruj…" value={filter}
                onChange={e => setFilter(e.target.value)}/>
            </div>
            <div className="segmented">
              <button className={sortBy==='cpu'?'active':''} onClick={()=>setSort('cpu')}>CPU</button>
              <button className={sortBy==='mem'?'active':''} onClick={()=>setSort('mem')}>Pamięć</button>
              <button className={sortBy==='pid'?'active':''} onClick={()=>setSort('pid')}>PID</button>
            </div>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th style={{width:72}}>PID</th>
              <th style={{width:110}}>Użytkownik</th>
              <th>Polecenie</th>
              <th style={{width:200}}>CPU %</th>
              <th style={{width:200}}>Pamięć %</th>
              <th style={{width:44}}></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} style={{textAlign:'center',padding:24,color:'var(--fg-dim)'}}>
                <span className="dot pulse" style={{display:'inline-block',marginRight:8}}/>
                Ładowanie procesów…
              </td></tr>
            )}
            {!loading && sorted.length === 0 && (
              <tr><td colSpan={6} style={{textAlign:'center',padding:20,color:'var(--fg-dim)'}}>
                Brak procesów spełniających kryteria
              </td></tr>
            )}
            {sorted.map(p => (
              <tr key={p.pid}>
                <td className="mono">{p.pid}</td>
                <td><span className="chip">{p.user}</span></td>
                <td className="mono" style={{fontSize:'var(--fs-xs)'}}>{p.name}</td>
                <td>
                  <div className="row gap-sm">
                    <div className="bar" style={{flex:1}}>
                      <i style={{width:Math.min(100, p.cpu*4)+'%'}}/>
                    </div>
                    <span className="mono" style={{width:46,textAlign:'right'}}>{p.cpu.toFixed(1)}</span>
                  </div>
                </td>
                <td>
                  <div className="row gap-sm">
                    <div className="bar" style={{flex:1,background:'var(--bg-3)'}}>
                      <i style={{width:Math.min(100, p.mem*8)+'%', background:'oklch(0.7 0.15 280)'}}/>
                    </div>
                    <span className="mono" style={{width:46,textAlign:'right'}}>{p.mem.toFixed(1)}</span>
                  </div>
                </td>
                <td>
                  <button className="icon-btn" title="Zakończ proces"
                    onClick={() => setKillFor(p)}>
                    <Icon name="more"/>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// TERMINAL
// ═══════════════════════════════════════════════════════════════════════════

// Lokalne odpowiedzi — fallback gdy API nie odpowiada
const LOCAL_CMDS = {
  help: () => [
    'Dostępne polecenia (tryb offline):',
    '  help, pwd, ls, cd, df, free, uname, date, uptime, echo, clear',
    'Gdy API jest dostępne — wykonywane są prawdziwe polecenia na serwerze.',
  ].join('\n'),
  pwd: (_, cwd) => cwd,
  whoami: () => 'root',
  date:   () => new Date().toString(),
  uname:  (args) => args.includes('-a')
    ? 'Linux nimbus 6.8.0-generic #1 SMP x86_64 GNU/Linux'
    : 'Linux',
  uptime: () => ' up — dni, load average: —',
  echo:   (args) => args.join(' '),
  df: () => [
    'Filesystem        Size  Used Avail Use% Mounted on',
    '(dane niedostępne w trybie offline — spróbuj przez API)',
  ].join('\n'),
  free: () => [
    '              total   used   free',
    '(dane niedostępne w trybie offline)',
  ].join('\n'),
};

const Terminal = () => {
  const [history,   setHistory]   = React.useState([
    { type:'sys', text:'Nimbus NAS · terminal · połączenie przez API' },
    { type:'sys', text:'Łączenie z sesją…' },
  ]);
  const [input,     setInput]     = React.useState('');
  const [cwd,       setCwd]       = React.useState('/root');
  const [sessionId, setSessionId] = React.useState(null);
  const [apiOk,     setApiOk]     = React.useState(true);
  const [historyIdx,setHistIdx]   = React.useState(-1);
  const [cmdHistory,setCmdHistory]= React.useState([]);

  const ref   = React.useRef(null);
  const inRef = React.useRef(null);

  // Utwórz sesję przy mount
  React.useEffect(() => {
    fetch('/terminal/sessions', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({shell:'/bin/bash'}),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) throw new Error('brak odpowiedzi');
        setSessionId(d.id || d.ID || 'default');
        setCwd(d.cwd || '/root');
        setApiOk(true);
        setHistory(h => [
          ...h.filter(l => l.text !== 'Łączenie z sesją…'),
          { type:'sys', text:`Sesja aktywna · ${d.shell || '/bin/bash'} · PID sesji: ${(d.id||'').slice(-8)}` },
        ]);
      })
      .catch(() => {
        setApiOk(false);
        setHistory(h => [
          ...h.filter(l => l.text !== 'Łączenie z sesją…'),
          { type:'sys', text:'API niedostępne — tryb lokalny (symulacja)' },
        ]);
      });
  }, []);

  // Auto-scroll
  React.useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [history]);

  const appendLines = (lines, type='out') =>
    setHistory(h => [...h, ...lines.map(text => ({type, text}))]);

  const run = async (rawCmd) => {
    const cmd = rawCmd.trim();
    setHistory(h => [...h, {type:'in', cmd: rawCmd, cwd}]);
    setCmdHistory(h => [rawCmd, ...h].slice(0, 100));
    setHistIdx(-1);

    if (!cmd) return;
    if (cmd === 'clear') { setHistory([]); return; }

    // ── Tryb API ──────────────────────────────────────────────────────────
    if (apiOk && sessionId) {
      try {
        const r = await fetch(`/terminal/sessions/${sessionId}/execute`, {
          method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({command: cmd, cwd}),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();

        const output = (data.output || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (output) {
          const lines = output.split('\n');
          // Usuń ostatnią pustą linię (tail newline)
          if (lines[lines.length-1] === '') lines.pop();
          appendLines(lines, data.exit_code !== 0 ? 'err' : 'out');
        }

        if (data.cwd && data.cwd !== cwd) setCwd(data.cwd);
        return;
      } catch(e) {
        setApiOk(false);
        appendLines(['[API niedostępne — przełączono na tryb lokalny]'], 'sys');
      }
    }

    // ── Tryb lokalny (fallback) ───────────────────────────────────────────
    const [bin, ...args] = cmd.split(/\s+/);

    if (bin === 'cd') {
      const target = args[0] || '/root';
      setCwd(target.startsWith('/') ? target : (cwd + '/' + target).replace(/\/+/g, '/'));
      return;
    }

    if (LOCAL_CMDS[bin]) {
      const out = LOCAL_CMDS[bin](args, cwd);
      appendLines(out.split('\n'));
    } else {
      appendLines([`${bin}: polecenie nie znalezione (tryb lokalny). Wpisz 'help'.`], 'err');
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter') {
      run(input);
      setInput('');
      setHistIdx(-1);
      return;
    }
    // Historia komend (strzałki)
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(historyIdx + 1, cmdHistory.length - 1);
      setHistIdx(next);
      setInput(cmdHistory[next] || '');
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = historyIdx - 1;
      if (next < 0) { setHistIdx(-1); setInput(''); }
      else { setHistIdx(next); setInput(cmdHistory[next] || ''); }
    }
    // Tab — prosta sugestia (nie pełny autocomplete)
    if (e.key === 'Tab') {
      e.preventDefault();
    }
  };

  const disconnect = () => {
    if (sessionId) {
      fetch(`/terminal/sessions/${sessionId}`, {method:'DELETE',credentials:'include'}).catch(()=>{});
    }
    setSessionId(null);
    setApiOk(false);
    setHistory([{type:'sys', text:'Sesja zakończona.'}]);
  };

  const reconnect = () => {
    setHistory([
      {type:'sys', text:'Nimbus NAS · terminal · ponowne połączenie…'},
    ]);
    setSessionId(null);
    setApiOk(false);
    fetch('/terminal/sessions', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({shell:'/bin/bash'}),
    })
      .then(r=>r.ok?r.json():null)
      .then(d=>{
        if (!d) throw new Error();
        setSessionId(d.id||'default');
        setCwd(d.cwd||'/root');
        setApiOk(true);
        setHistory(h=>[...h,{type:'sys',text:`Połączono · sesja ${(d.id||'').slice(-8)}`}]);
      })
      .catch(()=>{
        setApiOk(false);
        setHistory(h=>[...h,{type:'sys',text:'Nie udało się połączyć — tryb lokalny'}]);
      });
  };

  const downloadLog = () => {
    const text = history
      .map(h => {
        if (h.type==='in')  return `$ ${h.cmd}`;
        if (h.type==='out') return h.text;
        if (h.type==='err') return `[ERR] ${h.text}`;
        if (h.type==='sys') return `# ${h.text}`;
        return h.text;
      })
      .join('\n');
    const blob = new Blob([text], {type:'text/plain'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `terminal-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.txt`;
    a.click();
  };

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      {/* Pasek statusu */}
      <div className="row" style={{justifyContent:'space-between'}}>
        <div className="row gap-md">
          <span className={`badge ${apiOk&&sessionId?'ok':'warn'}`}>
            <span className={`dot ${apiOk&&sessionId?'pulse':''}`}/>
            {apiOk && sessionId ? 'POŁĄCZONO' : apiOk ? 'ŁĄCZENIE…' : 'TRYB LOKALNY'}
          </span>
          <span className="mono dim" style={{fontSize:'var(--fs-xs)'}}>
            root@nimbus · {cwd} · {sessionId ? sessionId.slice(-12) : '—'}
          </span>
        </div>
        <div className="row gap-sm">
          <button className="btn sm" onClick={downloadLog}>Pobierz log</button>
          <button className="btn sm" onClick={() => setHistory([])}>Wyczyść</button>
          {(!apiOk || !sessionId)
            ? <button className="btn sm primary" onClick={reconnect}>Połącz</button>
            : <button className="btn sm danger"  onClick={disconnect}>Rozłącz</button>}
        </div>
      </div>

      {/* Terminal */}
      <div className="terminal" ref={ref}
        onClick={() => inRef.current && inRef.current.focus()}>
        {history.map((h, i) => {
          if (h.type==='sys') return (
            <div key={i} style={{color:'oklch(0.7 0.13 220)',opacity:0.8}}>{h.text}</div>
          );
          if (h.type==='out') return (
            <div key={i} style={{whiteSpace:'pre-wrap'}}>{h.text}</div>
          );
          if (h.type==='err') return (
            <div key={i} style={{color:'oklch(0.66 0.2 25)',whiteSpace:'pre-wrap'}}>{h.text}</div>
          );
          if (h.type==='in') return (
            <div key={i}>
              <span className="term-prompt">root@nimbus</span>
              <span style={{color:'#d6d9df'}}>:</span>
              <span className="term-path">{h.cwd}</span>
              <span style={{color:'#d6d9df'}}>$ </span>
              <span>{h.cmd}</span>
            </div>
          );
        })}

        {/* Linia wejścia */}
        <div className="row" style={{gap:0,alignItems:'baseline'}}>
          <span className="term-prompt">root@nimbus</span>
          <span style={{color:'#d6d9df'}}>:</span>
          <span className="term-path">{cwd}</span>
          <span style={{color:'#d6d9df'}}>$&nbsp;</span>
          <input ref={inRef} className="term-input" value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            autoFocus spellCheck={false}
            autoCapitalize="none" autoComplete="off" autoCorrect="off"/>
        </div>
      </div>

      {/* Podpowiedzi */}
      <div className="dim" style={{fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)'}}>
        Wskazówka — spróbuj:&nbsp;
        {['ls -la','df -h','zpool status','docker ps','smartctl --scan','journalctl -n 20','htop'].map(c => (
          <span key={c} className="chip accent" style={{cursor:'pointer',marginRight:4}}
            onClick={() => { setInput(c); inRef.current && inRef.current.focus(); }}>
            {c}
          </span>
        ))}
        <span style={{marginLeft:8,color:'var(--fg-dim)'}}>↑↓ historia poleceń</span>
      </div>
    </div>
  );
};

// ── Export ────────────────────────────────────────────────────────────────────
window.Logs      = Logs;
window.Mini2     = Mini2;
window.Processes = Processes;
window.Terminal  = Terminal;
