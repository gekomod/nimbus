// ===== Services: Docker, Network, Shares, Media =====
// Połączony plik: nowy wygląd (_new) + prawdziwe API (data.jsx / services.go)

// ─── Shared helpers ────────────────────────────────────────────────────────

const useStore = window.useStore;
const storeSet = window.storeSet;
const Icon = window.Icon;
const Modal = window.Modal;
const LineChart = window.LineChart;
const genSeries = window.genSeries;
const Logs = window.Logs;
const Terminal = window.Terminal;

const StateBadge = ({s}) => {
  const st = (s||'').toLowerCase();
  if (st==='running')    return <span className="badge ok"><span className="dot pulse"/>RUNNING</span>;
  if (st==='stopped')    return <span className="badge"><span className="dot"/>STOPPED</span>;
  if (st==='restarting') return <span className="badge warn"><span className="dot pulse"/>RESTART</span>;
  if (st==='paused')     return <span className="badge warn"><span className="dot"/>PAUSED</span>;
  return <span className="badge dim">{st||'—'}</span>;
};

const KV = ({k,v}) => (
  <div className="row" style={{justifyContent:'space-between',gap:16}}>
    <span className="dim" style={{fontSize:'var(--fs-sm)'}}>{k}</span>
    <span style={{fontSize:'var(--fs-sm)'}}>{v}</span>
  </div>
);

// ─── Mini KPI card ─────────────────────────────────────────────────────────
const Mini2 = ({label, v, sub, color}) => (
  <div className="kpi">
    <div className="kpi-label">{label}</div>
    <div className="kpi-value" style={{color: color || 'var(--fg)'}}>{v}</div>
    <div className="kpi-foot"><span>{sub}</span></div>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// DOCKER
// ═══════════════════════════════════════════════════════════════════════════

// ── Dialogi ─────────────────────────────────────────────────────────────────

const LogsDialog = ({ c, onClose }) => {
  const [lines, setLines] = React.useState([]);
  const [filter, setFilter] = React.useState('');
  const [tail, setTail] = React.useState(100);
  const logRef = React.useRef(null);

  React.useEffect(() => {
    fetch(`/services/docker/container/logs/${encodeURIComponent(c.name)}?tail=${tail}`, {credentials:'include'})
      .then(r => r.ok ? r.text() : null)
      .then(txt => {
        if (!txt) return;
        setLines(txt.split('\n').filter(Boolean));
        setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 50);
      })
      .catch(() => setLines(['[błąd ładowania logów]']));
  }, [c.name, tail]);

  const shown = lines.filter(l => !filter || l.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Modal title={`Logi · ${c.name}`} sub={`${c.image} · tail ${tail}`} onClose={onClose} width={780}
      footer={<div className="row gap-sm">
        <div className="segmented">
          {[50,100,500].map(n=><button key={n} className={tail===n?'active':''} onClick={()=>setTail(n)}>tail {n}</button>)}
        </div>
        <button className="btn sm primary" onClick={onClose}>Zamknij</button>
      </div>}
    >
      <div className="row gap-sm" style={{marginBottom:10}}>
        <Icon name="search" size={13} style={{color:'var(--fg-dim)'}}/>
        <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Filtruj logi…"
          style={{flex:1,background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:5,
            padding:'5px 10px',color:'var(--fg)',fontFamily:'var(--font-mono)',fontSize:'var(--fs-xs)',outline:'none'}}/>
      </div>
      <div ref={logRef} style={{background:'var(--bg)',borderRadius:6,padding:'12px 14px',fontFamily:'var(--font-mono)',
        fontSize:'var(--fs-xs)',lineHeight:1.8,maxHeight:380,overflowY:'auto',color:'var(--fg-muted)'}}>
        {shown.length === 0
          ? <span className="dim">Ładowanie…</span>
          : shown.map((l,i)=>{
              const color = l.includes('WARN') ? 'var(--warn)' : l.includes('ERROR')||l.includes('ERR') ? 'var(--err)' : 'var(--fg-muted)';
              const bold = filter && l.toLowerCase().includes(filter.toLowerCase());
              return <div key={i} style={{color, fontWeight: bold?600:'normal'}}>{l}</div>;
            })}
      </div>
    </Modal>
  );
};

const TerminalDialog = ({ c, onClose }) => {
  const Modal = window.Modal;
  const [history, setHistory] = React.useState([
    { type:'system', text:`Łączenie z kontenerem: ${c.name} (docker exec -it ${c.name} /bin/sh)` },
  ]);
  const [input, setInput]           = React.useState('');
  const [cwd, setCwd]               = React.useState('/');
  const [cmdHistory, setCmdHistory] = React.useState([]);
  const [cmdIdx, setCmdIdx]         = React.useState(-1);
  const [busy, setBusy]             = React.useState(false);
  const bottomRef = React.useRef(null);
  const inputRef  = React.useRef(null);

  React.useEffect(() => {
    if (bottomRef.current) bottomRef.current.parentNode.scrollTop = bottomRef.current.offsetTop;
  }, [history]);
  React.useEffect(() => { inputRef.current?.focus(); }, []);

  const prompt = `root@${c.name}:${cwd}#`;

  const addLine = (type, text) => setHistory(h => [...h, { type, text }]);

  const execCmd = async (cmd) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/docker/exec/${encodeURIComponent(c.id || c.name)}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd }),
      });
      const data = await r.json();
      const out  = (data.output || '').replace(/\n$/, '');
      // Aktualizuj cwd po cd
      if (cmd.trim().startsWith('cd ') && data.exit_code === 0) {
        const pwdR = await fetch(`/api/docker/exec/${encodeURIComponent(c.id || c.name)}`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd: 'pwd' }),
        });
        const pwdD = await pwdR.json();
        setCwd((pwdD.output || '').trim() || '/');
      }
      return { out, exitCode: data.exit_code };
    } catch(e) {
      return { out: 'Błąd połączenia: ' + e.message, exitCode: 1 };
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const cmd = input.trim();
    if (!cmd || busy) return;
    setInput('');
    setCmdHistory(h => [cmd, ...h]);
    setCmdIdx(-1);
    addLine('input', `${prompt} ${cmd}`);
    if (cmd === 'clear') { setHistory([]); return; }
    if (cmd === 'exit')  { onClose(); return; }
    const { out, exitCode } = await execCmd(cmd);
    if (out) addLine(exitCode === 0 ? 'output' : 'error', out);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') { submit(); }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(cmdIdx + 1, cmdHistory.length - 1);
      setCmdIdx(next); setInput(cmdHistory[next] || '');
    }
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.max(cmdIdx - 1, -1);
      setCmdIdx(next); setInput(next === -1 ? '' : cmdHistory[next]);
    }
    else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); setHistory([]); }
  };

  return (
    <Modal title={`Terminal · ${c.name}`} sub={`docker exec -it ${c.name} /bin/sh`} onClose={onClose} width={820}
      footer={<div className="row gap-sm" style={{marginLeft:'auto'}}>
        <span style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>{cwd}</span>
        <button className="btn sm" onClick={()=>setHistory([])}>Wyczyść</button>
        <button className="btn sm primary" onClick={onClose}>Rozłącz</button>
      </div>}
    >
      <div
        onClick={()=>inputRef.current?.focus()}
        style={{background:'oklch(0.12 0.01 260)',borderRadius:8,padding:'14px 16px',
          fontFamily:'var(--font-mono)',fontSize:13,lineHeight:1.7,minHeight:380,maxHeight:420,
          overflowY:'auto',cursor:'text',color:'oklch(0.88 0.04 260)'}}>
        {history.map((l,i) => {
          const color = l.type==='system' ? 'oklch(0.55 0.1 260)'
            : l.type==='error'  ? 'oklch(0.65 0.2 25)'
            : l.type==='input'  ? 'oklch(0.88 0.04 260)'
            : 'oklch(0.82 0.06 145)';
          return (
            <div key={i} style={{color, whiteSpace:'pre-wrap', wordBreak:'break-all'}}>
              {l.type==='system' && <span style={{color:'oklch(0.45 0.1 260)',marginRight:6}}>›</span>}
              {l.text}
            </div>
          );
        })}
        <div style={{display:'flex',alignItems:'center',gap:6,marginTop:2,opacity:busy?0.5:1}}>
          <span style={{color:'oklch(0.65 0.18 145)',userSelect:'none',whiteSpace:'nowrap'}}>{prompt}</span>
          <input
            ref={inputRef}
            value={input}
            onChange={e=>setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy}
            style={{flex:1,background:'none',border:'none',outline:'none',
              color:'oklch(0.88 0.04 260)',fontFamily:'var(--font-mono)',fontSize:13,
              caretColor:'oklch(0.88 0.04 260)',cursor:busy?'wait':'text'}}
            spellCheck={false} autoCorrect="off" autoCapitalize="off"
          />
          {busy && <span style={{color:'oklch(0.65 0.18 145)',fontSize:11}}>⏳</span>}
        </div>
        <div ref={bottomRef}/>
      </div>
    </Modal>
  );
};



// ── ContainerEditDialog — edycja działającego kontenera ─────────────────────
const ContainerEditDialog = ({ c, onClose, onSaved }) => {
  const [inspect,  setInspect]  = React.useState(null);
  const [loading,  setLoading]  = React.useState(true);
  const [saving,   setSaving]   = React.useState(false);
  const [err,      setErr]      = React.useState('');
  const [tab,      setTab]      = React.useState('env');

  // Edytowalne pola
  const [envVars,  setEnvVars]  = React.useState([]);
  const [memory,   setMemory]   = React.useState('');
  const [cpus,     setCpus]     = React.useState('');
  const [restart,  setRestart]  = React.useState('');
  const [mounts,   setMounts]   = React.useState([]); // {src, dst, mode}
  const [networks, setNetworks] = React.useState([]); // nazwy sieci
  const [allNets,  setAllNets]  = React.useState([]); // dostępne sieci

  React.useEffect(() => {
    fetch(`/api/docker/inspect/${c.id}`, {credentials:'include'})
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        setInspect(d);
// env parsowany niżej

        setRestart(d.restart_policy || d.HostConfig?.RestartPolicy?.Name || 'no');
        // Pamięć i CPU
        const memBytes = d.memory_limit || d.HostConfig?.Memory || 0;
        setMemory(memBytes ? Math.round(memBytes/1024/1024)+'m' : '');
        const nc = d.nano_cpus || d.HostConfig?.NanoCpus || 0;
        setCpus(nc ? (nc/1e9).toFixed(2) : '');
        // Zmienne env — backend zwraca jako "env" (tablica stringów)
        const envArr = d.env || d.Config?.Env || [];
        const parsedEnv = envArr.map(e => {
          const idx = e.indexOf('=');
          return idx >= 0
            ? { key: e.slice(0, idx), val: e.slice(idx+1) }
            : { key: e, val: '' };
        });
        setEnvVars(parsedEnv);

        // Wolumeny — backend zwraca "binds" (string src:dst:mode) lub "mounts"
        const binds = d.binds || [];
        const mnts = binds.length > 0
          ? binds.map(b => {
              const parts = b.split(':');
              return { src: parts[0]||'', dst: parts[1]||'', mode: parts[2]||'rw' };
            })
          : (d.mounts || []).map(m => ({
              src: m.Source || m.source || '',
              dst: m.Destination || m.destination || '',
              mode: m.Mode || m.mode || 'rw',
            }));
        setMounts(mnts);

        // Sieci — backend zwraca "network_names"
        const nets = d.network_names || Object.keys(d.NetworkSettings?.Networks || {});
        setNetworks(nets);
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));

    // Pobierz dostępne sieci Docker
    fetch('/api/storage/exec-command', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({command: 'docker network ls --format "{{.Name}}"'}),
    }).then(r=>r.ok?r.json():null)
      .then(d=>{ if(d?.output) setAllNets(d.output.split('\n').filter(Boolean)); })
      .catch(()=>{});
  }, [c.id]);

  const save = async () => {
    setSaving(true); setErr('');
    try {
      // 1. docker update — limity zasobów i restart policy
      const updateArgs = [];
      if (memory)  updateArgs.push('--memory', memory);
      if (cpus)    updateArgs.push('--cpus', cpus);
      if (restart) updateArgs.push('--restart', restart);
      updateArgs.push(c.id);

      if (updateArgs.length > 1) {
        const r1 = await fetch('/api/storage/exec-command', {
          method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({command: 'docker update ' + updateArgs.join(' ')}),
        });
        const d1 = await r1.json();
        if (!d1.ok) throw new Error('docker update: ' + d1.output);
      }

      // 2. Sprawdź czy potrzebna rekreacja (ENV, mounts, sieci)
      const origEnv   = (inspect?.Config?.Env || []);
      const newEnv    = envVars.map(e => e.key+'='+e.val);
      const envChanged = JSON.stringify(origEnv.sort()) !== JSON.stringify(newEnv.sort());

      const origMounts = (inspect?.HostConfig?.Binds || []);
      const newMounts  = mounts.map(m => m.src+':'+m.dst+(m.mode?':'+m.mode:''));
      const mntChanged = JSON.stringify(origMounts.sort()) !== JSON.stringify(newMounts.sort());

      const origNets = Object.keys(inspect?.NetworkSettings?.Networks || {}).sort();
      const netsChanged = JSON.stringify(origNets) !== JSON.stringify([...networks].sort());

      if (envChanged || mntChanged || netsChanged) {
        const envStr  = envVars.map(e => `-e "${e.key}=${e.val.replace(/"/g,'\"')}"`).join(' ');
        const mntStr  = mounts.filter(m=>m.src&&m.dst).map(m => `-v "${m.src}:${m.dst}${m.mode?':'+m.mode:''}"`).join(' ');
        const img     = inspect?.Config?.Image || c.image;
        const name    = c.name.replace(/^\//, '');

        // Dodaj nowe sieci, usuń stare
        const addNets = networks.filter(n => !origNets.includes(n));
        const rmNets  = origNets.filter(n => !networks.includes(n) && n !== 'bridge');

        const cmds = [
          `docker stop ${c.id}`,
          `docker rename ${c.id} ${name}_bak_$(date +%s)`,
          `docker run -d --name ${name} ${envStr} ${mntStr} ${img}`,
          ...addNets.map(n => `docker network connect ${n} ${name}`),
          ...rmNets.map(n  => `docker network disconnect ${n} ${name} 2>/dev/null || true`),
        ].join(' && ');

        const r3 = await fetch('/api/storage/exec-command', {
          method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({command: cmds}),
        });
        const d3 = await r3.json();
        if (!d3.ok) throw new Error('Rekreacja kontenera: ' + d3.output);
      }

      onSaved();
    } catch(e) {
      setErr(e.message);
    } finally { setSaving(false); }
  };

  const inpSt = {background:'var(--bg-2)',border:'1px solid var(--line-strong)',
    borderRadius:5,padding:'5px 8px',color:'var(--fg)',fontFamily:'var(--font-mono)',
    fontSize:'var(--fs-xs)',outline:'none'};

  const TABS = [
    {id:'env',       label:'Zmienne ENV'},
    {id:'mounts',    label:'Wolumeny'},
    {id:'network',   label:'Sieć'},
    {id:'resources', label:'Zasoby'},
    {id:'restart',   label:'Restart policy'},
  ];

  return (
    <Modal title={`Edytuj kontener · ${c.name}`} sub={c.image} onClose={onClose} width={640}
      footer={<>
        <button className="btn" onClick={onClose}>Anuluj</button>
        <button className="btn primary" onClick={save} disabled={saving||loading}>
          {saving ? 'Zapisywanie…' : 'Zastosuj i restartuj'}
        </button>
      </>}
    >
      {loading && <div style={{padding:40,textAlign:'center',color:'var(--fg-dim)'}}>Ładowanie konfiguracji…</div>}
      {err && <div style={{padding:'8px 12px',background:'color-mix(in oklch,var(--err) 10%,transparent)',
        borderRadius:6,color:'var(--err)',fontSize:'var(--fs-sm)',marginBottom:12}}>{err}</div>}

      {!loading && (<>
        {/* Tabs */}
        <div style={{display:'flex',gap:4,borderBottom:'1px solid var(--line)',marginBottom:16}}>
          {TABS.map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{padding:'6px 14px',background:'none',border:'none',cursor:'pointer',
                color:tab===t.id?'var(--fg)':'var(--fg-dim)',
                borderBottom:tab===t.id?'2px solid var(--accent)':'2px solid transparent',
                fontSize:'var(--fs-sm)',marginBottom:-1}}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ENV */}
        {tab === 'env' && (
          <div>
            <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
              <button className="btn sm" onClick={()=>setEnvVars(e=>[...e,{key:'',val:''}])}>
                + Dodaj zmienną
              </button>
            </div>
            <div style={{maxHeight:360,overflowY:'auto',display:'flex',flexDirection:'column',gap:6}}>
              {envVars.map((e,i) => (
                <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 1fr auto',gap:6,alignItems:'center'}}>
                  <input style={{...inpSt,width:'100%'}} value={e.key} placeholder="KLUCZ"
                    onChange={ev=>setEnvVars(arr=>arr.map((x,j)=>j===i?{...x,key:ev.target.value}:x))}/>
                  <input style={{...inpSt,width:'100%'}} value={e.val} placeholder="wartość"
                    onChange={ev=>setEnvVars(arr=>arr.map((x,j)=>j===i?{...x,val:ev.target.value}:x))}/>
                  <button className="btn sm ghost" style={{color:'var(--err)'}}
                    onClick={()=>setEnvVars(arr=>arr.filter((_,j)=>j!==i))}>✕</button>
                </div>
              ))}
            </div>
            <div style={{marginTop:10,fontSize:'var(--fs-xs)',color:'var(--err)'}}>
              ⚠️ Zmiana ENV wymaga rekrecji kontenera (stop → rm → run z nowymi zmiennymi)
            </div>
          </div>
        )}

        {/* WOLUMENY */}
        {tab === 'mounts' && (
          <div>
            <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
              <button className="btn sm" onClick={()=>setMounts(m=>[...m,{src:'',dst:'',mode:'rw'}])}>
                + Dodaj wolumen
              </button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:6,maxHeight:360,overflowY:'auto'}}>
              {mounts.length === 0 && (
                <div style={{color:'var(--fg-dim)',fontSize:'var(--fs-sm)',padding:'20px 0',textAlign:'center'}}>
                  Brak punktów montowania
                </div>
              )}
              {mounts.map((m,i) => (
                <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 1fr 80px auto',gap:6,alignItems:'center'}}>
                  <input style={{...inpSt,width:'100%'}} value={m.src} placeholder="Źródło (host)"
                    onChange={e=>setMounts(arr=>arr.map((x,j)=>j===i?{...x,src:e.target.value}:x))}/>
                  <input style={{...inpSt,width:'100%'}} value={m.dst} placeholder="Cel (kontener)"
                    onChange={e=>setMounts(arr=>arr.map((x,j)=>j===i?{...x,dst:e.target.value}:x))}/>
                  <select style={{...inpSt}} value={m.mode}
                    onChange={e=>setMounts(arr=>arr.map((x,j)=>j===i?{...x,mode:e.target.value}:x))}>
                    <option value="rw">rw</option>
                    <option value="ro">ro</option>
                  </select>
                  <button className="btn sm ghost" style={{color:'var(--err)'}}
                    onClick={()=>setMounts(arr=>arr.filter((_,j)=>j!==i))}>✕</button>
                </div>
              ))}
            </div>
            <div style={{marginTop:10,fontSize:'var(--fs-xs)',color:'var(--err)'}}>
              ⚠️ Zmiana wolumenów wymaga rekreacji kontenera
            </div>
          </div>
        )}

        {/* SIEĆ */}
        {tab === 'network' && (
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <div style={{fontSize:'var(--fs-sm)',color:'var(--fg-muted)',marginBottom:4}}>
              Podłączone sieci Docker — zaznacz aktywne:
            </div>
            {allNets.map(net => (
              <div key={net} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',
                borderRadius:7,border:'1px solid',cursor:'pointer',
                borderColor:networks.includes(net)?'var(--accent)':'var(--line)',
                background:networks.includes(net)?'color-mix(in oklch,var(--accent) 8%,transparent)':'var(--bg-2)'}}
                onClick={()=>setNetworks(prev =>
                  prev.includes(net) ? prev.filter(n=>n!==net) : [...prev, net]
                )}>
                <div style={{width:14,height:14,borderRadius:3,border:'2px solid',flexShrink:0,
                  borderColor:networks.includes(net)?'var(--accent)':'var(--fg-dim)',
                  background:networks.includes(net)?'var(--accent)':'transparent',
                  display:'flex',alignItems:'center',justifyContent:'center'}}>
                  {networks.includes(net) && <span style={{color:'#fff',fontSize:10,lineHeight:1}}>✓</span>}
                </div>
                <span style={{fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)'}}>{net}</span>
              </div>
            ))}
            {allNets.length === 0 && (
              <div style={{color:'var(--fg-dim)',fontSize:'var(--fs-sm)',padding:'20px 0',textAlign:'center'}}>
                Brak dostępnych sieci
              </div>
            )}
            <div style={{marginTop:8,fontSize:'var(--fs-xs)',color:'var(--err)'}}>
              ⚠️ Zmiana sieci wymaga rekreacji kontenera
            </div>
          </div>
        )}

        {/* RESOURCES */}
        {tab === 'resources' && (
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:5}}>Limit pamięci RAM</div>
              <input style={{...inpSt,width:200}} value={memory}
                onChange={e=>setMemory(e.target.value)} placeholder="np. 512m, 2g (puste = bez limitu)"/>
            </div>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:5}}>Limit CPU</div>
              <input style={{...inpSt,width:200}} value={cpus}
                onChange={e=>setCpus(e.target.value)} placeholder="np. 0.5, 2.0 (puste = bez limitu)"/>
            </div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-muted)'}}>
              Limity zasobów stosowane natychmiast przez <code>docker update</code> bez restartu.
            </div>
          </div>
        )}

        {/* RESTART */}
        {tab === 'restart' && (
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {[
              {val:'no',             label:'no',             desc:'Nie restartuj automatycznie'},
              {val:'always',         label:'always',         desc:'Zawsze restartuj (też po docker restart)'},
              {val:'unless-stopped', label:'unless-stopped', desc:'Restartuj chyba że ręcznie zatrzymany'},
              {val:'on-failure',     label:'on-failure',     desc:'Restartuj tylko gdy exit code ≠ 0'},
            ].map(o => (
              <div key={o.val} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',
                borderRadius:7,border:'1px solid',cursor:'pointer',
                borderColor:restart===o.val?'var(--accent)':'var(--line)',
                background:restart===o.val?'color-mix(in oklch,var(--accent) 8%,transparent)':'var(--bg-2)'}}
                onClick={()=>setRestart(o.val)}>
                <div style={{width:14,height:14,borderRadius:'50%',border:'2px solid',flexShrink:0,
                  borderColor:restart===o.val?'var(--accent)':'var(--fg-dim)',
                  background:restart===o.val?'var(--accent)':'transparent'}}/>
                <div>
                  <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)'}}>{o.label}</div>
                  <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>{o.desc}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </>)}
    </Modal>
  );
};

const InspectDialog = ({ c, onClose }) => {
  const Modal = window.Modal;
  const [data, setData]     = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError]   = React.useState('');
  const [tab, setTab]       = React.useState('general');

  React.useEffect(() => {
    fetch(`/api/docker/inspect/${c.id}`, {credentials:'include'})
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setData(d); setLoading(false); })
      .catch(e => {
        // Fallback z danych lokalnych gdy Docker API niedostępny
        setData({
          id:      c.id,
          name:    c.name,
          image:   c.image,
          state:   c.state,
          ports:   typeof c.ports === 'string' ? [c.ports] : (c.ports || []),
          env:     [],
          mounts:  [],
          labels:  {},
          network: {},
          _error:  e.message,
        });
        setLoading(false);
      });
  }, [c.id]);

  const rows = data ? [
    { k:'ID',            v: (data.id||'').slice(0,12) },
    { k:'Nazwa',         v: data.name },
    { k:'Obraz',         v: data.image },
    { k:'Stan',          v: data.state || data.status },
    { k:'PID',           v: data.pid ? String(data.pid) : '—' },
    { k:'Restart',       v: data.restart_policy || '—' },
    { k:'Porty',         v: (data.ports||[]).join(', ') || data.ports_str || '—' },
    { k:'IP',            v: data.network?.ip || '—' },
    { k:'Gateway',       v: data.network?.gateway || '—' },
    { k:'MAC',           v: data.network?.mac || '—' },
    { k:'Utworzono',     v: data.created ? new Date(data.created).toLocaleString('pl') : '—' },
    { k:'Limit RAM',     v: data.memory_limit > 0 ? Math.round(data.memory_limit/1024/1024)+' MB' : 'brak limitu' },
  ] : [];

  return (
    <Modal title={`Inspekcja · ${c.name}`} sub={`docker inspect ${c.id}`} onClose={onClose} width={680}
      footer={<div className="row gap-sm" style={{marginLeft:'auto'}}>
        <button className="btn sm primary" onClick={onClose}>Zamknij</button>
      </div>}
    >
      {loading ? (
        <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>
          <span className="dot pulse" style={{display:'inline-block',marginRight:8}}/>Ładowanie…
        </div>
      ) : (
        <div className="col" style={{gap:14}}>
          <div className="segmented">
            <button className={tab==='general'?'active':''} onClick={()=>setTab('general')}>Ogólne</button>
            <button className={tab==='env'?'active':''} onClick={()=>setTab('env')}>ENV ({(data?.env||[]).length})</button>
            <button className={tab==='mounts'?'active':''} onClick={()=>setTab('mounts')}>Woluminy ({(data?.mounts||[]).length})</button>
            <button className={tab==='labels'?'active':''} onClick={()=>setTab('labels')}>Labels</button>
            <button className={tab==='raw'?'active':''} onClick={()=>setTab('raw')}>JSON</button>
          </div>

          {tab==='general' && (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:1,background:'var(--line)',borderRadius:7,overflow:'hidden',border:'1px solid var(--line)'}}>
              {rows.map(({k,v}) => (
                <div key={k} style={{display:'flex',gap:12,padding:'8px 12px',background:'var(--bg-1)',alignItems:'baseline'}}>
                  <span style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',minWidth:70,flexShrink:0,textTransform:'uppercase',letterSpacing:'.05em'}}>{k}</span>
                  <span className="mono" style={{fontSize:'var(--fs-xs)',wordBreak:'break-all'}}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {tab==='env' && (
            <div style={{background:'oklch(0.12 0.01 260)',borderRadius:8,padding:'12px 14px',fontFamily:'var(--font-mono)',fontSize:12,lineHeight:1.8,maxHeight:320,overflowY:'auto'}}>
              {(data?.env || []).length === 0
                ? <span style={{color:'var(--fg-dim)'}}>Brak zmiennych środowiskowych.</span>
                : (data?.env || []).map((e,i) => {
                    const [k,...rest] = e.split('=');
                    return (
                      <div key={i}>
                        <span style={{color:'oklch(0.65 0.18 145)'}}>{k}</span>
                        <span style={{color:'var(--fg-dim)'}}>{'='}</span>
                        <span style={{color:'oklch(0.78 0.08 60)'}}>{rest.join('=')}</span>
                      </div>
                    );
                  })
              }
            </div>
          )}

          {tab==='mounts' && (
            (data?.mounts || []).length === 0
              ? <div style={{padding:20,textAlign:'center',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>Brak zamontowanych woluminów.</div>
              : <table className="table">
                  <thead><tr><th>Typ</th><th>Źródło</th><th>Cel</th><th>Tryb</th></tr></thead>
                  <tbody>
                    {(data?.mounts||[]).map((m,i)=>(
                      <tr key={i}>
                        <td><span className="chip">{m.type||'bind'}</span></td>
                        <td className="mono" style={{fontSize:'var(--fs-xs)'}}>{m.source||'—'}</td>
                        <td className="mono" style={{fontSize:'var(--fs-xs)'}}>{m.destination||'—'}</td>
                        <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{m.mode||'rw'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
          )}

          {tab==='labels' && (
            Object.keys(data?.labels||{}).length === 0
              ? <div style={{padding:20,textAlign:'center',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>Brak etykiet.</div>
              : <table className="table">
                  <thead><tr><th>Etykieta</th><th>Wartość</th></tr></thead>
                  <tbody>
                    {Object.entries(data?.labels||{}).map(([k,v])=>(
                      <tr key={k}>
                        <td className="mono" style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>{k}</td>
                        <td className="mono" style={{fontSize:'var(--fs-xs)'}}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
          )}

          {tab==='raw' && (
            <pre style={{background:'oklch(0.12 0.01 260)',borderRadius:8,padding:'12px 14px',
              fontFamily:'var(--font-mono)',fontSize:11,lineHeight:1.6,color:'oklch(0.78 0.06 260)',
              maxHeight:360,overflowY:'auto',whiteSpace:'pre-wrap',wordBreak:'break-all',margin:0}}>
              {JSON.stringify(data?.raw || data, null, 2)}
            </pre>
          )}
        </div>
      )}
    </Modal>
  );
};

const MoreMenu = ({ c, onAction, onClose }) => {
  const options = [
    { label:'Uruchom',    icon:'play',    action:'start',   disabled: c.state==='running' },
    { label:'Zatrzymaj',  icon:'stop',    action:'stop',    disabled: c.state==='stopped' },
    { label:'Restartuj',  icon:'restart', action:'restart', disabled: false },
    { label:'Pauza',      icon:'pause',   action:'pause',   disabled: c.state!=='running' },
    null,
    { label:'Edytuj',     icon:'edit',    action:'edit',    disabled: false },
    { label:'Logi',       icon:'log',     action:'logs',    disabled: false },
    { label:'Terminal',   icon:'terminal',action:'shell',   disabled: c.state!=='running' },
    { label:'Inspekcja',  icon:'search',  action:'inspect', disabled: false },
    null,
    { label:'Usuń',       icon:'trash',   action:'remove',  disabled: c.state==='running', danger:true },
  ];
  React.useEffect(() => {
    const close = () => onClose();
    setTimeout(() => window.addEventListener('click', close), 0);
    return () => window.removeEventListener('click', close);
  }, []);
  return (
    <div style={{position:'absolute',right:0,top:'100%',zIndex:500,background:'var(--bg-1)',
      border:'1px solid var(--line-strong)',borderRadius:8,padding:4,minWidth:160,
      boxShadow:'0 8px 24px rgba(0,0,0,0.4)'}}>
      {options.map((o,i) => o===null
        ? <div key={i} style={{height:1,background:'var(--line)',margin:'4px 0'}}/>
        : <button key={i} disabled={o.disabled}
            onClick={e=>{e.stopPropagation();onAction(c.id,o.action);onClose();}}
            style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'7px 10px',
              background:'none',border:'none',borderRadius:5,cursor:o.disabled?'default':'pointer',
              color: o.danger?'var(--err)':o.disabled?'var(--fg-dim)':'var(--fg)',
              fontSize:'var(--fs-sm)',textAlign:'left',opacity:o.disabled?0.4:1}}
            onMouseEnter={e=>{if(!o.disabled)e.currentTarget.style.background='var(--bg-2)'}}
            onMouseLeave={e=>{e.currentTarget.style.background='none'}}>
            <Icon name={o.icon} size={13}/>{o.label}
          </button>
      )}
    </div>
  );
};

const NewContainerDialog = ({ onClose, onAdd }) => {
  const [form, setForm] = React.useState({
    name:'', image:'nginx:alpine', ports:'8080:80', volumes:'', env:'TZ=Europe/Warsaw', restart:'unless-stopped', network:'bridge'
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const inpSt = {background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:5,
    padding:'6px 10px',color:'var(--fg)',fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',outline:'none',width:'100%'};
  const submit = () => {
    fetch('/services/docker/container/create', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(form),
    }).then(r => r.ok ? r.json() : null).then(() => { onAdd(form); onClose(); }).catch(()=>{onAdd(form);onClose();});
  };
  return (
    <Modal title="Nowy kontener" sub="docker run …" onClose={onClose} width={680}
      footer={<div className="row gap-sm" style={{marginLeft:'auto'}}>
        <button className="btn sm" onClick={onClose}>Anuluj</button>
        <button className="btn sm primary" onClick={submit}>
          <Icon name="play" size={11}/> Uruchom kontener
        </button>
      </div>}
    >
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Obraz</div>
          <input style={inpSt} value={form.image} onChange={e=>set('image',e.target.value)} placeholder="nginx:alpine"/>
        </div>
        <div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Nazwa kontenera</div>
          <input style={inpSt} value={form.name} onChange={e=>set('name',e.target.value)} placeholder="myapp"/>
        </div>
        <div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Porty (host:kontener)</div>
          <input style={inpSt} value={form.ports} onChange={e=>set('ports',e.target.value)} placeholder="8080:80"/>
        </div>
        <div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Restart</div>
          <select style={inpSt} value={form.restart} onChange={e=>set('restart',e.target.value)}>
            <option value="no">no</option>
            <option value="always">always</option>
            <option value="unless-stopped">unless-stopped</option>
            <option value="on-failure">on-failure</option>
          </select>
        </div>
        <div style={{gridColumn:'1/-1'}}>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Wolumeny (host:kontener)</div>
          <input style={inpSt} value={form.volumes} onChange={e=>set('volumes',e.target.value)} placeholder="/mnt/data:/data"/>
        </div>
        <div style={{gridColumn:'1/-1'}}>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Zmienne środowiskowe (jedna na linię)</div>
          <textarea style={{...inpSt,height:70,resize:'vertical',lineHeight:1.6}} value={form.env} onChange={e=>set('env',e.target.value)}/>
        </div>
        <div style={{gridColumn:'1/-1',background:'var(--bg-2)',borderRadius:6,padding:'8px 12px',fontFamily:'var(--font-mono)',fontSize:10,color:'var(--fg-dim)',lineHeight:1.7}}>
          <div>docker run \</div>
          {form.name && <div>&nbsp;&nbsp;--name {form.name} \</div>}
          {form.ports && <div>&nbsp;&nbsp;-p {form.ports} \</div>}
          {form.volumes && <div>&nbsp;&nbsp;-v {form.volumes} \</div>}
          <div>&nbsp;&nbsp;--restart {form.restart} \</div>
          <div>&nbsp;&nbsp;<span style={{color:'var(--accent)'}}>{form.image||'nginx:alpine'}</span></div>
        </div>
      </div>
    </Modal>
  );
};

// ── Compose templates ────────────────────────────────────────────────────────
const COMPOSE_TEMPLATES = [
  { id:'blank', label:'Pusty',         icon:'plus',     desc:'Zacznij od zera',
    yaml:`services:\n  app:\n    image: nginx:alpine\n    container_name: app\n    restart: unless-stopped\n    ports:\n      - "8080:80"\n    environment:\n      - TZ=Europe/Warsaw\n` },

  { id:'nginx', label:'Nginx',         icon:'globe',    desc:'Reverse proxy / serwer www',
    yaml:`services:\n  nginx:\n    image: nginx:alpine\n    container_name: nginx\n    restart: unless-stopped\n    ports:\n      - "80:80"\n      - "443:443"\n    volumes:\n      - ./config/nginx.conf:/etc/nginx/nginx.conf:ro\n      - ./html:/usr/share/nginx/html:ro\n    environment:\n      - TZ=Europe/Warsaw\n` },

  { id:'nextcloud', label:'Nextcloud',  icon:'share',    desc:'Własna chmura plików',
    yaml:`services:\n  nextcloud:\n    image: nextcloud:latest\n    container_name: nextcloud\n    restart: unless-stopped\n    ports:\n      - "8080:80"\n    volumes:\n      - nextcloud_data:/var/www/html\n    environment:\n      - NEXTCLOUD_ADMIN_USER=admin\n      - NEXTCLOUD_ADMIN_PASSWORD=changeme\n      - TZ=Europe/Warsaw\n  db:\n    image: mariadb:latest\n    container_name: nextcloud-db\n    restart: unless-stopped\n    volumes:\n      - db_data:/var/lib/mysql\n    environment:\n      - MYSQL_ROOT_PASSWORD=rootpass\n      - MYSQL_DATABASE=nextcloud\n      - MYSQL_USER=nextcloud\n      - MYSQL_PASSWORD=ncpass\n\nvolumes:\n  nextcloud_data:\n  db_data:\n` },

  { id:'jellyfin', label:'Jellyfin',    icon:'media',    desc:'Serwer multimediów',
    yaml:`services:\n  jellyfin:\n    image: jellyfin/jellyfin:latest\n    container_name: jellyfin\n    restart: unless-stopped\n    ports:\n      - "8096:8096"\n    volumes:\n      - ./config:/config\n      - /mnt/media:/media:ro\n    environment:\n      - TZ=Europe/Warsaw\n      - JELLYFIN_PublishedServerUrl=http://localhost:8096\n` },

  { id:'portainer', label:'Portainer',  icon:'settings', desc:'Zarządzanie Dockerem przez UI',
    yaml:`services:\n  portainer:\n    image: portainer/portainer-ce:latest\n    container_name: portainer\n    restart: unless-stopped\n    ports:\n      - "9000:9000"\n      - "9443:9443"\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n      - portainer_data:/data\n\nvolumes:\n  portainer_data:\n` },

  { id:'grafana', label:'Grafana',      icon:'dashboard', desc:'Wykresy i monitoring',
    yaml:`services:\n  grafana:\n    image: grafana/grafana:latest\n    container_name: grafana\n    restart: unless-stopped\n    ports:\n      - "3000:3000"\n    volumes:\n      - grafana_data:/var/lib/grafana\n    environment:\n      - GF_SECURITY_ADMIN_PASSWORD=admin\n      - TZ=Europe/Warsaw\n  prometheus:\n    image: prom/prometheus:latest\n    container_name: prometheus\n    restart: unless-stopped\n    ports:\n      - "9090:9090"\n    volumes:\n      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro\n      - prometheus_data:/prometheus\n\nvolumes:\n  grafana_data:\n  prometheus_data:\n` },

  { id:'vaultwarden', label:'Vaultwarden', icon:'key',   desc:'Własny menedżer haseł',
    yaml:`services:\n  vaultwarden:\n    image: vaultwarden/server:latest\n    container_name: vaultwarden\n    restart: unless-stopped\n    ports:\n      - "8082:80"\n    volumes:\n      - vw_data:/data\n    environment:\n      - WEBSOCKET_ENABLED=true\n      - TZ=Europe/Warsaw\n\nvolumes:\n  vw_data:\n` },

  { id:'uptime-kuma', label:'Uptime Kuma', icon:'ok',   desc:'Monitoring dostępności',
    yaml:`services:\n  uptime-kuma:\n    image: louislam/uptime-kuma:latest\n    container_name: uptime-kuma\n    restart: unless-stopped\n    ports:\n      - "3001:3001"\n    volumes:\n      - uptime_data:/app/data\n      - /var/run/docker.sock:/var/run/docker.sock\n\nvolumes:\n  uptime_data:\n` },
];

const ComposeDialog = ({ stack, onClose, onDeploy }) => {
  const Modal = window.Modal;
  const [phase, setPhase]     = React.useState(stack ? 'edit' : 'pick');  // 'pick' | 'edit'
  const [yaml, setYaml]       = React.useState(stack?.yaml || stack?.content || '');
  const [name, setName]       = React.useState(stack?.name || '');
  const [busy, setBusy]       = React.useState(false);
  const [log,  setLog]        = React.useState('');

  const inpSt = {background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:5,
    padding:'6px 10px',color:'var(--fg)',fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',outline:'none',width:'100%'};

  const pickTemplate = (tpl) => {
    setYaml(tpl.yaml.replace(/\\n/g,'\n'));
    if (!name) setName(tpl.id === 'blank' ? '' : tpl.id);
    setPhase('edit');
  };

  const deploy = async (andUp) => {
    if (!name.trim()) { alert('Podaj nazwę stosu.'); return; }
    setBusy(true); setLog('');
    try {
      const r = await fetch('/api/docker/compose/create', {
        method: 'POST', credentials: 'include',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name: name.trim(), content: yaml, deploy: andUp }),
      });
      let d;
      try { d = await r.json(); } catch(pe) { setLog('[BŁĄD] Serwer zwrócił nieprawidłowy JSON: ' + await r.text()); setBusy(false); return; }
      if (!r.ok) { setLog('[BŁĄD] ' + (d?.error || JSON.stringify(d))); setBusy(false); return; }
      // Sukces
      setLog((andUp ? '[OK] Zapisano i uruchomiono → ' : '[OK] Zapisano → ') + (d.file || '/opt/stacks/' + name.trim() + '/docker-compose.yml'));
      onDeploy({ name: d.name || name.trim(), file: d.file, status: andUp ? 'running' : 'stopped' });
      setTimeout(onClose, 1500);
    } catch(e) { setLog('[BŁĄD] ' + e.message); }
    setBusy(false);
  };

  // ── Faza 1: wybór szablonu ────────────────────────────────────────────────
  if (phase === 'pick') return (
    <Modal title="Nowy stos Compose" sub="Wybierz szablon lub zacznij od zera" onClose={onClose} width={680}
      footer={<div className="row gap-sm" style={{marginLeft:'auto'}}>
        <button className="btn sm" onClick={onClose}>Anuluj</button>
      </div>}
    >
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
        {COMPOSE_TEMPLATES.map(tpl => (
          <div key={tpl.id} onClick={()=>pickTemplate(tpl)}
            style={{padding:'14px 10px',borderRadius:8,border:'1px solid var(--line-strong)',
              background:'var(--bg-2)',cursor:'pointer',textAlign:'center',transition:'all .12s'}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.background='oklch(0.55 0.2 260 / 0.08)';}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--line-strong)';e.currentTarget.style.background='var(--bg-2)';}}>
            <Icon name={tpl.icon} size={22} style={{color:'var(--accent)',display:'block',margin:'0 auto 8px'}}/>
            <div style={{fontWeight:600,fontSize:'var(--fs-sm)',marginBottom:3}}>{tpl.label}</div>
            <div style={{fontSize:10,color:'var(--fg-dim)',lineHeight:1.4}}>{tpl.desc}</div>
          </div>
        ))}
      </div>
    </Modal>
  );

  // ── Faza 2: edytor YAML ───────────────────────────────────────────────────
  return (
    <Modal title={stack ? `Compose · ${stack.name}` : `Nowy stos · ${name || '…'}`}
      sub={stack?.file || '/opt/stacks/<nazwa>/docker-compose.yml'}
      onClose={onClose} width={820}
      footer={<div className="row gap-sm" style={{width:'100%',alignItems:'center'}}>
        {!stack && <button className="btn sm" onClick={()=>setPhase('pick')}><Icon name="close" size={11}/> Szablony</button>}
        <div style={{flex:1}}/>
        <button className="btn sm" onClick={onClose}>Anuluj</button>
        <button className="btn sm" onClick={()=>deploy(false)} disabled={busy}>
          <Icon name="download" size={11}/> Zapisz
        </button>
        <button className="btn sm primary" onClick={()=>deploy(true)} disabled={busy}>
          {busy ? <><span className="dot pulse" style={{marginRight:6}}/>Deploying…</> : <><Icon name="play" size={11}/> Deploy</>}
        </button>
      </div>}
    >
      <div style={{display:'flex',gap:12,marginBottom:12,alignItems:'flex-end'}}>
        <div style={{flex:'0 0 260px'}}>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Nazwa stosu</div>
          <input style={inpSt} value={name} onChange={e=>setName(e.target.value)} placeholder="np. media-stack, nextcloud"/>
        </div>
        <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>
          → /opt/stacks/{name||'<nazwa>'}/docker-compose.yml
        </div>
      </div>
      <textarea value={yaml} onChange={e=>setYaml(e.target.value)} spellCheck={false}
        style={{...inpSt,height:360,resize:'vertical',lineHeight:1.65,fontSize:12,tabSize:2}}/>
      {log && (
        <div style={{marginTop:10,padding:'8px 12px',background:'var(--bg)',borderRadius:5,
          fontFamily:'var(--font-mono)',fontSize:11,color:log.includes('BŁĄD')?'var(--err)':'var(--ok)',
          maxHeight:100,overflowY:'auto',whiteSpace:'pre-wrap'}}>
          {log}
        </div>
      )}
    </Modal>
  );
};

// ── ContCard ─────────────────────────────────────────────────────────────────
// ── DockerLoadingSplash — z nowego szablonu ─────────────────────────────────
const DOCKER_LOAD_STEPS = [
  { text: 'Łączenie z Docker daemon…',        pct: 8  },
  { text: 'Pobieranie listy kontenerów…',      pct: 22 },
  { text: 'Odczyt metadanych obrazów…',        pct: 38 },
  { text: 'Skanowanie wolumenów…',             pct: 52 },
  { text: 'Sprawdzanie sieci Docker…',         pct: 65 },
  { text: 'Wczytywanie statystyk CPU/RAM…',    pct: 78 },
  { text: 'Ładowanie stosów Compose…',         pct: 90 },
  { text: 'Gotowe.',                           pct: 100 },
];

const DockerLoadingSplash = ({ onDone }) => {
  const [step, setStep] = React.useState(0);
  const [pct, setPct]   = React.useState(0);
  const [finished, setFinished] = React.useState(false);

  React.useEffect(() => {
    let s = 0;
    const advance = () => {
      if (s >= DOCKER_LOAD_STEPS.length) {
        setFinished(true);
        setTimeout(onDone, 600);
        return;
      }
      setStep(s);
      setPct(DOCKER_LOAD_STEPS[s].pct);
      s++;
      const delay = s === DOCKER_LOAD_STEPS.length ? 400 : 260 + Math.random() * 160;
      setTimeout(advance, delay);
    };
    const tid = setTimeout(advance, 180);
    return () => clearTimeout(tid);
  }, []);

  const current = DOCKER_LOAD_STEPS[Math.min(step, DOCKER_LOAD_STEPS.length - 1)];

  return (
    <div style={{
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      minHeight:420, gap:0,
    }}>
      {/* Docker whale SVG */}
      <div style={{
        width:80, height:80, borderRadius:20, marginBottom:28,
        background:'oklch(0.18 0.04 245)',
        border:'1px solid oklch(0.55 0.2 245 / 0.35)',
        display:'flex', alignItems:'center', justifyContent:'center',
        boxShadow:'0 0 40px oklch(0.55 0.2 245 / 0.15)',
        position:'relative',
      }}>
        <svg width="46" height="38" viewBox="0 0 46 38" fill="none">
          <rect x="4"  y="18" width="30" height="14" rx="5" fill="oklch(0.72 0.18 245)"/>
          <rect x="8"  y="10" width="7"  height="10" rx="2" fill="oklch(0.72 0.18 245)"/>
          <rect x="17" y="6"  width="7"  height="14" rx="2" fill="oklch(0.72 0.18 245)"/>
          <rect x="26" y="10" width="7"  height="10" rx="2" fill="oklch(0.72 0.18 245)"/>
          <rect x="8"  y="14" width="25" height="2"  rx="1" fill="oklch(0.55 0.18 245)"/>
          <path d="M34 25 Q42 22 40 32 Q36 36 34 32Z" fill="oklch(0.72 0.18 245)"/>
          <circle cx="10" cy="23" r="1.5" fill="white" opacity="0.8"/>
        </svg>
        {!finished && (
          <div style={{
            position:'absolute', inset:-6, borderRadius:26,
            border:'1px solid oklch(0.55 0.2 245 / 0.4)',
            animation:'docker-pulse 1.6s ease-out infinite',
          }}/>
        )}
      </div>

      <div style={{fontSize:18, fontWeight:600, color:'var(--fg)', marginBottom:6}}>
        {finished ? 'Docker gotowy' : 'Ładowanie Docker…'}
      </div>
      <div style={{
        fontSize:'var(--fs-sm)', color:'var(--fg-dim)', marginBottom:28,
        fontFamily:'var(--font-mono)', minHeight:20, transition:'opacity 0.2s',
      }}>
        {current.text}
      </div>

      {/* Progress bar */}
      <div style={{width:320, height:5, background:'var(--bg-2)', borderRadius:3, overflow:'hidden', marginBottom:10}}>
        <div style={{
          height:'100%', borderRadius:3,
          width: pct + '%',
          background: finished ? 'var(--ok)' : 'linear-gradient(90deg, oklch(0.55 0.2 245), oklch(0.72 0.18 245))',
          transition:'width 0.28s cubic-bezier(0.4,0,0.2,1), background 0.4s',
          boxShadow: finished ? 'none' : '0 0 10px oklch(0.65 0.2 245 / 0.6)',
        }}/>
      </div>

      {/* Step dots */}
      <div style={{display:'flex', gap:6, marginBottom:28}}>
        {DOCKER_LOAD_STEPS.map((_, i) => (
          <div key={i} style={{
            width:  i <= step ? 18 : 6,
            height: 6, borderRadius:3,
            background: i < step ? 'var(--ok)' : i === step ? 'oklch(0.72 0.18 245)' : 'var(--bg-2)',
            transition:'width 0.25s, background 0.25s',
          }}/>
        ))}
      </div>

      <div style={{fontSize:'var(--fs-xs)', color:'var(--fg-muted)', fontFamily:'var(--font-mono)'}}>
        {pct}% — kontenerów: {window.storeGet ? (window.storeGet('CONTAINERS')||[]).length : 0}
      </div>

      <style>{`
        @keyframes docker-pulse {
          0%   { opacity:0.8; transform:scale(1); }
          100% { opacity:0;   transform:scale(1.5); }
        }
      `}</style>
    </div>
  );
};

// ── ContSkeleton — skeleton karty podczas ładowania ─────────────────────────
const ContSkeleton = () => (
  <div className="cont-card" style={{opacity:0.5}}>
    <div className="row" style={{justifyContent:'space-between'}}>
      <div className="row gap-md">
        <div className="cont-icon" style={{background:'var(--bg-3)',color:'transparent'}}>?</div>
        <div>
          <div style={{width:100,height:12,background:'var(--bg-3)',borderRadius:4,marginBottom:6}}/>
          <div style={{width:140,height:10,background:'var(--bg-3)',borderRadius:4}}/>
        </div>
      </div>
      <div style={{width:60,height:20,background:'var(--bg-3)',borderRadius:4}}/>
    </div>
    <div className="grid" style={{gridTemplateColumns:'1fr 1fr',gap:8,marginTop:12}}>
      {[0,1].map(i=>(
        <div key={i}>
          <div style={{width:30,height:9,background:'var(--bg-3)',borderRadius:3,marginBottom:6}}/>
          <div style={{width:50,height:13,background:'var(--bg-3)',borderRadius:3,marginBottom:6}}/>
          <div className="bar"><i style={{width:'0%'}}/></div>
        </div>
      ))}
    </div>
    <div className="row" style={{justifyContent:'space-between',marginTop:10}}>
      <div style={{width:80,height:10,background:'var(--bg-3)',borderRadius:3}}/>
      <div style={{width:50,height:10,background:'var(--bg-3)',borderRadius:3}}/>
    </div>
    <div className="row gap-sm" style={{borderTop:'1px solid var(--line)',paddingTop:10,marginTop:10}}>
      {[80,70,55].map((w,i)=>(
        <div key={i} style={{width:w,height:26,background:'var(--bg-3)',borderRadius:5}}/>
      ))}
    </div>
  </div>
);

const ContCard = ({c, onAction, moreFor, setMoreFor}) => (
  <div className="cont-card">
    <div className="row" style={{justifyContent:'space-between'}}>
      <div className="row gap-md">
        <div className="cont-icon">{(c.name||'?')[0].toUpperCase()}</div>
        <div>
          <div style={{fontWeight:600,fontSize:14}}>{c.name}</div>
          <div className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{(c.image||'').split('/').pop()}</div>
        </div>
      </div>
      <StateBadge s={c.state}/>
    </div>
    <div className="grid" style={{gridTemplateColumns:'1fr 1fr',gap:8,fontSize:'var(--fs-xs)'}}>
      <div>
        <div className="dim" style={{fontSize:10,letterSpacing:'.06em',textTransform:'uppercase'}}>CPU</div>
        <div className="mono" style={{fontSize:13,marginTop:2}}>{c.cpu}%</div>
        <div className="bar" style={{marginTop:4}}><i style={{width:Math.min(100,(c.cpu||0)*4)+'%'}}/></div>
      </div>
      <div>
        <div className="dim" style={{fontSize:10,letterSpacing:'.06em',textTransform:'uppercase'}}>RAM</div>
        <div className="mono" style={{fontSize:13,marginTop:2}}>{c.mem} MB</div>
        <div className="bar" style={{marginTop:4}}><i style={{width:Math.min(100,(c.mem||0)/20)+'%'}}/></div>
      </div>
    </div>
    <div className="row" style={{justifyContent:'space-between',fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>
      <span className="mono">{c.ports||'—'}</span>
      <span className="mono">↑ {c.uptime||'—'}</span>
    </div>
    <div className="row gap-sm" style={{borderTop:'1px solid var(--line)',paddingTop:10}}>
      {c.state!=='running'
        ? <button className="btn sm" onClick={()=>onAction(c.id,'start')}><Icon name="play" size={11}/> Start</button>
        : <button className="btn sm" onClick={()=>onAction(c.id,'stop')}><Icon name="stop" size={11}/> Stop</button>}
      <button className="btn sm" onClick={()=>onAction(c.id,'restart')}><Icon name="restart" size={11}/> Restart</button>
      <button className="btn sm ghost" style={{marginLeft:'auto'}} onClick={()=>onAction(c.id,'logs')}>
        <Icon name="log" size={11}/> Logs
      </button>
      {c.state==='running' && <button className="btn sm ghost icon-only" onClick={()=>onAction(c.id,'shell')} title="Terminal"><Icon name="terminal" size={13}/></button>}
      <button className="btn sm ghost icon-only" onClick={()=>onAction(c.id,'inspect')} title="Inspekcja"><Icon name="search" size={13}/></button>
      <div style={{position:'relative'}}>
        <button className="btn sm ghost icon-only" onClick={e=>{e.stopPropagation();setMoreFor(moreFor===c.id?null:c.id);}}>
          <Icon name="more" size={14}/>
        </button>
        {moreFor===c.id && <MoreMenu c={c} onAction={onAction} onClose={()=>setMoreFor(null)}/>}
      </div>
    </div>
  </div>
);

// ── Docker: tab Kontenery ─────────────────────────────────────────────────────
const DockerContainers = ({ containers, setContainers, loading }) => {
  const [filter, setFilter] = React.useState('all');
  const [view,   setView]   = React.useState('grid');
  const [logsFor, setLogsFor]   = React.useState(null);
  const [termFor, setTermFor]   = React.useState(null);
  const [inspectFor, setInspectFor] = React.useState(null);
  const [editFor,    setEditFor]    = React.useState(null);
  const [moreFor, setMoreFor]   = React.useState(null);
  const [showNew, setShowNew]   = React.useState(false);

  // Wywołaj prawdziwe API dla akcji kontenera
  const doContainerAction = async (id, action) => {
    if (action === 'logs')   { setLogsFor(containers.find(c=>c.id===id)); return; }
    if (action === 'shell')   { setTermFor(containers.find(c=>c.id===id)); return; }
    if (action === 'inspect') { setInspectFor(containers.find(c=>c.id===id)); return; }
    if (action === 'edit')    { setEditFor(containers.find(c=>c.id===id)); return; }
    if (action === 'remove') {
      if (!confirm(`Usunąć kontener ${id}?`)) return;
      await fetch(`/services/docker/container/${encodeURIComponent(id)}/remove`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});
      setContainers(cs=>cs.filter(c=>c.id!==id));
      return;
    }
    // start / stop / restart / pause
    const apiAction = action === 'pause' ? 'pause' : action;
    await fetch(`/services/docker/container/${encodeURIComponent(id)}/${apiAction}`,{
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'}, body:'{}',
    }).catch(()=>{});
    // Optymistyczna aktualizacja
    setContainers(cs => cs.map(c => {
      if (c.id !== id) return c;
      if (action==='start')   return {...c, state:'running',    uptime:'0m'};
      if (action==='stop')    return {...c, state:'stopped',    uptime:'—', cpu:0, mem:0};
      if (action==='restart') return {...c, state:'restarting', uptime:'0m'};
      if (action==='pause')   return {...c, state:'paused'};
      return c;
    }));
    // Po restart → running
    if (action==='restart') {
      setTimeout(()=>setContainers(cs=>cs.map(c=>c.id===id?{...c,state:'running',uptime:'0m'}:c)),2000);
    }
    // Odśwież dane po 3s
	setTimeout(async () => {
	  const r = await fetch('/services/docker/containers',{credentials:'include'}).catch(()=>null);
	  if (!r||!r.ok) return;
	  const data = await r.json().catch(()=>null);
	  if (!data) return;
	  const list = data.containers||data||[];
	  const cs = list.map((c,i) => {
		const nm  = (c.name||c.Names||c.ID||'c'+i).replace(/^\//,'');
		const st  = (c.state||c.State||'unknown').toLowerCase();
		
		// CPU - może być liczbą lub stringiem
		let cpu = 0;
		if (typeof c.cpu === 'number') {
		  cpu = c.cpu;
		} else if (typeof c.cpu === 'string') {
		  cpu = parseFloat(c.cpu.replace('%','')) || 0;
		}
		
		// MEM - może być liczbą (MB) lub stringiem "258.5MiB"
		let mem = 0;
		if (typeof c.mem === 'number') {
		  // API zwraca liczbę w MB
		  mem = Math.round(c.mem);
		} else if (typeof c.mem === 'string') {
		  // Stary format: "258.5MiB / 64GiB"
		  const memM = c.mem.match(/([\d.]+)\s*([KMGTi]+B)?/i);
		  if (memM) { 
		    const v = parseFloat(memM[1]); 
		    const u = (memM[2]||'').toUpperCase(); 
		    mem = u.startsWith('G') ? Math.round(v*1024) : u.startsWith('K') ? Math.round(v/1024) : Math.round(v); 
		  }
		}
		
		return { 
		  id: c.id||c.ID||'c'+i, 
		  name: nm, 
		  image: c.image||c.Image||'—',
		  state: st, 
		  uptime: c.uptime||c.status||c.Status||'—', 
		  cpu: Math.round(cpu * 100) / 100,
		  mem, 
		  ports: typeof(c.ports||c.Ports)==='string' ? (c.ports||c.Ports) : '—', 
		  tag:'other' 
		};
	  });
	  if (cs.length) { setContainers(cs); storeSet('CONTAINERS',cs); }
	}, 5000);
  };

  const addContainer = (form) => {
    // lokalny wpis — serwer już go uruchamia
    const id = form.name || ('cnt-'+Date.now());
    setContainers(cs=>[...cs, {
      id, name:form.name||'new-container', image:form.image,
      state:'running', uptime:'0m', cpu:0, mem:0, ports:form.ports, tag:'custom'
    }]);
  };

  const filtered = containers.filter(c => filter==='all' || c.state===filter);
  const counts = {
    all:        containers.length,
    running:    containers.filter(c=>c.state==='running').length,
    stopped:    containers.filter(c=>c.state==='stopped').length,
    restarting: containers.filter(c=>c.state==='restarting').length,
  };

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      {showNew && <NewContainerDialog onClose={()=>setShowNew(false)} onAdd={addContainer}/>}
      {logsFor    && <LogsDialog    c={logsFor}    onClose={()=>setLogsFor(null)}/>}
      {termFor    && <TerminalDialog c={termFor}    onClose={()=>setTermFor(null)}/>}
      {inspectFor && <InspectDialog  c={inspectFor} onClose={()=>setInspectFor(null)}/>}
      {editFor    && <ContainerEditDialog c={editFor} onClose={()=>setEditFor(null)} onSaved={()=>{setEditFor(null);loadContainers();}}/>}

      <div className="grid grid-4">
        <Mini2 label="WSZYSTKIE"  v={counts.all}     sub="kontenerów"/>
        <Mini2 label="DZIAŁAJĄCE" v={counts.running}  sub="aktywne"    color="var(--ok)"/>
        <Mini2 label="ZATRZYMANE" v={counts.stopped}  sub="bezczynne"  color="var(--fg-dim)"/>
        <Mini2 label="RESTARTING" v={counts.restarting} sub="restart"  color="var(--warn)"/>
      </div>

      <div className="row" style={{justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
        <div className="segmented">
          {['all','running','stopped','restarting'].map(k=>(
            <button key={k} className={filter===k?'active':''} onClick={()=>setFilter(k)}>
              {{all:'Wszystkie',running:'Działają',stopped:'Zatrzymane',restarting:'Restart'}[k]} ({counts[k]})
            </button>
          ))}
        </div>
        <div className="row gap-sm">
          <div className="segmented">
            <button className={view==='grid'?'active':''} onClick={()=>setView('grid')}>Siatka</button>
            <button className={view==='list'?'active':''} onClick={()=>setView('list')}>Lista</button>
          </div>
          <button className="btn sm primary" onClick={()=>setShowNew(true)}><Icon name="plus" size={12}/> Nowy kontener</button>
        </div>
      </div>

      {loading && containers.length === 0 && (
        <DockerLoadingSplash />
      )}

      {!loading && filtered.length === 0 && (
        <div className="card" style={{padding:40,textAlign:'center',color:'var(--fg-dim)'}}>
          Brak kontenerów spełniających kryteria
        </div>
      )}

      {view==='grid' && filtered.length>0 && (
        <div className="grid grid-3">
          {filtered.map(c=>(
            <ContCard key={c.id} c={c} onAction={doContainerAction} moreFor={moreFor} setMoreFor={setMoreFor}/>
          ))}
        </div>
      )}
      {view==='list' && filtered.length>0 && (
        <div className="card">
          <table className="table">
            <thead><tr><th>Stan</th><th>Nazwa</th><th>Obraz</th><th>CPU</th><th>RAM</th><th>Porty</th><th>Uptime</th><th></th></tr></thead>
            <tbody>
              {filtered.map(c=>(
                <tr key={c.id}>
                  <td><StateBadge s={c.state}/></td>
                  <td><span className="row gap-sm"><div className="cont-icon" style={{width:22,height:22,fontSize:11}}>{(c.name||'?')[0].toUpperCase()}</div><span style={{fontWeight:500}}>{c.name}</span></span></td>
                  <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{c.image}</td>
                  <td className="mono">{c.cpu}%</td>
                  <td className="mono">{c.mem} MB</td>
                  <td className="mono dim">{c.ports}</td>
                  <td className="mono dim">{c.uptime}</td>
                  <td>
                    <div className="row gap-sm">
                      {c.state!=='running' && <button className="btn sm" onClick={()=>doContainerAction(c.id,'start')}><Icon name="play" size={11}/></button>}
                      {c.state==='running' && <button className="btn sm" onClick={()=>doContainerAction(c.id,'stop')}><Icon name="stop" size={11}/></button>}
                      <button className="btn sm" onClick={()=>doContainerAction(c.id,'restart')}><Icon name="restart" size={11}/></button>
                      <button className="btn sm" onClick={()=>setLogsFor(c)}><Icon name="log" size={11}/> Logs</button>
                      {c.state==='running' && <button className="btn sm" onClick={()=>setTermFor(c)} title="Terminal"><Icon name="terminal" size={11}/></button>}
                      <button className="btn sm ghost icon-only" onClick={()=>setInspectFor(c)} title="Inspekcja"><Icon name="search" size={13}/></button>
                      <div style={{position:'relative'}}>
                        <button className="btn sm ghost icon-only" onClick={e=>{e.stopPropagation();setMoreFor(moreFor===c.id?null:c.id);}}>
                          <Icon name="more" size={14}/>
                        </button>
                        {moreFor===c.id && <MoreMenu c={c} onAction={doContainerAction} onClose={()=>setMoreFor(null)}/>}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── Docker: tab Obrazy ────────────────────────────────────────────────────────
const DockerImages = () => {
  const [images, setImages] = React.useState([]);
  const [pullImg, setPullImg] = React.useState('');
  const [pulling, setPulling] = React.useState(false);

  // Pobierz obrazy z API
  React.useEffect(() => {
    fetch('/services/docker/images', {credentials:'include'})
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const list = data.images||data||[];
        setImages(list.map(im => ({
          repo:    im.repository||im.RepoTags?.[0]?.split(':')[0]||im.repo||'—',
          tag:     im.tag||im.RepoTags?.[0]?.split(':')[1]||'latest',
          id:      (im.id||im.ID||'').slice(7,15)||'—',
          size:    im.size||im.Size||'—',
          created: im.created||im.Created||'—',
          used:    im.used !== false,
        })));
      })
      .catch(() => setImages([]));
  }, []);

  const doPull = () => {
    if (!pullImg) return;
    setPulling(true);
    fetch('/services/docker/images/pull', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({image: pullImg}),
    }).finally(() => {
      setPulling(false);
      setPullImg('');
      // Odśwież listę po chwili
      setTimeout(() => {
        fetch('/services/docker/images', {credentials:'include'})
          .then(r=>r.ok?r.json():null).then(data=>{
            if (!data) return;
            const list = data.images||data||[];
            setImages(list.map(im=>({
              repo: im.repository||'—', tag: im.tag||'latest',
              id: (im.id||'').slice(7,15)||'—', size: im.size||'—', created: im.created||'—', used: true,
            })));
          }).catch(()=>{});
      }, 3000);
    });
  };

  const removeImage = (id) => {
    fetch('/services/docker/images/remove', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({id}),
    }).catch(()=>{});
    setImages(imgs=>imgs.filter(im=>im.id!==id));
  };

  const inpSt = {background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:5,
    padding:'5px 10px',color:'var(--fg)',fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',outline:'none'};
  return (
    <div className="card">
      <div className="card-head">
        <div><div className="card-title">Obrazy Docker</div><div className="card-sub">{images.length} obrazów</div></div>
        <div className="card-actions">
          <input style={{...inpSt,width:240}} value={pullImg} onChange={e=>setPullImg(e.target.value)}
            placeholder="nginx:alpine" onKeyDown={e=>e.key==='Enter'&&doPull()}/>
          <button className="btn sm primary" onClick={doPull} disabled={pulling}>
            {pulling ? <><span className="dot pulse" style={{display:'inline-block',marginRight:6}}/>Pobieranie…</> : <><Icon name="download" size={11}/> Pull</>}
          </button>
        </div>
      </div>
      {images.length === 0
        ? <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>Ładowanie obrazów…</div>
        : <table className="table">
            <thead><tr><th>Repozytorium</th><th>Tag</th><th>Image ID</th><th>Rozmiar</th><th>Utworzony</th><th>Użyty</th><th></th></tr></thead>
            <tbody>
              {images.map((im,i)=>(
                <tr key={i}>
                  <td className="mono" style={{fontWeight:500}}>{im.repo}</td>
                  <td><span className="chip">{im.tag}</span></td>
                  <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{im.id}</td>
                  <td className="mono">{im.size}</td>
                  <td className="dim">{im.created}</td>
                  <td>{im.used?<span className="badge ok">tak</span>:<span className="badge dim">nie</span>}</td>
                  <td>
                    <button className="icon-btn" onClick={()=>removeImage(im.id)}><Icon name="trash" size={13}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      }
    </div>
  );
};

// ── Docker: tab Sieci ─────────────────────────────────────────────────────────
const DockerNetworks = () => {
  const [nets, setNets] = React.useState([]);

  React.useEffect(() => {
    fetch('/services/docker/networks', {credentials:'include'})
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const list = data.networks||data||[];
        setNets(list.map(n=>({
          name:       n.name||n.Name||'—',
          driver:     n.driver||n.Driver||'bridge',
          scope:      n.scope||n.Scope||'local',
          subnet:     n.subnet||n.IPAM?.Config?.[0]?.Subnet||'—',
          containers: typeof n.containers==='number'?n.containers:Object.keys(n.containers||n.Containers||{}).length,
        })));
      })
      .catch(() => setNets([]));
  }, []);

  const removeNet = (name) => {
    fetch('/services/docker/networks/'+encodeURIComponent(name), {method:'DELETE',credentials:'include'}).catch(()=>{});
    setNets(ns=>ns.filter(n=>n.name!==name));
  };

  return (
    <div className="card">
      <div className="card-head">
        <div><div className="card-title">Sieci Docker</div><div className="card-sub">{nets.length} sieci</div></div>
        <div className="card-actions"><button className="btn sm primary"><Icon name="plus" size={12}/> Utwórz sieć</button></div>
      </div>
      {nets.length === 0
        ? <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>Ładowanie sieci…</div>
        : <table className="table">
            <thead><tr><th>Nazwa</th><th>Driver</th><th>Zakres</th><th>Podsieć</th><th>Kontenery</th><th></th></tr></thead>
            <tbody>
              {nets.map((n,i)=>(
                <tr key={i}>
                  <td style={{fontWeight:500}}>{n.name}</td>
                  <td><span className="chip">{n.driver}</span></td>
                  <td className="mono dim">{n.scope}</td>
                  <td className="mono">{n.subnet}</td>
                  <td className="mono">{n.containers>0?<span style={{color:'var(--accent)'}}>{n.containers}</span>:<span className="dim">0</span>}</td>
                  <td>
                    {!['bridge','host','none'].includes(n.name) &&
                      <button className="icon-btn" onClick={()=>removeNet(n.name)}><Icon name="trash" size={13}/></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      }
    </div>
  );
};

// ── Docker: tab Wolumeny ──────────────────────────────────────────────────────
const DockerVolumes = () => {
  const [vols, setVols] = React.useState([]);

  React.useEffect(() => {
    fetch('/services/docker/volumes', {credentials:'include'})
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const list = data.volumes||data||[];
        setVols(list.map(v=>({
          name:       v.name||v.Name||'—',
          driver:     v.driver||v.Driver||'local',
          mountpoint: v.mountpoint||v.Mountpoint||'—',
          size:       v.size||v.Size||'—',
          containers: v.containers||[],
        })));
      })
      .catch(() => setVols([]));
  }, []);

  const orphaned = vols.filter(v=>v.containers.length===0);

  const pruneOrphaned = () => {
    fetch('/services/docker/volumes/prune', {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});
    setVols(vs=>vs.filter(v=>v.containers.length>0));
  };

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      {orphaned.length>0 && (
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',
          background:'oklch(0.78 0.15 75 / 0.08)',border:'1px solid oklch(0.78 0.15 75 / 0.25)',
          borderRadius:8,fontSize:'var(--fs-sm)'}}>
          <Icon name="thermometer" size={14} style={{color:'var(--warn)',flexShrink:0}}/>
          <span>{orphaned.length} wolumen{orphaned.length>1?'y':''} bez kontenerów (osierocone)</span>
          <button className="btn sm danger" style={{marginLeft:'auto'}} onClick={pruneOrphaned}>
            <Icon name="trash" size={11}/> Usuń osierocone
          </button>
        </div>
      )}
      <div className="card">
        <div className="card-head">
          <div><div className="card-title">Wolumeny Docker</div><div className="card-sub">{vols.length} wolumenów</div></div>
          <div className="card-actions"><button className="btn sm primary"><Icon name="plus" size={12}/> Utwórz wolumen</button></div>
        </div>
        {vols.length === 0
          ? <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>Ładowanie wolumenów…</div>
          : <table className="table">
              <thead><tr><th>Nazwa</th><th>Driver</th><th>Punkt montowania</th><th>Rozmiar</th><th>Kontenery</th><th></th></tr></thead>
              <tbody>
                {vols.map((v,i)=>(
                  <tr key={i} style={{opacity:v.containers.length===0?0.7:1}}>
                    <td style={{fontWeight:500}}>{v.name} {v.containers.length===0&&<span className="badge warn" style={{marginLeft:4}}>osierocony</span>}</td>
                    <td><span className="chip">{v.driver}</span></td>
                    <td className="mono dim" style={{fontSize:'var(--fs-xs)',maxWidth:280,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v.mountpoint}</td>
                    <td className="mono">{v.size}</td>
                    <td className="mono dim">{(v.containers||[]).join(', ')||'—'}</td>
                    <td>
                      <button className="icon-btn" onClick={()=>{
                        fetch('/services/docker/volumes/'+encodeURIComponent(v.name),{method:'DELETE',credentials:'include'}).catch(()=>{});
                        setVols(vs=>vs.filter((_,j)=>j!==i));
                      }}><Icon name="trash" size={13}/></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        }
      </div>
    </div>
  );
};

// ── Docker: tab Compose ───────────────────────────────────────────────────────
const DockerCompose = () => {
  const [stacks, setStacks] = React.useState([]);
  const [showNew, setShowNew] = React.useState(false);
  const [editStack, setEditStack] = React.useState(null);

  React.useEffect(() => {
    fetch('/services/docker/compose', {credentials:'include'})
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const list = Array.isArray(data.stacks) ? data.stacks : [];
        console.log('[compose] stacks from API:', list);
        setStacks(list.map(s=>({
          name:     s.name || '—',
          file:     s.file || s.path || '—',
          services: s.services || [],
          status:   s.status || 'stopped',
          updated:  s.updated || '—',
          yaml:     s.yaml || s.content || '',
        })));
      })
      .catch(() => setStacks([]));
  }, []);

  // Pobierz zawartość pliku compose gdy użytkownik klika Edytuj
  const openEdit = async (stack) => {
    // Walidacja — stack.file musi być prawdziwą ścieżką
    const filePath = stack.file;
    if (!filePath || filePath === '—' || !filePath.startsWith('/')) {
      // Brak ścieżki — otwórz dialog bez zawartości
      setEditStack(stack);
      return;
    }
    try {
      const url = '/api/docker/compose-file?path=' + encodeURIComponent(filePath);
      const r = await fetch(url, {credentials:'include'});
      if (r.ok) {
        const d = await r.json();
        setEditStack({...stack, yaml: d.content || ''});
        return;
      }
    } catch(e) {
      console.error('openEdit error:', e);
    }
    setEditStack(stack);
  };

  const deploy = (data) => {
    setStacks(ss=>{
      const idx = ss.findIndex(s=>s.name===data.name);
      const entry = {
        name:    data.name || 'new-stack',
        file:    data.file || `/opt/stacks/${data.name}/docker-compose.yml`,
        services: data.services || [],
        status:  data.status || 'running',
        updated: new Date().toISOString().slice(0,10),
      };
      if (idx >= 0) return ss.map((s,i) => i===idx ? {...s,...entry} : s);
      return [...ss, entry];
    });
    // Odśwież dane z serwera po chwili
    setTimeout(() => {
      fetch('/services/docker/compose', {credentials:'include'})
        .then(r=>r.ok?r.json():null)
        .then(d=>{
          if (!d?.stacks) return;
          setStacks(d.stacks.map(s=>({
            name:s.name||'—', file:s.file||'—',
            services:s.services||[], status:s.status||'stopped', updated:s.updated||'—',
          })));
        }).catch(()=>{});
    }, 2000);
  };

  const toggleStack = (name) => {
    const s = stacks.find(s=>s.name===name);
    const action = s?.status==='running' ? 'down' : 'up';
    fetch(`/services/docker/compose/${encodeURIComponent(name)}`, {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify({action}),
    }).catch(()=>{});
    setStacks(ss=>ss.map(s=>s.name===name?{...s,status:action==='up'?'running':'stopped'}:s));
  };

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      {showNew    && <ComposeDialog onClose={()=>setShowNew(false)} onDeploy={deploy}/>}
      {editStack  && <ComposeDialog stack={editStack} onClose={()=>setEditStack(null)} onDeploy={deploy}/>}
      <div className="card">
        <div className="card-head">
          <div><div className="card-title">Stosy Compose</div><div className="card-sub">{stacks.length} stosów</div></div>
          <div className="card-actions">
            <button className="btn sm primary" onClick={()=>setShowNew(true)}><Icon name="plus" size={12}/> Nowy stos</button>
          </div>
        </div>
        {stacks.length === 0
          ? <div style={{padding:40,textAlign:'center',color:'var(--fg-dim)'}}>
              <Icon name="plus" size={32} style={{color:'var(--line-strong)',display:'block',margin:'0 auto 12px'}}/>
              <div style={{fontSize:'var(--fs-sm)',marginBottom:6}}>Brak stosów Compose</div>
              <div style={{fontSize:'var(--fs-xs)',marginBottom:16}}>Nie znaleziono plików docker-compose.yml w <span className="mono">/opt/stacks</span>, <span className="mono">/srv</span> ani <span className="mono">/home</span></div>
              <button className="btn sm primary" onClick={()=>setShowNew(true)}><Icon name="plus" size={11}/> Utwórz pierwszy stos</button>
            </div>
          : <table className="table">
              <thead><tr><th>Nazwa</th><th>Status</th><th>Usługi</th><th>Plik</th><th>Aktualizacja</th><th></th></tr></thead>
              <tbody>
                {stacks.map((s,i)=>(
                  <tr key={i}>
                    <td style={{fontWeight:600}}>{s.name}</td>
                    <td>
                      {s.status==='running'?<span className="badge ok"><span className="dot pulse"/>UP</span>
                        :s.status==='partial'?<span className="badge warn"><span className="dot pulse"/>PARTIAL</span>
                        :<span className="badge">DOWN</span>}
                    </td>
                    <td><div className="row gap-sm" style={{flexWrap:'wrap'}}>{(s.services||[]).map(sv=><span key={sv} className="chip">{sv}</span>)}</div></td>
                    <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{s.file}</td>
                    <td className="mono dim">{s.updated}</td>
                    <td>
                      <div className="row gap-sm">
                        <button className="btn sm" onClick={()=>openEdit(s)}><Icon name="edit" size={11}/> Edit</button>
                        <button className="btn sm" onClick={()=>toggleStack(s.name)}>
                          {s.status==='running'?<><Icon name="stop" size={11}/> Down</>:<><Icon name="play" size={11}/> Up</>}
                        </button>
                        <button className="icon-btn" onClick={()=>setStacks(ss=>ss.filter((_,j)=>j!==i))}><Icon name="trash" size={13}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        }
      </div>
    </div>
  );
};

// ── Docker root ───────────────────────────────────────────────────────────────
const Docker = () => {
  const CONTAINERS = useStore('CONTAINERS');
  const [containers, setContainers] = React.useState(CONTAINERS || []);
  const [dockerTab,  setDockerTab]  = React.useState('containers');
  const [loadingCont, setLoadingCont] = React.useState(!CONTAINERS || CONTAINERS.length === 0);

  // Synchronizuj z globalnym store
  React.useEffect(() => {
    if (CONTAINERS && CONTAINERS.length > 0) {
      setContainers(CONTAINERS);
      setLoadingCont(false);
    }
  }, [CONTAINERS]);

  // Timeout — jeśli po 8s nadal brak danych, zakończ loading
  React.useEffect(() => {
    const t = setTimeout(() => setLoadingCont(false), 8000);
    return () => clearTimeout(t);
  }, []);

  const TABS = [
    {id:'containers', label:'Kontenery'},
    {id:'images',     label:'Obrazy'},
    {id:'networks',   label:'Sieci'},
    {id:'volumes',    label:'Wolumeny'},
    {id:'compose',    label:'Compose'},
    {id:'topology',   label:'Topology'},
  ];
  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="segmented">
        {TABS.map(t=><button key={t.id} className={dockerTab===t.id?'active':''} onClick={()=>setDockerTab(t.id)}>{t.label}</button>)}
      </div>
      {dockerTab==='containers' && <DockerContainers containers={CONTAINERS} setContainers={c=>storeSet('CONTAINERS',c)} loading={loadingCont}/>}
      {dockerTab==='images'     && <DockerImages/>}
      {dockerTab==='networks'   && <DockerNetworks/>}
      {dockerTab==='volumes'    && <DockerVolumes/>}
      {dockerTab==='compose'    && <DockerCompose/>}
      {dockerTab==='topology'   && window.DockerTopology && React.createElement(window.DockerTopology)}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// NETWORK
// ═══════════════════════════════════════════════════════════════════════════

const WG_PEERS_PLACEHOLDER = [
  { name:'laptop',   pubkey:'8Gf3kL9...mNpQ', ip:'10.8.0.2/32', endpoint:'dynamic', last:'teraz',   rx:'0', tx:'0', on:true },
];

// ═══════════════════════════════════════════════════════════════════════════
// DYNAMIC DNS
// ═══════════════════════════════════════════════════════════════════════════

const DDNS_PROVIDERS = [
  { id:'noip',       label:'No-IP',              color:'oklch(0.65 0.18 145)', fields:['hostname','username','password','email'], desc:'dynupdate.no-ip.com' },
  { id:'duckdns',    label:'DuckDNS',             color:'oklch(0.65 0.18 220)', fields:['hostname','token'],                       desc:'duckdns.org' },
  { id:'freedns',    label:'FreeDNS (afraid.org)',color:'oklch(0.65 0.2 25)',   fields:['hostname','updateUrl'],                   desc:'freedns.afraid.org' },
  { id:'cloudflare', label:'Cloudflare',          color:'oklch(0.65 0.15 50)',  fields:['hostname','api_key','zone_id','record_id'],desc:'api.cloudflare.com' },
  { id:'dynu',       label:'Dynu',                color:'oklch(0.65 0.18 300)', fields:['hostname','username','password'],         desc:'api.dynu.com' },
  { id:'he',         label:'Hurricane Electric',  color:'oklch(0.65 0.15 200)', fields:['hostname','password'],                   desc:'dyn.dns.he.net' },
  { id:'ovh',        label:'OVH DynHost',         color:'oklch(0.65 0.18 260)', fields:['hostname','username','password'],         desc:'ovh.com' },
];

const DDNS_FIELD_META = {
  hostname:  { label:'Hostname',              ph:'np. mojnas.ddns.net',                                    mono:true  },
  username:  { label:'Nazwa użytkownika',     ph:'login@example.com',                                      mono:false },
  password:  { label:'Hasło',                 ph:'••••••••',                                               mono:true, type:'password' },
  email:     { label:'E-mail (User-Agent)',   ph:'email@example.com',                                      mono:false },
  token:     { label:'Token',                 ph:'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',                   mono:true, type:'password' },
  updateUrl: { label:'Update URL (z tokenem)',ph:'https://freedns.afraid.org/dynamic/update.php?TOKEN=',   mono:true,
               hint:'afraid.org → Dynamic DNS → (ikona) → Direct URL' },
  api_key:   { label:'API Token',             ph:'Bearer token z Cloudflare',                              mono:true, type:'password' },
  zone_id:   { label:'Zone ID',              ph:'np. abc123def456...',                                     mono:true },
  record_id: { label:'Record ID',            ph:'np. xyz789...',                                           mono:true },
};

const AddDDNSDialog = ({ onClose, onAdd, editEntry }) => {
  const [provider, setProvider] = React.useState(editEntry?.provider || 'noip');
  const [fields,   setFields]   = React.useState({
    hostname: '', username: '', password: '', email: '',
    token: '', updateUrl: '', api_key: '', zone_id: '', record_id: '',
    ...(editEntry || {}),
  });
  const [enabled, setEnabled] = React.useState(editEntry ? editEntry.enabled : true);
  const [saving,  setSaving]  = React.useState(false);
  const [err,     setErr]     = React.useState('');

  const prov  = DDNS_PROVIDERS.find(p => p.id === provider) || DDNS_PROVIDERS[0];
  const inpSt = { background:'var(--bg-2)', border:'1px solid var(--line-strong)', borderRadius:5,
    padding:'7px 10px', color:'var(--fg)', fontSize:'var(--fs-sm)', outline:'none', width:'100%' };

  const save = async () => {
    if (!fields.hostname.trim()) { setErr('Podaj hostname.'); return; }
    setSaving(true); setErr('');
    const payload = { provider, enabled, ...fields };
    if (editEntry?.id) payload.id = editEntry.id;
    try {
      const url    = editEntry?.id ? `/network/dynamic-dns/${editEntry.id}` : '/network/dynamic-dns';
      const method = editEntry?.id ? 'PUT' : 'POST';
      const r = await fetch(url, { method, credentials:'include',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Błąd zapisu'); setSaving(false); return; }
      onAdd(d); onClose();
    } catch(e) { setErr(e.message); }
    setSaving(false);
  };

  return (
    <Modal title={editEntry ? `Edytuj · ${editEntry.hostname}` : 'Nowy wpis Dynamic DNS'}
      sub="Konfiguracja usługi aktualizacji DNS" onClose={onClose} width={540}
      footer={<div className="row gap-sm" style={{marginLeft:'auto'}}>
        <button className="btn sm" onClick={onClose}>Anuluj</button>
        <button className="btn sm primary" onClick={save} disabled={saving}>
          {saving ? <><span className="dot pulse" style={{marginRight:6}}/>Zapisuję…</> : <><Icon name="check" size={11}/> Zapisz</>}
        </button>
      </div>}
    >
      <div className="col" style={{gap:16}}>
        {!editEntry && (
          <div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:8,fontWeight:600,textTransform:'uppercase',letterSpacing:'.06em'}}>Dostawca</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6}}>
              {DDNS_PROVIDERS.map(p => (
                <div key={p.id} onClick={()=>setProvider(p.id)}
                  style={{padding:'8px 6px',borderRadius:7,cursor:'pointer',textAlign:'center',transition:'all .12s',
                    border:'1px solid '+(provider===p.id?p.color:'var(--line-strong)'),
                    background:provider===p.id?p.color+'18':'var(--bg-2)'}}>
                  <div style={{fontSize:11,fontWeight:provider===p.id?600:400,color:provider===p.id?p.color:'var(--fg)',lineHeight:1.3}}>{p.label}</div>
                  <div style={{fontSize:9,color:'var(--fg-dim)',marginTop:2}}>{p.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {prov.fields.map(key => {
          const fd = DDNS_FIELD_META[key] || { label:key, ph:'', mono:true };
          return (
            <div key={key}>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4,fontWeight:500}}>{fd.label}</div>
              <input type={fd.type||'text'}
                style={{...inpSt, fontFamily: fd.mono ? 'var(--font-mono)' : 'inherit'}}
                value={fields[key]||''} onChange={e=>setFields(f=>({...f,[key]:e.target.value}))}
                placeholder={fd.ph}/>
              {fd.hint && <div style={{marginTop:4,padding:'5px 9px',background:'var(--bg-2)',border:'1px solid var(--line)',
                borderRadius:5,fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>{fd.hint}</div>}
            </div>
          );
        })}

        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
          padding:'10px 12px',background:'var(--bg-2)',borderRadius:7,border:'1px solid var(--line-strong)'}}>
          <div>
            <div style={{fontSize:'var(--fs-sm)',fontWeight:500}}>Aktywny</div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>Czy aktualizować IP dla tego wpisu</div>
          </div>
          <div className={"toggle "+(enabled?'on':'')} onClick={()=>setEnabled(v=>!v)}/>
        </div>

        {err && <div style={{padding:'7px 10px',background:'oklch(0.65 0.2 25 / 0.08)',
          border:'1px solid oklch(0.65 0.2 25 / 0.3)',borderRadius:5,fontSize:'var(--fs-xs)',color:'var(--err)'}}>{err}</div>}
      </div>
    </Modal>
  );
};

const CronDialog = ({ current, onClose, onInstalled }) => {
  const [interval, setInterval_] = React.useState(current?.interval || 5);
  const [busy, setBusy] = React.useState(false);
  const [log,  setLog]  = React.useState('');

  const install = async () => {
    setBusy(true); setLog('');
    const r = await fetch('/network/dynamic-dns/install-cron', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ interval: interval }),
    });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) { setLog('[BŁĄD] '+(d.error||'Nieznany błąd')); return; }
    setLog('[OK] Zainstalowano: '+d.file);
    setTimeout(() => { onInstalled(d); onClose(); }, 1500);
  };

  return (
    <Modal title="Harmonogram aktualizacji DNS" sub="/etc/cron.d/nimbus-ddns" onClose={onClose} width={440}
      footer={<div className="row gap-sm" style={{marginLeft:'auto'}}>
        <button className="btn sm" onClick={onClose}>Anuluj</button>
        <button className="btn sm primary" onClick={install} disabled={busy}>
          {busy ? <><span className="dot pulse" style={{marginRight:6}}/>Instaluję…</> : <><Icon name="check" size={11}/> Zainstaluj</>}
        </button>
      </div>}
    >
      <div className="col" style={{gap:16}}>
        <div style={{padding:'10px 14px',borderRadius:8,border:'1px solid var(--line-strong)',
          background:current?.installed?'oklch(0.55 0.18 145 / 0.08)':'var(--bg-2)'}}>
          <span className={"badge "+(current?.installed?'ok':'')}>
            {current?.installed ? `AKTYWNY · co ${current.interval} min` : 'NIEAKTYWNY'}
          </span>
          {current?.content && <pre style={{marginTop:8,fontSize:10,fontFamily:'var(--font-mono)',
            color:'var(--fg-dim)',whiteSpace:'pre-wrap',margin:'8px 0 0'}}>{current.content.trim()}</pre>}
        </div>
        <div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:8,fontWeight:600,
            textTransform:'uppercase',letterSpacing:'.06em'}}>Częstotliwość</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6}}>
            {[5,15,30,60].map(n => (
              <div key={n} onClick={()=>setInterval_(n)}
                style={{padding:'10px 8px',borderRadius:7,cursor:'pointer',textAlign:'center',transition:'all .12s',
                  border:'1px solid '+(interval===n?'var(--accent)':'var(--line-strong)'),
                  background:interval===n?'oklch(0.55 0.2 260 / 0.12)':'var(--bg-2)'}}>
                <div style={{fontWeight:600,fontSize:'var(--fs-sm)',color:interval===n?'var(--accent)':'var(--fg)'}}>{n===60?'1h':`${n} min`}</div>
                <div style={{fontSize:9,color:'var(--fg-dim)',marginTop:2}}>{n===5?'zalecane':n===15?'umiarkowane':n===30?'rzadkie':'co godzinę'}</div>
              </div>
            ))}
          </div>
        </div>
        {log && <div style={{padding:'8px 12px',background:'var(--bg)',borderRadius:5,fontFamily:'var(--font-mono)',
          fontSize:11,color:log.includes('[OK]')?'var(--ok)':'var(--err)',whiteSpace:'pre-wrap'}}>{log}</div>}
      </div>
    </Modal>
  );
};

const DynamicDNS = () => {
  const [entries,   setEntries]   = React.useState([]);
  const [cron,      setCron]      = React.useState(null);
  const [publicIP,  setPublicIP]  = React.useState('');
  const [loading,   setLoading]   = React.useState(true);
  const [showAdd,   setShowAdd]   = React.useState(false);
  const [editEntry, setEditEntry] = React.useState(null);
  const [showCron,  setShowCron]  = React.useState(false);
  const [updating,  setUpdating]  = React.useState({});
  const [updAll,    setUpdAll]    = React.useState(false);

  const load = async () => {
    const [r1,r2,r3] = await Promise.all([
      fetch('/network/dynamic-dns',             {credentials:'include'}).then(r=>r.json()).catch(()=>({})),
      fetch('/network/dynamic-dns/cron-status', {credentials:'include'}).then(r=>r.json()).catch(()=>({})),
      fetch('https://api4.ipify.org?format=json').then(r=>r.json()).catch(()=>({})),
    ]);
    setEntries((r1.entries || r1.services || []));
    setCron(r2);
    if (r3.ip) setPublicIP(r3.ip);
    setLoading(false);
  };
  React.useEffect(() => { load(); }, []);

  const forceUpdate = async (entry) => {
    setUpdating(u=>({...u,[entry.id]:true}));
    try {
      const r = await fetch(`/network/dynamic-dns/${entry.id}/update`,{method:'POST',credentials:'include'});
      const d = await r.json();
      setEntries(es=>es.map(e=>e.id===entry.id?{...e,...d,status:d.status,statusMsg:d.statusMsg||d.result,lastIp:d.ip,lastUpdate:d.lastUpdate}:e));
    } catch {}
    setUpdating(u=>({...u,[entry.id]:false}));
  };

  const forceUpdateAll = async () => {
    setUpdAll(true);
    try {
      const r = await fetch('/network/dynamic-dns/update-all',{method:'POST',credentials:'include'});
      const d = await r.json();
      if (d.results) {
        setEntries(es=>es.map(e=>{
          const res=d.results.find(x=>x.id===e.id);
          return res?{...e,status:res.status,statusMsg:res.msg,lastIp:d.ip,lastUpdate:new Date().toISOString()}:e;
        }));
        if (d.ip) setPublicIP(d.ip);
      }
    } catch {}
    setUpdAll(false);
  };

  const toggleEntry = async (entry) => {
    const upd = {...entry, enabled: !entry.enabled};
    await fetch(`/network/dynamic-dns/${entry.id}`,{method:'PUT',credentials:'include',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(upd)});
    setEntries(es=>es.map(e=>e.id===entry.id?upd:e));
  };

  const deleteEntry = async (id) => {
    if (!confirm('Usunąć ten wpis?')) return;
    await fetch(`/network/dynamic-dns/${id}`,{method:'DELETE',credentials:'include'});
    setEntries(es=>es.filter(e=>e.id!==id));
  };

  const provColor = id => DDNS_PROVIDERS.find(p=>p.id===id)?.color||'var(--fg-dim)';
  const provLabel = id => DDNS_PROVIDERS.find(p=>p.id===id)?.label||id;
  const fmtDate   = iso => { try { return new Date(iso).toLocaleString('pl',{dateStyle:'short',timeStyle:'short'}); } catch { return iso||'—'; } };

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      {(showAdd||editEntry) && <AddDDNSDialog editEntry={editEntry}
        onClose={()=>{setShowAdd(false);setEditEntry(null);}}
        onAdd={d=>{if(editEntry)setEntries(es=>es.map(e=>e.id===d.id?d:e));else setEntries(es=>[...es,d]);}}/>}
      {showCron && <CronDialog current={cron} onClose={()=>setShowCron(false)} onInstalled={d=>setCron(d)}/>}

      {/* KPIs */}
      <div className="grid grid-4">
        <div className="kpi">
          <div className="kpi-label">PUBLICZNY IP</div>
          <div className="kpi-value mono" style={{fontSize:16}}>{publicIP||'…'}</div>
          <div className="kpi-foot">aktualny adres WAN</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">WPISY</div>
          <div className="kpi-value">{entries.length}</div>
          <div className="kpi-foot">{entries.filter(e=>e.enabled).length} aktywnych</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">STATUS</div>
          <div className="kpi-value" style={{fontSize:16,color:entries.some(e=>e.status==='error'&&e.enabled)?'var(--err)':'var(--ok)'}}>
            {entries.some(e=>e.status==='error'&&e.enabled)?'BŁĄD':'OK'}
          </div>
          <div className="kpi-foot">{entries.filter(e=>e.status==='error').length} błędów</div>
        </div>
        <div className="kpi" style={{cursor:'pointer'}} onClick={()=>setShowCron(true)}>
          <div className="kpi-label">HARMONOGRAM</div>
          <div className="kpi-value" style={{fontSize:14,color:cron?.installed?'var(--ok)':'var(--fg-dim)'}}>
            {cron?.installed?`co ${cron.interval} min`:'wyłączony'}
          </div>
          <div className="kpi-foot">kliknij aby konfigurować</div>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Wpisy Dynamic DNS</div>
            <div className="card-sub">Automatyczna aktualizacja rekordów DNS przy zmianie IP</div>
          </div>
          <div className="card-actions">
            <button className="btn sm" onClick={()=>setShowCron(true)}>
              <Icon name="time" size={11}/> Harmonogram{cron?.installed&&<span className="badge ok" style={{marginLeft:4}}>ON</span>}
            </button>
            <button className="btn sm" onClick={forceUpdateAll} disabled={updAll||!entries.length}>
              {updAll?<><span className="dot pulse" style={{marginRight:6}}/>Aktualizuję…</>:<><Icon name="refresh" size={11}/> Aktualizuj wszystkie</>}
            </button>
            <button className="btn sm primary" onClick={()=>setShowAdd(true)}>
              <Icon name="plus" size={11}/> Dodaj wpis
            </button>
          </div>
        </div>

        {loading?(
          <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}><span className="dot pulse" style={{display:'inline-block',marginRight:8}}/>Ładowanie…</div>
        ):entries.length===0?(
          <div style={{padding:40,textAlign:'center',color:'var(--fg-dim)'}}>
            <Icon name="globe" size={32} style={{color:'var(--line-strong)',display:'block',margin:'0 auto 12px'}}/>
            <div style={{fontSize:'var(--fs-sm)',marginBottom:6}}>Brak wpisów Dynamic DNS</div>
            <div style={{fontSize:'var(--fs-xs)',marginBottom:16}}>Dodaj wpis aby automatycznie aktualizować DNS przy zmianie IP</div>
            <button className="btn sm primary" onClick={()=>setShowAdd(true)}><Icon name="plus" size={11}/> Dodaj pierwszy wpis</button>
          </div>
        ):(
          <div className="col" style={{gap:8,padding:'0 0 8px'}}>
            {entries.map(e=>{
              const color = provColor(e.provider);
              const isErr = e.status==='error';
              const busy  = updating[e.id];
              return (
                <div key={e.id} style={{margin:'0 16px',borderRadius:9,overflow:'hidden',
                  border:'1px solid '+(isErr?'oklch(0.65 0.2 25 / 0.35)':'var(--line-strong)'),
                  background:isErr?'oklch(0.65 0.2 25 / 0.04)':'var(--bg-2)'}}>
                  <div style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px'}}>
                    <div style={{width:42,height:42,borderRadius:10,background:color+'22',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      <Icon name="globe" size={20} style={{color}}/>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3,flexWrap:'wrap'}}>
                        <span style={{fontWeight:600,fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)'}}>{e.hostname}</span>
                        <span style={{fontSize:10,color,background:color+'18',padding:'1px 7px',borderRadius:4,fontWeight:500}}>{provLabel(e.provider)}</span>
                        <span className={"badge "+(e.status==='active'?'ok':isErr?'err':'')}>{e.status==='active'?'OK':isErr?'BŁĄD':'pending'}</span>
                      </div>
                      <div style={{display:'flex',gap:14,fontSize:'var(--fs-xs)',color:'var(--fg-dim)',flexWrap:'wrap'}}>
                        {e.lastIp    && <span>IP: <span className="mono" style={{color:'var(--fg)'}}>{e.lastIp}</span></span>}
                        {e.lastUpdate && <span>Aktualizacja: {fmtDate(e.lastUpdate)}</span>}
                        {e.statusMsg  && <span style={{color:isErr?'var(--err)':'var(--fg-dim)',maxWidth:280,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.statusMsg}</span>}
                      </div>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                      <div className={"toggle "+(e.enabled?'on':'')} onClick={()=>toggleEntry(e)}/>
                      {busy
                        ?<span className="badge warn"><span className="dot pulse"/>Aktualizuję…</span>
                        :<button className="btn sm" onClick={()=>forceUpdate(e)} disabled={!e.enabled}><Icon name="refresh" size={11}/> Aktualizuj</button>}
                      <button className="icon-btn" onClick={()=>setEditEntry(e)} title="Edytuj"><Icon name="edit" size={13}/></button>
                      <button className="icon-btn" onClick={()=>deleteEntry(e.id)} title="Usuń"><Icon name="trash" size={13}/></button>
                    </div>
                  </div>
                  {isErr&&e.statusMsg&&(
                    <div style={{padding:'6px 14px 10px',borderTop:'1px solid oklch(0.65 0.2 25 / 0.15)'}}>
                      <div style={{fontSize:'var(--fs-xs)',color:'var(--err)',fontFamily:'var(--font-mono)'}}>⚠ {e.statusMsg}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const Network = () => {
  const [netTab, setNetTab] = React.useState('interfaces');
  const [tick, setTick]     = React.useState(0);
  const [editIface, setEditIface] = React.useState(null);
  const NETWORK = useStore('NETWORK');
  React.useEffect(() => { const id = setInterval(() => setTick(t=>t+1), 2000); return () => clearInterval(id); }, []);
  const rx = React.useMemo(() => genSeries(11+tick,40,40,40),[tick]);
  const tx = React.useMemo(() => genSeries(23+tick,40,28,30),[tick]);
  const N  = NETWORK || {hostname:'—',domain:'—',gateway:'—',dns:[],interfaces:[]};
  const ifaces = N.interfaces || [];

  const NET_TABS = [
    {id:'interfaces', label:'Interfejsy'},
    {id:'wireguard',  label:'WireGuard VPN'},
    {id:'dhcp',       label:'DHCP'},
    {id:'dns',        label:'DNS'},
    {id:'firewall',   label:'Firewall'},
    {id:'proxy',      label:'Reverse Proxy'},
    {id:'ddns',       label:'Dynamic DNS'},
  ];

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="segmented" style={{flexWrap:'wrap'}}>
        {NET_TABS.map(t=><button key={t.id} className={netTab===t.id?'active':''} onClick={()=>setNetTab(t.id)}>{t.label}</button>)}
      </div>
      {netTab==='interfaces' && (
        <div className="col" style={{gap:'var(--gutter)'}}>
          <div className="grid grid-2-1">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Przepustowość</div>
                  <div className="card-sub">{ifaces[0]?.name||'eth0'} · ostatnie 5 min</div>
                </div>
                <div className="card-actions">
                  <span className="badge ok"><span className="dot pulse"/>{ifaces.filter(i=>i.state==='up').length} iface UP</span>
                </div>
              </div>
              <div className="card-body">
                <div className="row" style={{gap:24,marginBottom:8,fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)',color:'var(--fg-muted)'}}>
                  <span><span style={{display:'inline-block',width:8,height:8,background:'var(--accent)',borderRadius:2,marginRight:6}}/>RX (download)</span>
                  <span><span style={{display:'inline-block',width:8,height:8,background:'oklch(0.78 0.15 75)',borderRadius:2,marginRight:6}}/>TX (upload)</span>
                </div>
                <LineChart series={[rx,tx]} colors={['var(--accent)','oklch(0.78 0.15 75)']} labels={['-5m','-4m','-3m','-2m','-1m','teraz']}/>
              </div>
            </div>
            <div className="card">
              <div className="card-head"><div className="card-title">Konfiguracja</div></div>
              <div className="card-body col" style={{gap:8}}>
                <KV k="Hostname" v={<span className="mono">{N.hostname}</span>}/>
                <KV k="Domena"   v={<span className="mono">{N.domain||'local'}</span>}/>
                <KV k="Brama"    v={<span className="mono">{N.gateway||'—'}</span>}/>
                <KV k="DNS"      v={<span className="mono">{(N.dns||[]).join(', ')||'—'}</span>}/>
                <hr className="div"/>
                <div className="row" style={{justifyContent:'space-between'}}><span>WireGuard VPN</span><div className={'toggle'+(ifaces.some(i=>i.name==='wg0'&&i.state==='up')?' on':'')}/></div>
                <div className="row" style={{justifyContent:'space-between'}}><span>IPv6</span><div className="toggle on"/></div>
              </div>
            </div>
          </div>
			<div className="card">
			  <div className="card-head"><div className="card-title">Interfejsy sieciowe</div></div>
			  <table className="table">
				<thead><tr><th>Interfejs</th><th>Stan</th><th>Prędkość</th><th>Adres IP</th><th>MAC</th><th>VLAN</th><th>RX</th><th>TX</th><th></th></tr></thead>
				<tbody>
				  {ifaces.length === 0
				    ? <tr><td colSpan={9} style={{textAlign:'center',padding:24,color:'var(--fg-dim)'}}>Ładowanie interfejsów…</td></tr>
				    : ifaces.map((iface,k)=>{
				        // Oblicz live wartości z małą animacją
				        const liveRx = iface.state === 'up' ? (iface.rx + (tick % 7) - 3).toFixed(0) : 0;
				        const liveTx = iface.state === 'up' ? (iface.tx + (tick % 5) - 2).toFixed(0) : 0;
				        
				        return (
				          <tr key={k}>
				            <td className="mono">{iface.name}</td>
				            <td>{iface.state==='up'?<span className="badge ok"><span className="dot"/>UP</span>:<span className="badge"><span className="dot"/>DOWN</span>}</td>
				            <td className="mono">{iface.speed||'—'}</td>
				            <td className="mono">{iface.ip||'—'}</td>
				            <td className="mono dim">{iface.mac||'—'}</td>
				            <td className="mono">{iface.vlan||'—'}</td>
				            <td className="mono" style={{color:iface.state==='up'?'var(--accent)':'var(--fg-dim)'}}>
				              <Icon name="arrow_down" size={10}/> {liveRx} MB/s
				            </td>
				            <td className="mono" style={{color:iface.state==='up'?'oklch(0.78 0.15 75)':'var(--fg-dim)'}}>
				              <Icon name="arrow_up" size={10}/> {liveTx} MB/s
				            </td>
				            <td><button className="icon-btn" onClick={()=>setEditIface(iface)}><Icon name="edit"/></button></td>
				          </tr>
				        );
				      })}
				</tbody>
			  </table>
			</div>
        </div>
      )}

      {netTab==='wireguard' && <NetworkWireGuard/>}
      {netTab==='dhcp'      && <NetworkDhcp/>}
      {netTab==='dns'       && <NetworkDns N={N}/>}

      {/* ── Firewall ── */}
      {netTab==='firewall' && <NetworkFirewall/>}

      {/* ── Reverse Proxy ── */}
      {netTab==='ddns'  && <DynamicDNS/>}
      {netTab==='proxy'   && <NetworkProxy/>}
      {editIface && <EditIfaceModal iface={editIface} onClose={()=>setEditIface(null)}/>}
    </div>
  );
};

// ── Edit Interface Modal ────────────────────────────────────────────────────
const EditIfaceModal = ({ iface, onClose }) => {
  const N = useStore('NETWORK') || {};
  const [ip,      setIp]      = React.useState(iface.ip === '—' ? '' : iface.ip);
  const [mode,    setMode]    = React.useState(ip ? 'static' : 'dhcp');
  const [gw,      setGw]      = React.useState(N.gateway || '');
  const [dns,     setDns]     = React.useState((N.dns || []).join(', '));
  const [vlan,    setVlan]    = React.useState(iface.vlan === '—' ? '' : iface.vlan);
  const [mtu,     setMtu]     = React.useState('1500');
  const [enabled, setEnabled] = React.useState(iface.state === 'up');
  const [saving,  setSaving]  = React.useState(false);
  
  const inpCss = {width:'100%',background:'var(--bg-1)',border:'1px solid var(--line)',color:'var(--fg)',padding:'7px 10px',borderRadius:5,fontSize:'var(--fs-sm)',fontFamily:'var(--font-mono)',outline:'none'};
  
  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/network/interfaces/details/${iface.name}`, {
        method: 'POST',
        credentials: 'include',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          action: enabled ? 'up' : 'down',
        }),
      });
      if (mode === 'static' && ip) {
        await fetch(`/network/interfaces/details/${iface.name}`, {
          method: 'POST',
          credentials: 'include',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            action: 'set-ip',
            IP: ip.split('/')[0],
            Prefix: ip.split('/')[1] || '24',
          }),
        });
      }
      onClose();
    } catch(e) {
      console.error('Save error:', e);
    }
    setSaving(false);
  };

  return (
    <Modal title={`Edytuj interfejs · ${iface.name}`} sub={`${iface.speed || '—'} · MAC ${iface.mac}`} onClose={onClose} width={620}
      footer={<>
        <button className="btn sm ghost" onClick={onClose}>Anuluj</button>
        <button className="btn sm primary" onClick={save} disabled={saving}>
          {saving ? 'Zapisywanie…' : 'Zapisz i zastosuj'}
        </button>
      </>}
    >
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
        <div style={{padding:'10px 14px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:6,display:'flex',justifyContent:'space-between',alignItems:'center',gridColumn:'1/-1'}}>
          <div>
            <div style={{fontWeight:500}}>Interfejs aktywny</div>
            <div className="dim" style={{fontSize:11}}>ip link set {iface.name} {enabled?'up':'down'}</div>
          </div>
          <div className={"toggle "+(enabled?'on':'')} onClick={()=>setEnabled(v=>!v)}/>
        </div>
      </div>

      <div style={{marginBottom:14}}>
        <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4,textTransform:'uppercase',letterSpacing:'.06em',fontWeight:500}}>Tryb adresowania</div>
        <div style={{display:'flex',gap:8}}>
          {['dhcp','static'].map(m=>(
            <div key={m} onClick={()=>setMode(m)} style={{flex:1,padding:'8px 14px',border:'1px solid '+(mode===m?'var(--accent)':'var(--line)'),background:mode===m?'color-mix(in oklch,var(--accent) 10%,transparent)':'var(--bg-1)',borderRadius:5,cursor:'pointer',textAlign:'center',fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',fontWeight:mode===m?600:400}}>
              {m === 'dhcp' ? 'DHCP (automatyczny)' : 'Statyczny IP'}
            </div>
          ))}
        </div>
      </div>

      {mode === 'static' && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
          <div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Adres IP / maska</div>
            <input style={inpCss} value={ip} onChange={e=>setIp(e.target.value)} placeholder="192.168.1.10/24"/>
          </div>
          <div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Brama domyślna</div>
            <input style={inpCss} value={gw} onChange={e=>setGw(e.target.value)} placeholder="192.168.1.1"/>
          </div>
          <div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>DNS (oddziel przecinkiem)</div>
            <input style={inpCss} value={dns} onChange={e=>setDns(e.target.value)} placeholder="1.1.1.1, 9.9.9.9"/>
          </div>
          <div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>MTU</div>
            <input style={inpCss} value={mtu} onChange={e=>setMtu(e.target.value)} placeholder="1500"/>
          </div>
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
        <div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>VLAN ID (puste = brak)</div>
          <input style={inpCss} value={vlan} onChange={e=>setVlan(e.target.value)} placeholder="100"/>
        </div>
      </div>

      <div style={{marginBottom:14}}>
        <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4,textTransform:'uppercase',letterSpacing:'.06em',fontWeight:500}}>Polecenia (podgląd)</div>
        <pre className="mono" style={{margin:0,padding:'10px 12px',background:'var(--bg-1)',border:'1px solid var(--line)',borderRadius:5,fontSize:11,color:'var(--fg-muted)',lineHeight:1.7}}>
{mode==='dhcp'
  ? `dhclient ${iface.name}`
  : `ip addr flush dev ${iface.name}\nip addr add ${ip||'<ip/mask>'} dev ${iface.name}\nip route add default via ${gw||'<gw>'}`}
{vlan ? `\nip link add link ${iface.name} name ${iface.name}.${vlan} type vlan id ${vlan}` : ''}
        </pre>
      </div>
    </Modal>
  );
};

// ─── Shared InstallBanner component ────────────────────────────────────────────
const InstallBanner = ({ name, icon='download', desc, packages=[], installEndpoint, onInstalled, docsUrl, docsLabel }) => {
  const [installing, setInstalling] = React.useState(false);
  const [log, setLog] = React.useState([]);
  const [err, setErr] = React.useState('');

  const doInstall = async () => {
    setInstalling(true); setErr('');
    setLog([`apt install ${packages.join(' ')}…`]);
    try {
      const r = await fetch(installEndpoint, {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({packages}),
      });
      if (r.ok) {
        setLog(l=>[...l, '✓ Instalacja zakończona pomyślnie']);
        setTimeout(()=>onInstalled&&onInstalled(), 800);
      } else {
        const t = await r.text().catch(()=>'');
        setErr('Błąd instalacji: ' + (t||r.status));
        setLog(l=>[...l, '✗ '+err]);
      }
    } catch(e) {
      setErr('Błąd: ' + e.message);
    } finally { setInstalling(false); }
  };

  return (
    <div className="card" style={{padding:40,textAlign:'center'}}>
      <Icon name={icon} size={48} style={{opacity:.2,display:'block',margin:'0 auto 20px'}}/>
      <div style={{fontWeight:700,fontSize:'var(--fs-lg)',marginBottom:10}}>{name} nie jest zainstalowany</div>
      <div style={{color:'var(--fg-muted)',fontSize:'var(--fs-sm)',maxWidth:560,margin:'0 auto 24px',lineHeight:1.7}}>{desc}</div>
      <div style={{display:'flex',gap:10,flexWrap:'wrap',justifyContent:'center',marginBottom:20}}>
        {packages.map(p=>(<span key={p} className="chip mono" style={{fontSize:13,padding:'4px 12px'}}>{p}</span>))}
      </div>
      {log.length > 0 && (
        <div style={{background:'var(--bg)',borderRadius:7,padding:'10px 14px',fontFamily:'var(--font-mono)',
          fontSize:'var(--fs-xs)',lineHeight:1.7,maxHeight:120,overflowY:'auto',
          border:'1px solid var(--line)',textAlign:'left',maxWidth:480,margin:'0 auto 16px'}}>
          {log.map((l,i)=><div key={i} style={{color:l.startsWith('✓')?'var(--ok)':l.startsWith('✗')?'var(--err)':'var(--fg-muted)'}}>{l}</div>)}
        </div>
      )}
      {err && <div style={{color:'var(--err)',fontSize:'var(--fs-sm)',marginBottom:12}}>{err}</div>}
      <div className="row gap-sm" style={{justifyContent:'center'}}>
        <button className="btn primary" onClick={doInstall} disabled={installing} style={{padding:'9px 24px',fontSize:'var(--fs-base)'}}>
          <Icon name="download" size={14}/>
          {installing ? 'Instalowanie…' : `Zainstaluj ${name}`}
        </button>
        {docsUrl && (
          <a href={docsUrl} target="_blank" rel="noopener noreferrer" className="btn" style={{padding:'9px 16px'}}>
            Dokumentacja ↗
          </a>
        )}
      </div>
      <div style={{marginTop:12,fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>
        Wymaga uprawnień root · instalacja przez apt
      </div>
    </div>
  );
};


const FirewallInstallCheck = () => {
  const [installed, setInstalled] = React.useState(true); // assume installed; check async
  React.useEffect(()=>{
    fetch('/api/network', {credentials:'include'})
      .then(r=>r.ok?r.json():null)
      .then(d=>{ if(d?.ufw_installed===false) setInstalled(false); })
      .catch(()=>{});
  },[]);
  if (installed) return null;
  return <InstallBanner name="UFW Firewall" icon="shield"
    desc="UFW (Uncomplicated Firewall) to prosty interfejs do zarządzania regułami iptables. Pozwala łatwo kontrolować połączenia przychodzące i wychodzące."
    packages={['ufw']}
    installEndpoint="/api/network/install-ufw"
    onInstalled={()=>setInstalled(true)}
    docsUrl="https://help.ubuntu.com/community/UFW"
    docsLabel="Ubuntu UFW"/>;
};

const ReverseProxyInstallCheck = () => {
  const [installed, setInstalled] = React.useState(true);
  React.useEffect(()=>{
    fetch('/api/network', {credentials:'include'})
      .then(r=>r.ok?r.json():null)
      .then(d=>{ if(d?.nginx_installed===false) setInstalled(false); })
      .catch(()=>{});
  },[]);
  if (installed) return null;
  return <InstallBanner name="Nginx Reverse Proxy" icon="globe"
    desc="Nginx jako reverse proxy pozwala przekierowywać żądania HTTP/HTTPS do lokalnych usług. Obsługuje SSL/TLS, load balancing i cache."
    packages={['nginx', 'certbot', 'python3-certbot-nginx']}
    installEndpoint="/api/network/install-nginx"
    onInstalled={()=>setInstalled(true)}
    docsUrl="https://nginx.org/en/docs/"
    docsLabel="nginx.org"/>;
};


// ── WireGuard ─────────────────────────────────────────────────────────────────
const NetworkWireGuard = () => {
  const [peers, setPeers] = React.useState(WG_PEERS_PLACEHOLDER);
  const [showAdd, setShowAdd] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [wgRunning, setWgRunning] = React.useState(false);
  const [wgInstalled, setWgInstalled] = React.useState(null); // null=loading, true/false

  React.useEffect(() => {
    // Sprawdź czy WireGuard jest zainstalowany przez dedykowany endpoint
    fetch('/api/vpn/wireguard', {credentials:'include'})
      .then(r => {
        if (!r.ok) { setWgInstalled(false); return null; }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        // Jeśli wg show zwraca cokolwiek lub są pliki konfiguracyjne — zainstalowany
        const hasConf = data.configs && data.configs.some(c => c && c.trim() !== '');
        const hasStatus = data.status && data.status.trim() !== '';
        setWgInstalled(hasConf || hasStatus || true); // installed if endpoint works
        setWgRunning(hasStatus); // running if wg show returned output
        // Load real peers from wg show
        if (data.status) {
          const peerLines = data.status.split('\n').filter(l => l.startsWith('peer:'));
          if (peerLines.length > 0) {
            const realPeers = peerLines.map((l, i) => ({
              name: 'Peer '+(i+1),
              pubkey: l.replace('peer:', '').trim().slice(0,20)+'…',
              ip: '10.8.0.'+(i+2)+'/32',
              endpoint: 'dynamic',
              last: '—', rx: '0 B', tx: '0 B', on: true,
            }));
            setPeers(realPeers);
          }
        }
      })
      .catch(() => {
        // Endpoint 404/error → WireGuard nie zainstalowany
        setWgInstalled(false);
      });

    // Sprawdź też przez interfejsy
    fetch('/api/network', {credentials:'include'})
      .then(r=>r.ok?r.json():null)
      .then(data=>{
        if (!data) return;
        const ifaces = data.interfaces||[];
        const wg = ifaces.find(i=>(i.Name||i.name||'').startsWith('wg'));
        if (wg) { setWgRunning(wg.State==='up'||wg.state==='up'); }
      }).catch(()=>{});
  }, []);

  const inpSt = {background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:5,
    padding:'5px 10px',color:'var(--fg)',fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',outline:'none',width:'100%'};

  if (wgInstalled === false) return (
    <InstallBanner
      name="WireGuard VPN" icon="shield"
      desc="WireGuard to nowoczesny, wydajny tunel VPN. Po instalacji możesz zarządzać peerami i połączeniami."
      packages={['wireguard', 'wireguard-tools']}
      installEndpoint="/api/vpn/install"
      onInstalled={()=>setWgInstalled(true)}
      docsUrl="https://www.wireguard.com/install/"
      docsLabel="wireguard.com"
    />
  );

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="grid grid-4">
        <div className="kpi">
          <div className="kpi-label">STATUS</div>
          <div className="kpi-value" style={{fontSize:20,color:wgRunning?'var(--ok)':'var(--fg-dim)'}}>{wgRunning?'ONLINE':'STOPPED'}</div>
          <div className="kpi-foot"><span>wg0 · port 51820/UDP</span></div>
        </div>
        <div className="kpi"><div className="kpi-label">PEERS</div><div className="kpi-value">{peers.length}</div><div className="kpi-foot"><span>{peers.filter(p=>p.on).length} aktywnych</span></div></div>
        <div className="kpi"><div className="kpi-label">TRANSFER ↓</div><div className="kpi-value" style={{fontSize:18,color:'var(--accent)'}}>—</div><div className="kpi-foot"><span>łącznie</span></div></div>
        <div className="kpi"><div className="kpi-label">TRANSFER ↑</div><div className="kpi-value" style={{fontSize:18}}>—</div><div className="kpi-foot"><span>łącznie</span></div></div>
      </div>
      <div className="card">
        <div className="card-head">
          <div><div className="card-title">Peery</div><div className="card-sub">{peers.length} skonfigurowanych</div></div>
          <div className="card-actions">
            <button className="btn sm primary" onClick={()=>setShowAdd(s=>!s)}><Icon name="plus" size={12}/> Dodaj peera</button>
          </div>
        </div>
        {showAdd && (
          <div style={{padding:'12px var(--pad-card)',borderBottom:'1px solid var(--line)',background:'var(--bg-2)',display:'grid',gridTemplateColumns:'1fr 1fr auto',gap:10,alignItems:'end'}}>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Nazwa</div>
              <input style={inpSt} value={newName} onChange={e=>setNewName(e.target.value)} placeholder="laptop-nowy"/>
            </div>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Adres IP peera</div>
              <input style={inpSt} defaultValue={`10.8.0.${peers.length+2}/32`}/>
            </div>
            <div className="row gap-sm">
              <button className="btn sm primary" onClick={()=>{if(newName){setPeers(ps=>[...ps,{name:newName,pubkey:'(generowany)',ip:`10.8.0.${ps.length+2}/32`,endpoint:'dynamic',last:'nigdy',rx:'0',tx:'0',on:true}]);setShowAdd(false);setNewName('');}}}>Generuj klucze</button>
              <button className="btn sm" onClick={()=>setShowAdd(false)}>✕</button>
            </div>
          </div>
        )}
        <table className="table">
          <thead><tr><th>Nazwa</th><th>Klucz publiczny</th><th>Adres IP</th><th>Endpoint</th><th>Ostatni handshake</th><th>↓ / ↑</th><th>Aktywny</th><th></th></tr></thead>
          <tbody>
            {peers.map((p,i)=>(
              <tr key={i}>
                <td style={{fontWeight:500}}>{p.name}</td>
                <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{p.pubkey}</td>
                <td className="mono">{p.ip}</td>
                <td className="mono dim">{p.endpoint}</td>
                <td className="mono dim">{p.last}</td>
                <td className="mono">{p.rx} / {p.tx}</td>
                <td><div className={'toggle '+(p.on?'on':'')} onClick={()=>setPeers(ps=>ps.map((x,j)=>j===i?{...x,on:!x.on}:x))}/></td>
                <td><button className="icon-btn" onClick={()=>setPeers(ps=>ps.filter((_,j)=>j!==i))}><Icon name="trash" size={13}/></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── DHCP ──────────────────────────────────────────────────────────────────────

const NetworkDhcp = () => {
  const [dhcpInstalled, setDhcpInstalled] = React.useState(null);
  const [dhcpRunning,   setDhcpRunning]   = React.useState(false);
  const [leases,        setLeases]        = React.useState([]);
  const [range1,        setRange1]        = React.useState('192.168.1.100');
  const [range2,        setRange2]        = React.useState('192.168.1.200');
  const [leaseTime,     setLeaseTime]     = React.useState('24h');
  const [saving,        setSaving]        = React.useState(false);
  const [installing,    setInstalling]    = React.useState(false);
  const inpSt = {background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:5,
    padding:'5px 10px',color:'var(--fg)',fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',outline:'none'};

  const load = async () => {
    try {
      const r = await fetch('/api/network/dhcp/leases', {credentials:'include'});
      if (!r.ok) { setDhcpInstalled(false); return; }
      const d = await r.json();
      setDhcpInstalled(d.installed !== false);
      setDhcpRunning(d.running || false);
      setLeases(d.leases || []);
    } catch { setDhcpInstalled(false); }
  };

  React.useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, []);

  const saveConfig = async () => {
    setSaving(true);
    try {
      await fetch('/api/network/dhcp/config', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({range_start: range1, range_end: range2, lease_time: leaseTime}),
      });
      load();
    } finally { setSaving(false); }
  };

  const install = async () => {
    setInstalling(true);
    try {
      await fetch('/api/network/dhcp/install', {method:'POST', credentials:'include'});
      setTimeout(load, 2000);
    } finally { setInstalling(false); }
  };

  if (dhcpInstalled === false) return (
    <InstallBanner name="dnsmasq (DHCP)" icon="network"
      desc="dnsmasq to lekki serwer DHCP i DNS dla sieci lokalnej. Zarządza przydzielaniem adresów IP i rozwiązywaniem nazw hostów."
      packages={['dnsmasq']}
      installEndpoint="/api/network/dhcp/install"
      onInstalled={()=>setDhcpInstalled(true)}
      docsUrl="https://thekelleys.org.uk/dnsmasq/doc.html"
      docsLabel="dnsmasq docs"
    />
  );

  const total = parseInt(range2.split('.').pop()) - parseInt(range1.split('.').pop()) + 1;
  const pct = leases.length ? Math.round(leases.length/total*100) : 0;

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><div className="card-title">Konfiguracja serwera DHCP</div><div className="card-sub">dnsmasq</div></div>
          <div className="card-body col" style={{gap:12}}>
            <div className="grid" style={{gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div><div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Zakres od</div><input style={{...inpSt,width:'100%'}} value={range1} onChange={e=>setRange1(e.target.value)}/></div>
              <div><div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Zakres do</div><input style={{...inpSt,width:'100%'}} value={range2} onChange={e=>setRange2(e.target.value)}/></div>
            </div>
            <div><div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Czas dzierżawy</div><input style={{...inpSt,width:120}} value={leaseTime} onChange={e=>setLeaseTime(e.target.value)}/></div>
            <button className="btn primary" onClick={saveConfig} disabled={saving} style={{marginTop:4}}>
              {saving ? 'Zapisywanie…' : <><Icon name="upload" size={11}/> Zastosuj konfigurację DHCP</>}
            </button>
            <hr className="div"/>
            <KV k="Aktywne dzierżawy" v={<span className="mono">{leases.length}</span>}/>
            <KV k="dnsmasq" v={<span className={'badge '+(dhcpRunning?'ok':'')}>{dhcpRunning?'RUNNING':'STOPPED'}</span>}/>
            <KV k="Statyczne rezerwacje" v={<span className="mono">{leases.filter(l=>l.static).length}</span>}/>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title">Statystyki DHCP</div></div>
          <div className="card-body col" style={{gap:10}}>
            <div>
              <div className="row" style={{justifyContent:'space-between',marginBottom:4,fontSize:'var(--fs-xs)'}}>
                <span className="dim">Pula adresów</span><span className="mono">{leases.length} / {total}</span>
              </div>
              <div className="bar"><i style={{width:pct+'%'}}/></div>
            </div>
            <hr className="div"/>
            <div style={{background:'var(--bg-2)',borderRadius:6,padding:'10px 12px',fontFamily:'var(--font-mono)',fontSize:'var(--fs-xs)',color:'var(--fg-muted)',lineHeight:1.8}}>
              <div># dnsmasq.conf</div>
              <div>dhcp-range=<span style={{color:'var(--fg)'}}>{range1},{range2},{leaseTime}</span></div>
              <div>dhcp-option=3,<span style={{color:'var(--fg)'}}>192.168.1.1</span></div>
            </div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <div><div className="card-title">Dzierżawy DHCP</div><div className="card-sub">{leases.length} aktywnych</div></div>
          <div className="card-actions"><button className="btn sm primary"><Icon name="plus" size={12}/> Rezerwacja statyczna</button></div>
        </div>
        {leases.length === 0
          ? <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>Brak danych dzierżaw — sprawdź /api/network</div>
          : <table className="table">
              <thead><tr><th>MAC</th><th>Adres IP</th><th>Hostname</th><th>Vendor</th><th>Wygasa</th><th>Typ</th><th></th></tr></thead>
              <tbody>
                {leases.map((l,i)=>(
                  <tr key={i}>
                    <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{l.mac}</td>
                    <td className="mono" style={{fontWeight:500}}>{l.ip}</td>
                    <td className="mono">{l.hostname}</td>
                    <td className="dim" style={{fontSize:'var(--fs-xs)'}}>{l.vendor}</td>
                    <td className="mono dim">{l.expires}</td>
                    <td>{l.static?<span className="badge accent">statyczny</span>:<span className="badge">dynamiczny</span>}</td>
                    <td><button className="icon-btn"><Icon name="edit" size={13}/></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
        }
      </div>
    </div>
  );
};

// ── DNS ───────────────────────────────────────────────────────────────────────
const NetworkDns = ({ N }) => {
  const [upstream, setUpstream] = React.useState((N?.dns||[]).length ? N.dns : ['1.1.1.1','9.9.9.9']);
  const [hosts,    setHosts]    = React.useState([]);
  const [newIp,    setNewIp]    = React.useState('');
  const [newName,  setNewName]  = React.useState('');
  const [cache,    setCache]    = React.useState(true);
  const [dnssec,   setDnssec]   = React.useState(false);
  const [saving,   setSaving]   = React.useState(false);
  const [savingHost, setSavingHost] = React.useState(false);
  const inpSt = {background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:5,
    padding:'5px 10px',color:'var(--fg)',fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',outline:'none',width:'100%'};

  const load = async () => {
    try {
      const r = await fetch('/api/network/dns/status', {credentials:'include'});
      if (!r.ok) return;
      const d = await r.json();
      if (d.upstream?.length) setUpstream(d.upstream);
      if (d.hosts?.length)    setHosts(d.hosts);
    } catch {}
  };

  React.useEffect(() => {
    load();
    if (N?.dns && N.dns.length) setUpstream(N.dns);
  }, [N]);

  const saveUpstream = async () => {
    setSaving(true);
    try {
      await fetch('/api/network/dns/upstream', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({servers: upstream.filter(u=>u.trim())}),
      });
    } finally { setSaving(false); }
  };

  const addHost = async () => {
    if (!newIp || !newName) return;
    setSavingHost(true);
    try {
      await fetch('/api/network/dns/hosts', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ip: newIp, name: newName}),
      });
      setHosts(h=>[...h, {ip:newIp, name:newName}]);
      setNewIp(''); setNewName('');
    } finally { setSavingHost(false); }
  };

  const removeHost = async (name) => {
    await fetch('/api/network/dns/hosts', {
      method:'DELETE', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({name}),
    });
    setHosts(h=>h.filter(x=>x.name!==name));
  };

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><div className="card-title">Konfiguracja DNS</div><div className="card-sub">dnsmasq / systemd-resolved</div></div>
          <div className="card-body col" style={{gap:12}}>
            <div className="row" style={{justifyContent:'space-between'}}>
              <div><div style={{fontWeight:500}}>Cache DNS</div><div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>Buforowanie odpowiedzi lokalnie</div></div>
              <div className={'toggle '+(cache?'on':'')} onClick={()=>setCache(v=>!v)}/>
            </div>
            <div className="row" style={{justifyContent:'space-between'}}>
              <div><div style={{fontWeight:500}}>DNSSEC</div><div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>Walidacja podpisów DNS</div></div>
              <div className={'toggle '+(dnssec?'on':'')} onClick={()=>setDnssec(v=>!v)}/>
            </div>
            <hr className="div"/>
            <div style={{fontWeight:500,fontSize:'var(--fs-sm)',marginBottom:2}}>Serwery upstream</div>
            {upstream.map((u,i)=>(
              <div key={i} className="row gap-sm">
                <input style={inpSt} value={u} onChange={e=>setUpstream(us=>us.map((x,j)=>j===i?e.target.value:x))}/>
                <button className="icon-btn" onClick={()=>setUpstream(us=>us.filter((_,j)=>j!==i))}><Icon name="trash" size={13}/></button>
              </div>
            ))}
            <button className="btn sm" onClick={()=>setUpstream(us=>[...us,''])}><Icon name="plus" size={11}/> Dodaj serwer</button>
            <button className="btn sm primary" onClick={saveUpstream} disabled={saving} style={{marginTop:4}}>
              {saving ? 'Zapisywanie…' : <><Icon name="upload" size={11}/> Zastosuj serwery DNS</>}
            </button>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Lokalne wpisy DNS</div><div className="card-sub">/etc/hosts</div></div>
            <div className="card-actions">
              <input style={{...inpSt,width:110}} placeholder="192.168.1.x" value={newIp} onChange={e=>setNewIp(e.target.value)}/>
              <input style={{...inpSt,width:140}} placeholder="host.lan"    value={newName} onChange={e=>setNewName(e.target.value)}/>
              <button className="btn sm primary" onClick={addHost} disabled={savingHost}>
                <Icon name="plus" size={11}/> {savingHost?'…':'Dodaj'}
              </button>
            </div>
          </div>
          {hosts.length === 0
            ? <div style={{padding:24,textAlign:'center',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>Brak lokalnych wpisów DNS</div>
            : <table className="table">
                <thead><tr><th>Adres IP</th><th>Nazwa hosta</th><th></th></tr></thead>
                <tbody>
                  {hosts.map((h,i)=>(
                    <tr key={i}>
                      <td className="mono">{h.ip}</td>
                      <td className="mono">{h.name}</td>
                      <td><button className="icon-btn" onClick={()=>removeHost(h.name)}><Icon name="trash" size={13}/></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
          }
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// FILE SERVICES (SMB / NFS / FTP / SSH)
// ═══════════════════════════════════════════════════════════════════════════

const FileServices = () => {
  const SERVICES = useStore('SERVICES');
  const SHARES   = useStore('SHARES');
  const [services, setServices] = React.useState(SERVICES || []);
  const [shares,   setShares]   = React.useState(SHARES   || []);
  const [loadingId, setLoadingId] = React.useState(null);
  const [errorId, setErrorId] = React.useState(null);
  const [errorMsg, setErrorMsg] = React.useState('');

  // Synchronizuj ze store gdy dane z API przyjdą
  React.useEffect(() => { if (SERVICES?.length) setServices(SERVICES); }, [SERVICES]);

  // Własny polling statusu usług co 8s — nie czeka na globalny sync
  React.useEffect(() => {
    const SVC_ENDPOINTS = {
      smb:   '/services/samba/status',
      ssh:   '/services/ssh/status',
      nfs:   '/api/nfs-server/status',
      ftp:   '/api/services/ftp-sftp/status',
    };
    const fetchStatuses = async () => {
      const results = await Promise.all(
        Object.entries(SVC_ENDPOINTS).map(async ([id, url]) => {
          try {
            const r = await fetch(url, {credentials:'include'});
            if (!r.ok) return null;
            const d = await r.json();
            return {id, active: d.active || false};
          } catch { return null; }
        })
      );
      setServices(prev => {
        const updated = prev.map(s => {
          const result = results.find(r => r?.id === s.id);
          if (!result) return s;
          return {...s, status: result.active ? 'running' : 'stopped'};
        });
        storeSet('SERVICES', updated);
        return updated;
      });
      // Po odświeżeniu wyczyść loading jeśli serwis już osiągnął docelowy stan
      if (loadingId) {
        const targetSvc = services.find(s => s.id === loadingId);
        const currentStatus = results.find(r => r?.id === loadingId)?.active ? 'running' : 'stopped';
        if (targetSvc && currentStatus === targetSvc.status) {
          setLoadingId(null);
          setErrorId(null);
        }
      }
    };
    fetchStatuses();
    const id = setInterval(fetchStatuses, 8000);
    return () => clearInterval(id);
  }, [loadingId, services]);

  const toggleSvc = async (id) => {
    const svc    = services.find(s=>s.id===id);
    const enable = svc?.status !== 'running';
    
    // Ustaw loading dla tego serwisu
    setLoadingId(id);
    setErrorId(null);
    setErrorMsg('');
    
    const ep = {
      smb:   '/services/samba/toggle',
      nfs:   '/api/nfs-server/toggle',
      ftp:   '/api/services/ftp-sftp/toggle',
      ssh:   '/services/ssh/toggle',
      afp:   null,
      rsync: null,
    };
    
    let timeoutId = null;
    
    try {
      if (ep[id]) {
        // Ustaw timeout 15 sekund
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Timeout: usługa nie odpowiada')), 15000);
        });
        
        const fetchPromise = fetch(ep[id], {
          method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({enable})
        });
        
        const response = await Promise.race([fetchPromise, timeoutPromise]);
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
      }
      
      // Optymistyczna aktualizacja stanu
      const updated = services.map(s=>s.id===id ? {...s, status: enable ? 'running' : 'stopped'} : s);
      setServices(updated);
      storeSet('SERVICES', updated);
      
    } catch (err) {
      clearTimeout(timeoutId);
      setErrorId(id);
      setErrorMsg(err.message);
      // Po błędzie przywróć poprzedni stan za chwilę
      setTimeout(async () => {
        try {
          const statusEp = ep[id]?.replace('/toggle', '/status') || `/services/${id}/status`;
          const r = await fetch(statusEp, {credentials:'include'});
          if (r.ok) {
            const d = await r.json();
            const realStatus = d.active ? 'running' : 'stopped';
            const restored = services.map(s => s.id === id ? {...s, status: realStatus} : s);
            setServices(restored);
            storeSet('SERVICES', restored);
          }
        } catch(e) {}
        setLoadingId(null);
      }, 1000);
      return;
    }
    
    // Po 3 sekundach wyczyść loading
    setTimeout(() => {
      setLoadingId(null);
    }, 3000);
  };

  // Mapowanie serwisów do stron konfiguracji
  const configUrls = {
    smb:   'samba',
    nfs:   'nfs',
    ftp:   'ftp_svc',
    ssh:   'ssh_svc',
    afp:   '/shares/afp',
    rsync: '/backup/rsync',
  };

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      {/* Protokoły */}
      <div className="card">
        <div className="card-head">
          <div><div className="card-title">Protokoły plików</div><div className="card-sub">Włącz lub wyłącz usługi udostępniania</div></div>
        </div>
        <div className="card-body grid" style={{gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
          {services.map(s => {
            const isLoading = loadingId === s.id;
            const hasError = errorId === s.id;
            const isRunning = s.status === 'running';
            
            return (
              <div key={s.id} style={{
                padding:14,
                background: hasError ? 'color-mix(in oklch, var(--err) 8%, var(--bg-2))' : 'var(--bg-2)',
                border: `1px solid ${hasError ? 'var(--err)' : 'var(--line)'}`,
                borderRadius:8,
                position: 'relative',
                overflow: 'hidden',
              }}>
                {/* Pasek postępu podczas ładowania */}
                {isLoading && (
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    background: 'var(--accent)',
                    animation: 'loadingProgress 2s ease-in-out infinite',
                  }}>
                    <div style={{
                      position: 'absolute',
                      left: '-50%',
                      width: '50%',
                      height: '100%',
                      background: 'var(--accent)',
                      opacity: 0.5,
                      animation: 'loadingShimmer 1.2s linear infinite',
                    }}/>
                  </div>
                )}
                
                <div className="row" style={{justifyContent:'space-between'}}>
                  <div className="row gap-sm">
                    <div className="cont-icon" style={{width:32,height:32,fontSize:11}}>{s.id.toUpperCase().slice(0,3)}</div>
                    <div>
                      <div style={{fontWeight:600}}>{s.name}</div>
                      <div className="mono dim" style={{fontSize:'var(--fs-xs)'}}>port {s.port}</div>
                    </div>
                  </div>
                  <div style={{position:'relative'}}>
                    {isLoading ? (
                      <div style={{
                        width: 48,
                        height: 24,
                        borderRadius: 24,
                        background: 'var(--bg-3)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        <div className="spinner" style={{
                          width: 14,
                          height: 14,
                          border: '2px solid var(--fg-dim)',
                          borderTopColor: 'var(--accent)',
                          borderRadius: '50%',
                          animation: 'spin 0.8s linear infinite',
                        }}/>
                      </div>
                    ) : (
                      <div className={'toggle' + (isRunning ? ' on' : '')} onClick={() => toggleSvc(s.id)}/>
                    )}
                  </div>
                </div>
                
                <div className="dim" style={{fontSize:'var(--fs-xs)',marginTop:8}}>{s.desc}</div>
                
                {hasError && (
                  <div style={{
                    marginTop: 8,
                    fontSize: 10,
                    color: 'var(--err)',
                    background: 'color-mix(in oklch, var(--err) 10%, transparent)',
                    padding: '4px 8px',
                    borderRadius: 4,
                  }}>
                    ⚠️ Błąd: {errorMsg}
                  </div>
                )}
                
                <div className="row" style={{marginTop:10,justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <span className={`badge ${isRunning ? 'ok' : hasError ? 'err' : ''}`}>
                      <span className={`dot${isRunning ? ' pulse' : ''}`}/>
                      {isLoading ? 'ZMIANA…' : (isRunning ? 'RUNNING' : (hasError ? 'BŁĄD' : 'STOPPED'))}
                    </span>
                    {isLoading && (
                      <span className="dim" style={{fontSize:10}}>proszę czekać…</span>
                    )}
                  </div>
                  <button 
                    className="btn ghost sm" 
                    onClick={() => {
                      const url = configUrls[s.id];
                      if (url && window.navigateTo) {
                        window.navigateTo(url);
                      } else if (url) {
                        window.location.hash = url;
                      } else {
                        alert(`Strona konfiguracji dla ${s.name} będzie dostępna wkrótce`);
                      }
                    }}
                    disabled={isLoading}
                  >
                    Konfiguruj →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ── SSH keys helper ──────────────────────────────────────────────────────────
const SshKeyList = () => {
  const [keys, setKeys] = React.useState([]);
  
  React.useEffect(() => {
    fetch('/services/ssh/keys', {credentials:'include'})
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.keys && Array.isArray(data.keys)) {
          setKeys(data.keys);
        }
      }).catch(() => {});
  }, []);
  
  if (keys.length === 0) return (
    <div className="dim" style={{fontSize:'var(--fs-sm)'}}>
      Zarządzaj kluczami przez: <span className="chip">~/.ssh/authorized_keys</span>
      <br/><span style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',display:'block',marginTop:4}}>lub użyj terminala → <code>ssh-keygen -t ed25519</code></span>
    </div>
  );
  
  return (
    <div>
      {keys.map((k, i) => (
        <div key={i} className="row" style={{padding:'10px 12px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:6,gap:12,marginBottom:6}}>
          <Icon name="key" size={16}/>
          <div style={{flex:1}}>
            <div style={{fontWeight:500}}>{k.user || '—'} <span className="chip">{k.type || 'ssh'}</span></div>
            <div className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{k.fingerprint || '—'}</div>
          </div>
          <button className="icon-btn" onClick={() => {
            fetch('/services/ssh/keys/delete', {
              method: 'DELETE',
              credentials: 'include',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({user: k.user, key_prefix: (k.raw || k.fingerprint || '').substring(0, 20)}),
            }).then(() => setKeys(prev => prev.filter((_, j) => j !== i)));
          }}><Icon name="trash"/></button>
        </div>
      ))}
    </div>
  );
};

// ── SSH sessions helper ──────────────────────────────────────────────────────
const SshSessions = () => {
  const [conns, setConns] = React.useState([]);
  
  React.useEffect(() => {
    fetch('/services/ssh/connections', {credentials:'include'})
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.connections && Array.isArray(data.connections)) {
          setConns(data.connections);
        }
      }).catch(() => {});
  }, []);
  
  if (conns.length === 0) return (
    <div className="card-body dim" style={{fontSize:'var(--fs-sm)'}}>
      Brak aktywnych sesji SSH
    </div>
  );
  
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Użytkownik</th>
          <th>Adres</th>
          <th>Czas</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {conns.map((c, i) => (
          <tr key={i}>
            <td style={{fontWeight:500}}>{c.user || '—'}</td>
            <td className="mono">{c.ip || '—'}</td>
            <td className="mono dim">{c.since || '—'}</td>
            <td>
              <button className="btn sm danger" onClick={() => {
                if (c.pid) {
                  fetch('/api/storage/exec-command', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({command: `kill ${c.pid}`}),
                  });
                }
              }}>Kill</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

// ── NFS exports helper ───────────────────────────────────────────────────────
const NfsExports = () => {
  const [exports, setExports] = React.useState([]);
  React.useEffect(() => {
    fetch('/api/nfs-server/exports', {credentials:'include'})
      .then(r=>r.ok?r.json():null)
      .then(data=>{
        if (!data) return;
        const list = data.exports||data||[];
        setExports(Array.isArray(list)?list:[]);
      }).catch(()=>{});
  }, []);
  if (exports.length === 0) return (
    <div className="card-body dim" style={{fontSize:'var(--fs-sm)'}}>
      Brak eksportów NFS · dodaj przez przycisk wyżej lub edytuj <span className="chip">/etc/exports</span>
    </div>
  );
  return (
    <table className="table">
      <thead><tr><th>Ścieżka</th><th>Klienci</th><th>Opcje</th><th></th></tr></thead>
      <tbody>
        {exports.map((e,i)=>(
          <tr key={i}>
            <td className="mono">{e.path||e.Path||'—'}</td>
            <td className="mono dim">{e.clients||e.Clients||'*'}</td>
            <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{e.options||e.Options||'rw'}</td>
            <td><button className="icon-btn"><Icon name="trash" size={13}/></button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// MEDIA
// ═══════════════════════════════════════════════════════════════════════════


const DEFAULT_MEDIA_SERVERS = [];

const Media = () => {
  const [servers, setServers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [editingServer, setEditingServer] = React.useState(null);
  const [showAddDialog, setShowAddDialog] = React.useState(false);
  const [newServer, setNewServer] = React.useState({ id: '', name: '', port: '', api_key: '', url: '' });
  const [refreshing, setRefreshing] = React.useState(false);
  const [allStreams, setAllStreams] = React.useState([]);
  const [totalBandwidth, setTotalBandwidth] = React.useState(0);
  const Field = ({ label, hint, children }) => (
  <div className="col" style={{gap:5,marginBottom:14}}>
    <label style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',letterSpacing:'.04em',textTransform:'uppercase',fontWeight:500}}>{label}</label>
    {children}
    {hint && <div className="dim" style={{fontSize:11}}>{hint}</div>}
  </div>
);


  // Załaduj konfigurację z API
  const loadMediaConfig = async () => {
    try {
      const res = await fetch('/api/media/config', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setServers(data.servers || DEFAULT_MEDIA_SERVERS);
      } else {
        setServers(DEFAULT_MEDIA_SERVERS);
      }
    } catch (e) {
      setServers(DEFAULT_MEDIA_SERVERS);
    } finally {
      setLoading(false);
    }
  };

  // Zapisz konfigurację do API
  const saveMediaConfig = async (newServers) => {
    try {
      await fetch('/api/media/config', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers: newServers })
      });
    } catch (e) {
      console.error('Save error:', e);
    }
  };

  React.useEffect(() => {
    loadMediaConfig();
  }, []);

  // Pobierz wszystkie strumienie z wszystkich serwerów
const fetchAllStreams = async () => {
  const allStreamsData = [];
  let totalBitrate = 0;
  
  for (const server of servers) {
    if (!server.api_key || !server.enabled) continue;
    
    try {
      let url = '';
      if (server.id === 'jellyfin') {
        url = `${server.url}/Sessions?api_key=${server.api_key}`;
      } else if (server.id === 'plex') {
        url = `${server.url}/status/sessions?X-Plex-Token=${server.api_key}`;
      } else if (server.id === 'emby') {
        url = `${server.url}/emby/Sessions?api_key=${server.api_key}`;
      } else {
        continue;
      }
      
      const res = await fetch(url);
      if (!res.ok) continue;
      
      const data = await res.json();
      

if (server.id === 'jellyfin' && Array.isArray(data)) {
  for (const s of data) {
    if (s.NowPlayingItem) {
      const item = s.NowPlayingItem;
      
      // MediaStreams jest BEZPOŚREDNIO w NowPlayingItem, nie w MediaSources!
      const mediaStreams = item.MediaStreams;
      
      let bitrate = 0;
      let quality = '—';
      let displayTitle = '—';
      
      if (mediaStreams && Array.isArray(mediaStreams)) {
        const videoStream = mediaStreams.find(m => m.Type === 'Video');
        if (videoStream) {
          // Bitrate ze strumienia wideo
          bitrate = videoStream.BitRate || 0;
          
          // DisplayTitle np. "404p MPEG4 SDR"
          if (videoStream.DisplayTitle) {
            displayTitle = videoStream.DisplayTitle;
            quality = displayTitle;
          }
          // Jeśli nie ma DisplayTitle, zbuduj z Height i Codec
          else if (videoStream.Height) {
            const height = videoStream.Height;
            const codec = videoStream.Codec ? videoStream.Codec.toUpperCase() : '';
            
            if (height >= 2160) quality = '4K';
            else if (height >= 1440) quality = '1440p';
            else if (height >= 1080) quality = '1080p';
            else if (height >= 720) quality = '720p';
            else quality = `${height}p`;
            
            if (codec) quality = `${quality} ${codec}`;
          }
        }
      }
      
      // Jeśli nadal brak bitrate, spróbuj z TranscodingInfo
      if (bitrate === 0 && s.TranscodingInfo) {
        bitrate = s.TranscodingInfo.Bitrate || 0;
      }
      
      totalBitrate += bitrate;
      
      allStreamsData.push({
        server: server.name,
        serverId: server.id,
        sessionId: s.Id,
        user: s.UserName || '—',
        userInitial: (s.UserName || '?').charAt(0).toUpperCase(),
        title: item.Name || '—',
        year: item.ProductionYear || '',
        device: s.DeviceName || '—',
        quality: quality,
        bitrate: bitrate,
        bitrateText: bitrate > 0 ? `${(bitrate / 1000).toFixed(1)} Mb/s` : '—',
        transcode: s.TranscodingInfo?.IsTranscoding || false,
        progress: s.PlayState?.PositionTicks ? (s.PlayState.PositionTicks / item.RunTimeTicks * 100) : 0,
        progressCurrent: s.PlayState?.PositionTicks || 0,
        progressTotal: item?.RunTimeTicks || 0,
        progressText: formatProgress(s.PlayState?.PositionTicks, item?.RunTimeTicks)
      });
    }
  }
} else if (server.id === 'plex' && data.MediaContainer?.Metadata) {
        for (const s of data.MediaContainer.Metadata) {
          const media = s.Media?.[0];
          let bitrate = media?.bitrate ? media.bitrate * 1000 : 0;
          totalBitrate += bitrate;
          
          let quality = media?.videoResolution || 'SD';
          if (media?.width && media?.height) {
            if (media.width >= 3840) quality = '4K';
            else if (media.width >= 2560) quality = '1440p';
            else if (media.width >= 1920) quality = '1080p';
            else if (media.width >= 1280) quality = '720p';
            else quality = `${media.height}p`;
          }
          
          allStreamsData.push({
            server: server.name,
            serverId: server.id,
            sessionId: s.sessionKey,
            user: s.User?.title || '—',
            userInitial: (s.User?.title || '?').charAt(0).toUpperCase(),
            title: s.title || '—',
            year: s.year || '',
            device: s.Player?.title || '—',
            quality: quality,
            bitrate: bitrate,
            bitrateText: bitrate > 0 ? `${Math.round(bitrate / 1000000)} Mb/s` : '—',
            transcode: s.TranscodeSession !== undefined,
            progress: (s.viewOffset || 0) / (s.duration || 1) * 100,
            progressCurrent: s.viewOffset || 0,
            progressTotal: s.duration || 0,
            progressText: formatProgress(s.viewOffset, s.duration)
          });
        }
      }
    } catch (e) {
      console.error(`Error fetching streams from ${server.name}:`, e);
    }
  }
  
  setAllStreams(allStreamsData);
  setTotalBandwidth(totalBitrate);
  
  // Aktualizuj licznik strumieni w serwerach
  const streamsByServer = {};
  for (const s of allStreamsData) {
    streamsByServer[s.serverId] = (streamsByServer[s.serverId] || 0) + 1;
  }
  
  const updatedServers = servers.map(s => ({
    ...s,
    active_streams: streamsByServer[s.id] || 0
  }));
  setServers(updatedServers);
  
  return allStreamsData;
};
  
    const fetchSessionDetails = async (server, sessionId) => {
	  if (!server.api_key) return null;
	  
	  try {
		const url = `${server.url}/Sessions/${sessionId}?api_key=${server.api_key}`;
		const res = await fetch(url);
		if (!res.ok) return null;
		return await res.json();
	  } catch (e) {
		return null;
	  }
	};
  
  // Formatuj postęp (HH:MM:SS / HH:MM:SS)
  const formatProgress = (position, duration) => {
    if (!position || !duration) return '—';
    const posSec = Math.floor(position / 10000000);
    const durSec = Math.floor(duration / 10000000);
    return `${formatTime(posSec)} / ${formatTime(durSec)}`;
  };
  
  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Odśwież status wszystkich serwerów
  const refreshAllStatus = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/media/status/all', { credentials: 'include' });
      if (res.ok) {
        const statuses = await res.json();
        
        const updatedServers = servers.map(s => ({
          ...s,
          enabled: statuses[s.id]?.active || false,
          version: statuses[s.id]?.version || s.version
        }));
        
        setServers(updatedServers);
        await saveMediaConfig(updatedServers);
        
        // Pobierz strumienie
        await fetchAllStreams();
      }
    } catch (e) {
      console.error('Status refresh error:', e);
    }
    setRefreshing(false);
  };

  // Odświeżaj status co 15 sekund
  React.useEffect(() => {
    if (servers.length > 0) {
      refreshAllStatus();
      const interval = setInterval(refreshAllStatus, 15000);
      return () => clearInterval(interval);
    }
  }, [servers.length]);

  // Akcja start/stop/restart
  const doAction = async (id, action) => {
    try {
      const res = await fetch(`/api/media/${id}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        setTimeout(refreshAllStatus, 2000);
      }
    } catch (e) {
      console.error('Action error:', e);
    }
  };

  // Zapisz edycję serwera
  const saveServerConfig = async (server) => {
    const updated = servers.map(s => s.id === server.id ? server : s);
    setServers(updated);
    await saveMediaConfig(updated);
    setEditingServer(null);
    setTimeout(refreshAllStatus, 1000);
  };

  // Dodaj nowy serwer
  const addNewServer = async () => {
    if (!newServer.id || !newServer.name) {
      alert('Wypełnij ID i Nazwę');
      return;
    }
    const server = {
      ...newServer,
      enabled: false,
      version: '—',
      libraries: [],
      active_streams: 0,
      transcode: false
    };
    const updated = [...servers, server];
    setServers(updated);
    await saveMediaConfig(updated);
    setShowAddDialog(false);
    setNewServer({ id: '', name: '', port: '', api_key: '', url: '' });
  };

  // Usuń serwer
  const removeServer = async (id) => {
    if (!confirm(`Usunąć serwer ${id}?`)) return;
    const updated = servers.filter(s => s.id !== id);
    setServers(updated);
    await saveMediaConfig(updated);
  };

  // Zatrzymaj strumień (tylko Jellyfin/Emby)
  const stopStream = async (serverId, sessionId) => {
    const server = servers.find(s => s.id === serverId);
    if (!server || !server.api_key) return;
    
    try {
      let url = '';
      if (serverId === 'jellyfin') {
        url = `${server.url}/Sessions/${sessionId}/Playing/Stop?api_key=${server.api_key}`;
      } else if (serverId === 'emby') {
        url = `${server.url}/emby/Sessions/${sessionId}/Playing/Stop?api_key=${server.api_key}`;
      } else {
        return;
      }
      
      await fetch(url, { method: 'POST' });
      setTimeout(refreshAllStatus, 1000);
    } catch (e) {
      console.error('Stop stream error:', e);
    }
  };
  
  const fetchLibraries = async (server) => {
  if (!server.api_key) {
    alert('Brak klucza API - najpierw skonfiguruj klucz API w edycji');
    return;
  }
  
  try {
    let url = '';
    if (server.id === 'jellyfin') {
      url = `${server.url}/Library/VirtualFolders?api_key=${server.api_key}`;
    } else if (server.id === 'plex') {
      url = `${server.url}/library/sections?X-Plex-Token=${server.api_key}`;
    } else if (server.id === 'emby') {
      url = `${server.url}/emby/Library/VirtualFolders?api_key=${server.api_key}`;
    } else {
      alert(`Pobieranie bibliotek dla ${server.name} nie jest obsługiwane`);
      return;
    }
    
    const res = await fetch(url);
    if (!res.ok) {
      alert(`Błąd pobierania bibliotek: ${res.status}`);
      return;
    }
    
    const data = await res.json();
    let libraries = [];
    
    if (server.id === 'plex' && data.MediaContainer?.Directory) {
      libraries = data.MediaContainer.Directory.map(d => ({ 
        id: d.key, 
        name: d.title, 
        type: d.type 
      }));
    } else if (Array.isArray(data)) {
      libraries = data.map(d => ({ 
        id: d.Id || d.id, 
        name: d.Name || d.name,
        type: d.Type || d.type
      }));
    }
    
    // Zapisz biblioteki w serwerze
    const updatedServers = servers.map(s => 
      s.id === server.id ? { ...s, libraries } : s
    );
    setServers(updatedServers);
    await saveMediaConfig(updatedServers);
    alert(`Pobrano ${libraries.length} bibliotek dla ${server.name}`);
    
  } catch (e) {
    alert('Błąd: ' + e.message);
  }
};

// Odśwież bibliotekę
const refreshLibrary = async (server, libraryId) => {
  if (!server.api_key) {
    alert('Brak klucza API');
    return;
  }
  
  try {
    let url = '';
    if (server.id === 'jellyfin') {
      url = `${server.url}/Library/Refresh?api_key=${server.api_key}`;
    } else if (server.id === 'plex') {
      url = `${server.url}/library/sections/${libraryId}/refresh?X-Plex-Token=${server.api_key}`;
    } else if (server.id === 'emby') {
      url = `${server.url}/emby/Library/Refresh?api_key=${server.api_key}`;
    } else {
      return;
    }
    
    const res = await fetch(url, { method: 'POST' });
    if (res.ok) {
      alert('Odświeżanie biblioteki rozpoczęte');
    } else {
      alert('Błąd: ' + res.status);
    }
  } catch (e) {
    alert('Błąd: ' + e.message);
  }
};

  // Dialog edycji serwera
  const EditServerModal = ({ server, onClose }) => {
    const [form, setForm] = React.useState({ ...server });
    const inpCss = { width: '100%', background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--fg)', padding: '7px 10px', borderRadius: 5, fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)', outline: 'none' };
    
    return (
      <Modal title={`Konfiguracja · ${server.name}`} sub="Ustawienia API i połączenia" onClose={onClose} width={580}
        footer={<><button className="btn sm ghost" onClick={onClose}>Anuluj</button><button className="btn sm primary" onClick={() => { saveServerConfig(form); onClose(); }}>Zapisz</button></>}>
        <Field label="Nazwa wyświetlana">
          <input style={inpCss} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="URL (http://localhost:8096)">
          <input style={inpCss} value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="http://localhost:8096" />
        </Field>
        <Field label="Port">
          <input style={inpCss} type="number" value={form.port} onChange={e => setForm({ ...form, port: parseInt(e.target.value) })} />
        </Field>
        <Field label="Klucz API" hint="Wymagany do pobierania strumieni">
          <input style={inpCss} value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })} type="password" />
        </Field>
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
		  <button className="btn sm" onClick={() => fetchLibraries(form)}>
			<Icon name="refresh" size={11} /> Pobierz biblioteki
		  </button>
		  {form.libraries?.length > 0 && (
			<span className="dim" style={{ fontSize: 11 }}>
			  {form.libraries.length} bibliotek
			</span>
		  )}
		</div>
        <div className="dim" style={{ fontSize: 11, marginTop: 8 }}>
          Jak uzyskać klucz API?<br />
          • Jellyfin: Panel admina → Zaawansowane → Klucze API<br />
          • Plex: Token dostępny po zalogowaniu (https://plex.tv/claim)<br />
          • Emby: Panel admina → API Keys
        </div>
      </Modal>
    );
  };

  // Dialog dodawania nowego serwera
  const AddServerModal = () => {
    const inputStyle = { background: 'var(--bg-2)', border: '1px solid var(--line-strong)', borderRadius: 5,
      padding: '6px 10px', color: 'var(--fg)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', outline: 'none', width: '100%' };
    
    return (
      <Modal title="Dodaj serwer multimediów" sub="Jellyfin, Plex, Emby, Navidrome..." onClose={() => setShowAddDialog(false)} width={520}
        footer={<><button className="btn sm ghost" onClick={() => setShowAddDialog(false)}>Anuluj</button><button className="btn sm primary" onClick={addNewServer}>Dodaj</button></>}>
        <Field label="ID (unikalny identyfikator)">
          <input style={inputStyle} value={newServer.id} onChange={e => setNewServer({ ...newServer, id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} placeholder="jellyfin" />
        </Field>
        <Field label="Nazwa wyświetlana">
          <input style={inputStyle} value={newServer.name} onChange={e => setNewServer({ ...newServer, name: e.target.value })} placeholder="Jellyfin" />
        </Field>
        <Field label="Port">
          <input style={inputStyle} type="number" value={newServer.port} onChange={e => setNewServer({ ...newServer, port: parseInt(e.target.value) || 0 })} placeholder="8096" />
        </Field>
        <Field label="URL">
          <input style={inputStyle} value={newServer.url} onChange={e => setNewServer({ ...newServer, url: e.target.value })} placeholder="http://localhost:8096" />
        </Field>
        <Field label="Klucz API (opcjonalnie)">
          <input style={inputStyle} value={newServer.api_key} onChange={e => setNewServer({ ...newServer, api_key: e.target.value })} type="password" />
        </Field>
      </Modal>
    );
  };

  if (loading) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--fg-dim)' }}>
        <span className="dot pulse" style={{ display: 'inline-block', marginRight: 8 }} />
        Ładowanie konfiguracji serwerów multimediów…
      </div>
    );
  }

  const enabledCount = servers.filter(s => s.enabled).length;
  const totalStreams = allStreams.length;
  const bandwidthText = totalBandwidth > 0 ? `${Math.round(totalBandwidth / 1000000)} Mb/s` : '0 Mb/s';

  return (
    <div className="col" style={{ gap: 'var(--gutter)' }}>
      {/* KPI */}
      <div className="grid grid-4">
        <div className="kpi"><div className="kpi-label">SERWERY</div><div className="kpi-value">{servers.length}</div><div className="kpi-foot"><span>skonfigurowanych</span></div></div>
        <div className="kpi"><div className="kpi-label">AKTYWNE</div><div className="kpi-value" style={{ color: 'var(--ok)' }}>{enabledCount}</div><div className="kpi-foot"><span>uruchomione</span></div></div>
        <div className="kpi"><div className="kpi-label">AKTYWNE STRUMIENIE</div><div className="kpi-value" style={{ color: 'var(--accent)' }}>{totalStreams}</div><div className="kpi-foot"><span>{bandwidthText}</span></div></div>
        <div className="kpi"><div className="kpi-label">ODŚWIEŻANIE</div><div className="kpi-value">{refreshing ? <span className="dot pulse" /> : '✓'}</div><div className="kpi-foot"><button className="btn sm ghost" onClick={refreshAllStatus} style={{ padding: 0 }}>Odśwież teraz</button></div></div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn sm primary" onClick={() => setShowAddDialog(true)}>
          <Icon name="plus" size={12} /> Dodaj serwer multimediów
        </button>
      </div>
      <div className="grid grid-2">
        {servers.map(m => {
          const colorMap = {
            plex: 'oklch(0.78 0.18 75)',
            jellyfin: 'oklch(0.65 0.18 280)',
            emby: 'oklch(0.65 0.16 150)',
            navidrome: 'oklch(0.7 0.16 150)'
          };
          const bgColor = colorMap[m.id] || 'var(--bg-3)';
          
          return (
            <div key={m.id} className="card">
              <div className="card-head">
                <div className="row gap-md">
                  <div className="cont-icon" style={{ width: 42, height: 42, background: bgColor, color: 'white', fontSize: 18 }}>
                    {(m.name || '?')[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="card-title">{m.name}</div>
                    <div className="card-sub">v{m.version || '—'} · port {m.port}</div>
                  </div>
                </div>
                <div className="row gap-sm" style={{ marginLeft: 'auto' }}>
                  {m.enabled ? (
                    <span className="badge ok"><span className="dot pulse" />ONLINE</span>
                  ) : (
                    <span className="badge"><span className="dot" />OFFLINE</span>
                  )}
                  <button className="icon-btn" onClick={() => setEditingServer(m)} title="Konfiguruj">
                    <Icon name="settings" size={14} />
                  </button>
                  <button className="icon-btn" onClick={() => removeServer(m.id)} title="Usuń">
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
              
              <div className="card-body">
                <div className="grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
                  <Mini label="STRUMIENIE" v={m.active_streams || 0} />
                  <Mini label="BIBLIOTEKI" v={m.libraries?.length || 0} />
                  <Mini label="API" v={m.api_key ? '✓' : '—'} />
                  <Mini label="URL" v={m.url?.replace('http://', '').replace('https://', '').split(':')[0] || '—'} />
                </div>
                
                {m.libraries && m.libraries.length > 0 && (
				  <div style={{ marginTop: 12 }}>
					<div className="dim" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
					  Biblioteki ({m.libraries.length})
					</div>
					<div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
					  {m.libraries.slice(0, 6).map(lib => (
						<span key={lib.id} className="chip" style={{ fontSize: 11 }}>
						  <Icon name="folder" size={10} style={{ marginRight: 4 }} />
						  {lib.name}
						  {lib.type && <span className="dim" style={{ marginLeft: 4 }}>({lib.type})</span>}
						  <button 
							className="icon-btn" 
							style={{ marginLeft: 6, width: 18, height: 18 }} 
							onClick={() => refreshLibrary(m, lib.id)} 
							title="Odśwież bibliotekę"
						  >
							<Icon name="refresh" size={10} />
						  </button>
						</span>
					  ))}
					  {m.libraries.length > 6 && (
						<span className="chip dim">+{m.libraries.length - 6} więcej</span>
					  )}
					</div>
				  </div>
				)}

				{m.libraries && m.libraries.length === 0 && m.api_key && (
				  <div style={{ marginTop: 12 }}>
					<button 
					  className="btn sm ghost" 
					  onClick={() => fetchLibraries(m)}
					  style={{ width: '100%', fontSize: 11 }}
					>
					  <Icon name="download" size={11} /> Pobierz biblioteki z {m.name}
					</button>
				  </div>
				)}
                
                {!m.api_key && (
                  <div className="dim" style={{ marginTop: 12, fontSize: 'var(--fs-xs)', textAlign: 'center', padding: 8 }}>
                    ⚠️ Dodaj klucz API w konfiguracji aby widzieć aktywne strumienie
                  </div>
                )}
                
                <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
                  <span className="mono dim" style={{ fontSize: 'var(--fs-xs)' }}>{m.url}</span>
                  <div className="row gap-sm">
                    <button className="btn sm" onClick={() => doAction(m.id, 'restart')} disabled={!m.enabled}>
                      <Icon name="restart" size={11} /> Restart
                    </button>
                    <button className="btn sm" onClick={() => doAction(m.id, m.enabled ? 'stop' : 'start')}>
                      {m.enabled ? <><Icon name="stop" size={11} /> Stop</> : <><Icon name="play" size={11} /> Start</>}
                    </button>
                    <button className="btn sm primary" onClick={() => window.open(m.url, '_blank')}>
                      Otwórz UI →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Aktywne strumienie</div>
            <div className="card-sub">{totalStreams} · {totalBandwidth > 0 ? `${Math.round(totalBandwidth / 1000000)} Mb/s` : '0 Mb/s'}</div>
          </div>
          <div className="card-actions">
            <button className="btn sm" onClick={fetchAllStreams}>
              <Icon name="refresh" size={12} /> Odśwież
            </button>
          </div>
        </div>
        
        {totalStreams === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-dim)' }}>
            {refreshing ? (
              <><span className="dot pulse" style={{ display: 'inline-block', marginRight: 8 }} />Sprawdzanie aktywnych strumieni...</>
            ) : (
              'Brak aktywnych strumieni'
            )}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Użytkownik</th>
                <th>Tytuł</th>
                <th>Urządzenie</th>
                <th>Jakość</th>
                <th>Tryb</th>
                <th>Postęp</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {allStreams.map((stream, idx) => (
                <tr key={idx}>
                  <td>
                    <span className="row gap-sm">
                      <div className="avatar" style={{ width: 24, height: 24, fontSize: 10 }}>{stream.userInitial}</div>
                      {stream.user}
                    </span>
                  </td>
                  <td style={{ fontWeight: 500 }}>
                    {stream.title}
                    {stream.year && <span className="dim" style={{ marginLeft: 6 }}>({stream.year})</span>}
                  </td>
                  <td className="dim">{stream.device}</td>
                  <td className="mono">{stream.quality !== '—' ? stream.quality : '?p'} · {stream.bitrateText !== '—' ? stream.bitrateText : '—'}</td>
                  <td>
                    {stream.transcode 
                      ? <span className="badge warn">Transkodowanie</span>
                      : <span className="badge ok">Direct Play</span>}
                  </td>
                  <td style={{ width: 200 }}>
                    <div className="bar"><i style={{ width: Math.min(100, stream.progress) + '%' }} /></div>
                    <div className="mono dim" style={{ fontSize: 10, marginTop: 2 }}>{stream.progressText}</div>
                  </td>
                  <td>
                    {(stream.serverId === 'jellyfin' || stream.serverId === 'emby') && (
                      <button className="btn sm ghost" onClick={() => stopStream(stream.serverId, stream.sessionId)} title="Zatrzymaj strumień">
                        <Icon name="stop" size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editingServer && <EditServerModal server={editingServer} onClose={() => setEditingServer(null)} />}
      {showAddDialog && <AddServerModal />}
    </div>
  );
};

// ── Export ────────────────────────────────────────────────────────────────────
window.Docker       = Docker;
window.Network      = Network;
window.FileServices = FileServices;
window.Media        = Media;

// ── NetworkFirewall — prawdziwe API UFW ───────────────────────────────────────
const NetworkFirewall = () => {
  const [rules,     setRules]     = React.useState([]);
  const [f2bJails,  setF2bJails]  = React.useState([]);
  const [ufwActive, setUfwActive] = React.useState(null);
  const [loading,   setLoading]   = React.useState(true);
  const [showAdd,   setShowAdd]   = React.useState(false);
  const [newRule,   setNewRule]   = React.useState({action:'allow', port:'', proto:'tcp', from:'any', comment:''});
  const [saving,    setSaving]    = React.useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [statusR, rulesR, f2bR] = await Promise.all([
        fetch('/network/firewall/status',   {credentials:'include'}),
        fetch('/network/firewall/rules',    {credentials:'include'}),
        fetch('/api/system/fail2ban-status',{credentials:'include'}).catch(()=>null),
      ]);
      if (statusR.ok) { const d = await statusR.json(); setUfwActive(d.active); }
      if (rulesR.ok) {
        const d = await rulesR.json();
        // Parse raw UFW numbered output: [ 1] 22/tcp ALLOW IN Anywhere
        const raw = (d.rules || []);
        const parsed = raw.map(line => {
          const m = line.match(/\[\s*(\d+)\]\s+(\S+)\s+(ALLOW|DENY|REJECT|LIMIT)\s+(IN|OUT|FWD)?\s*(.*)/i);
          if (!m) return null;
          return { num: m[1], port: m[2], action: m[3].toLowerCase(), dir: m[4]||'IN', from: m[5]||'any' };
        }).filter(Boolean);
        setRules(parsed.length ? parsed : raw.map((r,i)=>({num:i+1, port:'—', action:'allow', dir:'IN', from:r})));
      }
      if (f2bR?.ok) { const d = await f2bR.json(); setF2bJails(d.jails||[]); }
    } finally { setLoading(false); }
  };

  React.useEffect(() => { load(); }, []);

  const toggleUfw = async () => {
    const action = ufwActive ? 'disable' : 'enable';
    await fetch('/network/firewall/status/'+action, {method:'POST',credentials:'include'});
    setUfwActive(a=>!a);
  };

  const deleteRule = async (num) => {
    await fetch('/network/firewall/rules/'+num, {method:'DELETE',credentials:'include'});
    setRules(rs=>rs.filter(r=>r.num!==num));
  };

  const addRule = async () => {
    setSaving(true);
    try {
      await fetch('/network/firewall/rules', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(newRule),
      });
      setShowAdd(false);
      setNewRule({action:'allow',port:'',proto:'tcp',from:'any',comment:''});
      load();
    } finally { setSaving(false); }
  };

  const inpSt = {background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:5,
    padding:'5px 10px',color:'var(--fg)',fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',outline:'none'};

  if (loading) return (
    <div style={{padding:60,textAlign:'center',color:'var(--fg-dim)'}}>
      <div style={{width:18,height:18,border:'2px solid var(--line-strong)',borderTopColor:'var(--accent)',
        borderRadius:'50%',animation:'_spin .6s linear infinite',margin:'0 auto 12px'}}/>
      <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)'}}>Sprawdzanie UFW…</div>
    </div>
  );

  if (ufwActive === false && rules.length === 0) return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="card" style={{padding:40,textAlign:'center'}}>
        <Icon name="shield" size={48} style={{opacity:.2,display:'block',margin:'0 auto 20px'}}/>
        <div style={{fontWeight:700,fontSize:'var(--fs-lg)',marginBottom:10}}>UFW Firewall jest wyłączony</div>
        <div style={{color:'var(--fg-muted)',fontSize:'var(--fs-sm)',marginBottom:24}}>
          Zapora sieciowa nie jest aktywna. Włącz ją aby chronić serwer.
        </div>
        <button className="btn primary" onClick={toggleUfw} style={{padding:'9px 24px'}}>
          <Icon name="shield" size={14}/> Włącz UFW
        </button>
      </div>
    </div>
  );

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="grid grid-4">
        <div className="kpi">
          <div className="kpi-label">STATUS UFW</div>
          <div className="kpi-value" style={{fontSize:18,color:ufwActive?'var(--ok)':'var(--err)'}}>
            {ufwActive?'AKTYWNY':'NIEAKTYWNY'}
          </div>
          <div className="kpi-foot">
            <button className="btn sm" onClick={toggleUfw}>{ufwActive?'Wyłącz':'Włącz'}</button>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">REGUŁY</div>
          <div className="kpi-value">{rules.length}</div>
          <div className="kpi-foot"><span>skonfigurowanych</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">ALLOW</div>
          <div className="kpi-value" style={{color:'var(--ok)'}}>{rules.filter(r=>r.action==='allow').length}</div>
          <div className="kpi-foot"><span>przepuszczane</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">DENY/REJECT</div>
          <div className="kpi-value" style={{color:'var(--err)'}}>{rules.filter(r=>r.action!=='allow').length}</div>
          <div className="kpi-foot"><span>blokowane</span></div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div><div className="card-title">Reguły UFW</div><div className="card-sub">ufw status numbered</div></div>
          <div className="card-actions">
            <button className="btn sm" onClick={load}><Icon name="refresh" size={11}/> Odśwież</button>
            <button className="btn sm primary" onClick={()=>setShowAdd(s=>!s)}><Icon name="plus" size={12}/> Reguła</button>
          </div>
        </div>
        {showAdd && (
          <div style={{padding:'12px 16px',borderBottom:'1px solid var(--line)',background:'var(--bg-2)',
            display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr auto',gap:10,alignItems:'end'}}>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Akcja</div>
              <select style={inpSt} value={newRule.action} onChange={e=>setNewRule(r=>({...r,action:e.target.value}))}>
                <option value="allow">ALLOW</option>
                <option value="deny">DENY</option>
                <option value="reject">REJECT</option>
                <option value="limit">LIMIT</option>
              </select>
            </div>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Port</div>
              <input style={inpSt} value={newRule.port} onChange={e=>setNewRule(r=>({...r,port:e.target.value}))} placeholder="22"/>
            </div>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Protokół</div>
              <select style={inpSt} value={newRule.proto} onChange={e=>setNewRule(r=>({...r,proto:e.target.value}))}>
                <option>tcp</option><option>udp</option><option>any</option>
              </select>
            </div>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Źródło</div>
              <input style={inpSt} value={newRule.from} onChange={e=>setNewRule(r=>({...r,from:e.target.value}))} placeholder="any"/>
            </div>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Komentarz</div>
              <input style={inpSt} value={newRule.comment} onChange={e=>setNewRule(r=>({...r,comment:e.target.value}))} placeholder="opcjonalny"/>
            </div>
            <div className="row gap-sm" style={{paddingBottom:1}}>
              <button className="btn sm primary" onClick={addRule} disabled={saving||!newRule.port}>
                {saving?'…':'Dodaj'}
              </button>
              <button className="btn sm" onClick={()=>setShowAdd(false)}>✕</button>
            </div>
          </div>
        )}
        {rules.length === 0
          ? <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>
              Brak reguł UFW lub UFW nie jest zainstalowany
            </div>
          : <table className="table">
              <thead><tr><th>#</th><th>Akcja</th><th>Port/Usługa</th><th>Kierunek</th><th>Źródło</th><th></th></tr></thead>
              <tbody>
                {rules.map(r=>(
                  <tr key={r.num}>
                    <td className="mono dim">{r.num}</td>
                    <td><span className={'badge '+(r.action==='allow'?'ok':'err')}>{r.action.toUpperCase()}</span></td>
                    <td className="mono">{r.port}</td>
                    <td className="mono dim">{r.dir}</td>
                    <td className="mono dim">{r.from}</td>
                    <td><button className="icon-btn" onClick={()=>deleteRule(r.num)}><Icon name="trash" size={13}/></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
        }
      </div>

      {f2bJails.length > 0 && (
        <div className="card">
          <div className="card-head"><div className="card-title">Fail2Ban · aktywne banki</div></div>
          <table className="table">
            <thead><tr><th>Jail</th><th>Status</th><th>Zbanowanych</th><th>Prób</th></tr></thead>
            <tbody>
              {f2bJails.map((j,i)=>(
                <tr key={i}>
                  <td className="mono">{j.name||j}</td>
                  <td><span className={'badge '+(j.active?'ok':'')}>{j.active?'aktywny':'nieaktywny'}</span></td>
                  <td className="mono" style={{color:j.banned>0?'var(--err)':'var(--fg)'}}>{j.banned||0}</td>
                  <td className="mono dim">{j.failed||0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── ProxyRouteForm — zewnętrzny komponent (unikamy utraty focusu) ─────────────
const ProxyRouteForm = ({ form, setF, editItem, applying, onCancel, onSave }) => {
  const mono = {fontFamily:'var(--font-mono)', fontSize:'var(--fs-xs)'};
  const inpSt = {background:'var(--bg-2)', border:'1px solid var(--line-strong)',
    borderRadius:6, padding:'6px 10px', color:'var(--fg)', ...mono, outline:'none', width:'100%'};

  const Toggle2 = ({label, k}) => (
    <div style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}} onClick={()=>setF(k,!form[k])}>
      <div className={'toggle'+(form[k]?' on':'')} style={{transform:'scale(0.8)',flexShrink:0}}/>
      <span style={{fontSize:'var(--fs-xs)',color:'var(--fg-muted)'}}>{label}</span>
    </div>
  );

  return (
    <div style={{background:'var(--bg-2)',border:'1px solid var(--line-strong)',
      borderRadius:10,padding:20,marginBottom:16}}>
      <div style={{fontWeight:600,fontSize:'var(--fs-base)',marginBottom:14}}>
        {editItem ? 'Edytuj trasę' : 'Nowa trasa reverse proxy'}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
        <div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.04em'}}>Domena</div>
          <input style={inpSt} value={form.domain} onChange={e=>setF('domain',e.target.value)}
            placeholder="app.nasserver.pl" autoFocus/>
        </div>
        <div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.04em'}}>Cel (IP:port)</div>
          <input style={inpSt} value={form.target} onChange={e=>setF('target',e.target.value)}
            placeholder="192.168.1.23:7878"/>
        </div>
      </div>
      <div>
        <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.04em'}}>Opis (opcjonalny)</div>
        <input style={inpSt} value={form.comment} onChange={e=>setF('comment',e.target.value)}
          placeholder="np. Radarr — biblioteka filmów"/>
      </div>
      <div style={{display:'flex',gap:20,marginTop:14,flexWrap:'wrap'}}>
        <Toggle2 label="SSL / HTTPS (ACME Let's Encrypt)" k="ssl"/>
        <Toggle2 label="Wymuszaj HTTPS (redirect 80→443)"  k="https"/>
        <Toggle2 label="WebSocket proxy"                    k="ws_proxy"/>
      </div>
      {form.ssl && (
        <div style={{marginTop:10,padding:'8px 12px',background:'color-mix(in oklch,var(--accent) 8%,transparent)',
          border:'1px solid color-mix(in oklch,var(--accent) 20%,transparent)',borderRadius:6,
          fontSize:'var(--fs-xs)',color:'var(--fg-muted)'}}>
          💡 SSL wymaga skonfigurowanego ACME dla domeny <strong>{form.domain||'twoja-domena.pl'}</strong>
        </div>
      )}
      <div style={{display:'flex',gap:8,marginTop:16,justifyContent:'flex-end'}}>
        <button className="btn" onClick={onCancel}>Anuluj</button>
        <button className="btn primary" onClick={onSave} disabled={applying}>
          {applying ? 'Zapisywanie…' : editItem ? 'Zapisz zmiany' : 'Dodaj trasę'}
        </button>
      </div>
    </div>
  );
};


// ── NetworkProxy — zarządzanie trasami reverse proxy (nas-web) ───────────────
const NetworkProxy = () => {
  const [routes,   setRoutes]   = React.useState([]);
  const [nasWeb,   setNasWeb]   = React.useState(null); // null=checking
  const [loading,  setLoading]  = React.useState(true);
  const [applying, setApplying] = React.useState(false);
  const [showAdd,  setShowAdd]  = React.useState(false);
  const [showPrev, setShowPrev] = React.useState(false);
  const [preview,  setPreview]  = React.useState('');
  const [editItem, setEditItem] = React.useState(null);
  const [err,      setErr]      = React.useState('');
  const [ok,       setOk]       = React.useState('');

  const emptyRoute = { domain:'', target:'', ssl:false, https:false, ws_proxy:false, active:true, comment:'' };
  const [form, setForm] = React.useState(emptyRoute);
  const setF = (k, v) => setForm(f => ({...f, [k]: v}));

  const load = async () => {
    setLoading(true);
    try {
      const [routesR, statusR] = await Promise.all([
        fetch('/api/proxy/routes', {credentials:'include'}),
        fetch('/api/proxy/status', {credentials:'include'}),
      ]);
      if (routesR.ok) { const d = await routesR.json(); setRoutes(d.routes || []); }
      if (statusR.ok) { const d = await statusR.json(); setNasWeb(d); }
      else setNasWeb({running: false});
    } catch(e) {
      setNasWeb({running: false, error: e.message});
    } finally { setLoading(false); }
  };

  React.useEffect(() => { load(); }, []);

  const flash = (msg, isErr=false) => {
    if (isErr) { setErr(msg); setTimeout(()=>setErr(''), 4000); }
    else       { setOk(msg);  setTimeout(()=>setOk(''),  3000); }
  };

  const apply = async () => {
    setApplying(true);
    try {
      const r = await fetch('/api/proxy/apply', {method:'POST', credentials:'include'});
      if (!r.ok) throw new Error(await r.text());
      flash('✓ Konfiguracja nas-web zaktualizowana i przeładowana');
    } catch(e) { flash('Błąd apply: ' + e.message, true); }
    finally { setApplying(false); }
  };

  const saveRoute = async () => {
    if (!form.domain || !form.target) { flash('Domena i cel są wymagane', true); return; }
    setApplying(true);
    try {
      const isEdit = !!editItem;
      const url    = isEdit ? `/api/proxy/routes/${editItem.id}` : '/api/proxy/routes';
      const method = isEdit ? 'PUT' : 'POST';
      const r = await fetch(url, {
        method, credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error(await r.text());
      flash(isEdit ? '✓ Trasa zaktualizowana i zastosowana' : '✓ Trasa dodana i zastosowana');
      setShowAdd(false); setEditItem(null); setForm(emptyRoute);
      load();
    } catch(e) { flash(e.message, true); }
    finally { setApplying(false); }
  };

  const deleteRoute = async (id) => {
    if (!confirm('Usunąć tę trasę?')) return;
    await fetch(`/api/proxy/routes/${id}`, {method:'DELETE', credentials:'include'});
    flash('Trasa usunięta'); load();
  };

  const toggleActive = async (route) => {
    await fetch(`/api/proxy/routes/${route.id}`, {
      method:'PUT', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({...route, active: !route.active}),
    });
    load();
  };

  const loadPreview = async () => {
    const r = await fetch('/api/proxy/preview', {credentials:'include'});
    const d = await r.json();
    setPreview(d.config || '');
    setShowPrev(true);
  };

  const mono = {fontFamily:'var(--font-mono)', fontSize:'var(--fs-xs)'};
  const inpSt = {background:'var(--bg-2)', border:'1px solid var(--line-strong)',
    borderRadius:6, padding:'6px 10px', color:'var(--fg)', ...mono, outline:'none', width:'100%'};

  if (loading) return (
    <div style={{padding:60,textAlign:'center',color:'var(--fg-dim)'}}>
      <div style={{width:18,height:18,border:'2px solid var(--line-strong)',borderTopColor:'var(--accent)',
        borderRadius:'50%',animation:'_spin .6s linear infinite',margin:'0 auto 12px'}}/>
      <div style={mono}>Ładowanie tras proxy…</div>
    </div>
  );

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>

      {/* ── Status nas-web ── */}
      <div className="card">
        <div style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:12}}>
          <div style={{width:36,height:36,borderRadius:8,flexShrink:0,display:'grid',placeItems:'center',
            background: nasWeb?.running
              ? 'color-mix(in oklch,var(--ok) 15%,transparent)'
              : 'color-mix(in oklch,var(--err) 15%,transparent)'}}>
            <Icon name="globe" size={18} style={{color: nasWeb?.running ? 'var(--ok)' : 'var(--err)'}}/>
          </div>
          <div style={{flex:1}}>
            <div style={{fontWeight:600,fontSize:'var(--fs-sm)'}}>Reverse proxy (nimbus built-in)</div>
            <div style={{...mono,color:'var(--fg-dim)',marginTop:2}}>
              {nasWeb?.running
                ? `RUNNING · ${nasWeb?.engine || 'nimbus built-in'} · ${nasWeb?.active_routes||0} aktywnych tras`
                : 'Ładowanie…'}
            </div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <span className={'badge '+(nasWeb?.running ? 'ok' : 'err')}>
              <span className={'dot'+(nasWeb?.running?' pulse':'')}/>
              {nasWeb?.running ? 'ONLINE' : 'OFFLINE'}
            </span>
            <button className="btn sm" onClick={load}><Icon name="refresh" size={11}/></button>
          </div>
        </div>
      </div>

      {/* ── Komunikaty ── */}
      {ok  && <div style={{padding:'10px 14px',background:'color-mix(in oklch,var(--ok) 10%,transparent)',border:'1px solid color-mix(in oklch,var(--ok) 25%,transparent)',borderRadius:7,color:'var(--ok)',fontSize:'var(--fs-sm)'}}>{ok}</div>}
      {err && <div style={{padding:'10px 14px',background:'color-mix(in oklch,var(--err) 10%,transparent)',border:'1px solid color-mix(in oklch,var(--err) 25%,transparent)',borderRadius:7,color:'var(--err)',fontSize:'var(--fs-sm)'}}>{err}</div>}

      {/* ── Toolbar ── */}
      <div style={{display:'flex',gap:8,alignItems:'center'}}>
        <button className="btn primary" onClick={()=>{setShowAdd(true);setEditItem(null);setForm(emptyRoute);}}>
          <Icon name="plus" size={12}/> Dodaj trasę
        </button>
        <button className="btn" onClick={load}><Icon name="refresh" size={12}/> Odśwież</button>
        <button className="btn" onClick={loadPreview}>
          <Icon name="log" size={12}/> Podgląd konfiguracji
        </button>
        <div style={{flex:1}}/>
        <div style={{...mono,color:'var(--fg-dim)',fontSize:'var(--fs-xs)'}}>
          {routes.filter(r=>r.active).length} aktywnych · {routes.length} łącznie
        </div>
      </div>

      {/* ── Formularz ── */}
      {(showAdd || editItem) && <ProxyRouteForm form={form} setF={setF} editItem={editItem} applying={applying} onCancel={()=>{setShowAdd(false);setEditItem(null);setForm(emptyRoute);}} onSave={saveRoute}/>}

      {/* ── Lista tras ── */}
      {routes.length === 0 ? (
        <div className="card" style={{padding:48,textAlign:'center'}}>
          <Icon name="globe" size={48} style={{opacity:.15,display:'block',margin:'0 auto 16px'}}/>
          <div style={{fontWeight:600,fontSize:'var(--fs-lg)',marginBottom:8}}>Brak tras proxy</div>
          <div style={{color:'var(--fg-muted)',fontSize:'var(--fs-sm)',marginBottom:20}}>
            Dodaj pierwszą trasę — wpisz domenę i adres IP:port docelowej usługi
          </div>
          <button className="btn primary" onClick={()=>{setShowAdd(true);setForm(emptyRoute);}}>
            <Icon name="plus" size={12}/> Dodaj trasę
          </button>
        </div>
      ) : (
        <div className="card">
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--line)'}}>
                {['Domena','Cel (IP:port)','Opcje','Status',''].map(h=>(
                  <th key={h} style={{padding:'10px 16px',textAlign:'left',fontSize:'var(--fs-xs)',
                    color:'var(--fg-dim)',fontWeight:500,textTransform:'uppercase',letterSpacing:'.04em'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {routes.map(route => (
                <tr key={route.id} style={{borderBottom:'1px solid var(--line)',
                  opacity: route.active ? 1 : 0.45,
                  transition:'opacity .2s'}}>
                  <td style={{padding:'12px 16px'}}>
                    <div style={{fontWeight:600,...mono}}>{route.domain}</div>
                    {route.comment && <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginTop:2}}>{route.comment}</div>}
                  </td>
                  <td style={{padding:'12px 16px'}}>
                    <span style={{...mono,color:'var(--accent)'}}>→ {route.target}</span>
                  </td>
                  <td style={{padding:'12px 16px'}}>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                      {route.ssl      && <span className="badge ok"  style={{fontSize:10}}>SSL</span>}
                      {route.https    && <span className="badge ok"  style={{fontSize:10}}>HTTPS</span>}
                      {route.ws_proxy && <span className="chip"      style={{fontSize:10}}>WS</span>}
                    </div>
                  </td>
                  <td style={{padding:'12px 16px'}}>
                    <div className={'toggle'+(route.active?' on':'')}
                      style={{cursor:'pointer'}}
                      onClick={()=>toggleActive(route)}
                      title={route.active?'Kliknij aby wyłączyć':'Kliknij aby włączyć'}/>
                  </td>
                  <td style={{padding:'12px 16px'}}>
                    <div style={{display:'flex',gap:4}}>
                      <button className="btn sm" onClick={()=>{
                        setEditItem(route);
                        setForm({...route});
                        setShowAdd(false);
                        window.scrollTo({top:0,behavior:'smooth'});
                      }}>
                        <Icon name="edit" size={11}/>
                      </button>
                      <button className="btn sm danger" onClick={()=>deleteRoute(route.id)}>
                        <Icon name="trash" size={11}/>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Podgląd konfiguracji nas-web ── */}
      {showPrev && (
        <div style={{position:'fixed',inset:0,zIndex:900,display:'flex',alignItems:'center',justifyContent:'center',
          background:'rgba(0,0,0,.6)',backdropFilter:'blur(3px)'}}
          onClick={e=>{if(e.target===e.currentTarget)setShowPrev(false);}}>
          <div style={{width:760,maxWidth:'95vw',maxHeight:'85vh',display:'flex',flexDirection:'column',
            background:'var(--bg-1)',border:'1px solid var(--line-strong)',borderRadius:12,overflow:'hidden',
            boxShadow:'0 32px 80px rgba(0,0,0,.6)'}}>
            <div style={{padding:'14px 20px',borderBottom:'1px solid var(--line)',display:'flex',alignItems:'center',gap:10}}>
              <div style={{fontWeight:600,flex:1}}>Podgląd /etc/nas-web/nas-web.conf</div>
              <button className="btn sm" onClick={()=>setShowPrev(false)}>Zamknij</button>
            </div>
            <div style={{flex:1,overflowY:'auto',padding:16}}>
              <pre style={{...mono,lineHeight:1.7,color:'var(--fg-muted)',margin:0,whiteSpace:'pre-wrap',wordBreak:'break-all'}}>
                {preview}
              </pre>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
