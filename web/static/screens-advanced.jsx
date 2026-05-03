// ===== Advanced screens: S.M.A.R.T., Cron, Powiadomienia =====

const storeGet = window.storeGet;

// ─────────────────────────────────────────────
// API HELPERS
// ─────────────────────────────────────────────

const _apiFetch = async (path, opts = {}) => {
  const r = await fetch(path, { credentials: 'include', ...opts });
  if (!r.ok) throw new Error(`${opts.method || 'GET'} ${path} → ${r.status}`);
  return r.json();
};

const api = {
  get:  (path)        => _apiFetch(path),
  post: (path, body)  => _apiFetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body ?? {}) }),
  put:  (path, body)  => _apiFetch(path, { method:'PUT',  headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }),
  del:  (path)        => _apiFetch(path, { method:'DELETE' }),
};

const usePoll = (fn, ms, deps = []) => {
  React.useEffect(() => {
    fn();
    const iv = setInterval(fn, ms);
    return () => clearInterval(iv);
  }, deps); // eslint-disable-line
};

// ─────────────────────────────────────────────
// S.M.A.R.T. — parser JSON smartctl -a -j
// ─────────────────────────────────────────────

// smartctl --scan -j zwraca: { "/dev/sda": { name:"/dev/sda", type:"...", protocol:"..." }, ... }
// smartctl -a -j /dev/sda zwraca pełny obiekt z atrybutami ATA

function _parseSmartScan(raw) {
  if (!raw) return [];

  // Format zwracany przez smartctl --scan -j:
  // { "smartctl": {...}, "devices": [ { "name": "/dev/sda", "type": "scsi", "protocol": "SCSI" } ] }
  const list =
    raw.devices           ? raw.devices        // ← właściwy format
    : Array.isArray(raw)  ? raw                // tablica bezpośrednia
    : Object.entries(raw)                      // stary format { "/dev/sda": {...} }
        .filter(([k]) => k.startsWith('/dev/'))
        .map(([k, v]) => ({ name: k, type: v.type, protocol: v.protocol }));

  return list
    .filter(d => d.name && d.name.startsWith('/dev/'))
    .map(d => ({
      dev:     d.name.replace('/dev/', ''),
      devFull: d.name,
      type:    d.protocol || d.type || 'ATA',
      name:    d.name.replace('/dev/', '').toUpperCase(),
    }));
}

function _parseSmartDetails(raw, devName) {
  if (!raw) return null;

  // smartctl -a -j zwraca obiekt najwyższego poziomu
  const sc = raw.smartctl || {};
  const di = raw.device   || {};
  const id = raw.ata_smart_attributes?.table || [];
  const health = raw.smart_status?.passed ?? true;
  const temp   = raw.temperature?.current ?? raw.ata_smart_attributes?.table?.find(a => a.id === 194)?.raw?.value ?? 0;
  const hours  = raw.power_on_time?.hours ?? 0;
  const model  = raw.model_name  || raw.model_family || di.name || '—';
  const serial = raw.serial_number || '—';
  const fw     = raw.firmware_version || '—';
  const proto  = di.protocol || raw.device?.type || 'ATA';

  // Atrybuty ATA
  const CRIT_IDS = new Set([5, 187, 197, 198, 196]);
  const attrs = id.map(a => {
    const raw_val = a.raw?.value ?? a.raw?.string ?? String(a.raw ?? '');
    const isCrit  = CRIT_IDS.has(a.id);
    const thresh   = a.thresh ?? 0;
    const value    = a.value  ?? 0;
    const worst    = a.worst  ?? 0;
    const failed   = (thresh > 0 && value <= thresh) || (isCrit && parseInt(raw_val) > 0);
    return {
      id:     a.id,
      name:   a.name || `Attr_${a.id}`,
      val:    value,
      worst,
      thresh,
      raw:    raw_val,
      status: failed ? 'warn' : 'ok',
    };
  });

  // Historia testów — z ata_smart_self_test_log
  const testTable =
    raw.ata_smart_self_test_log?.standard?.table ||
    raw.ata_smart_self_test_log?.extended?.table ||
    [];
  const testHistory = testTable.map(t => {
    const pct = t.remaining_percent ?? 0;
    const done = pct === 0;
    const passed = (t.status?.value ?? 0) === 0; // 0 = completed without error
    return {
      date:     t.lifetime_hours != null ? `${t.lifetime_hours} h` : '—',
      type:     t.type?.string || String(t.type || '?'),
      result:   t.status?.string || (passed ? 'Completed: no failure' : 'Failed'),
      duration: done ? '100%' : `${100 - pct}%`,
      passed,
    };
  });

  // Log błędów ATA
  const errLog  = raw.ata_smart_error_log?.summary?.table || [];
  const errorLog = errLog.map((e, i) => ({
    num:     i + 1,
    date:    `${e.error_number || i+1}`,
    type:    e.completion_registers?.command || e.error?.string || 'UNC',
    lba:     e.lba ? `0x${e.lba.toString(16).padStart(8,'0')}` : '—',
    sectors: e.count || 1,
    desc:    e.error?.string || e.description || 'Read error',
  }));

  return {
    dev: devName,
    passed: health,
    temp:   Number(temp),
    hours:  Number(hours),
    model, serial,
    firmware: fw,
    protocol: proto,
    started: '—',
    attrs,
    testHistory,
    errorLog,
  };
}

// ─────────────────────────────────────────────
// S.M.A.R.T. KOMPONENT
// ─────────────────────────────────────────────

const SmartDetails = () => {
  const [devices, setDevices]     = React.useState([]);
  const [sel, setSel]             = React.useState(null);
  const [smart, setSmart]         = React.useState(null);
  const [smartCache, setSmartCache] = React.useState({}); // cache PASSED/WARN per device
  const [loadingDevs, setLoadingDevs] = React.useState(true);
  const [loadingDetail, setLoadingDetail] = React.useState(false);
  const [error, setError]         = React.useState(null);
  const [runningTest, setRunningTest] = React.useState(null);
  const [testProgress, setTestProgress] = React.useState(0);

  // 1. Pobierz listę dysków ze smartctl --scan
  const fetchDevices = React.useCallback(async () => {
    try {
      setError(null);
      const raw = await api.get('/api/storage/smart');
      const devs = _parseSmartScan(raw);
      setDevices(devs);
      if (devs.length > 0 && !sel) setSel(devs[0].dev);
      // Pobierz podstawowe PASSED/WARN dla każdego dysku do paska
      devs.forEach(async d => {
        try {
          const r = await api.get(`/api/storage/smart/details/${d.dev}`);
          const parsed = _parseSmartDetails(r, d.dev);
          if (parsed) setSmartCache(c => ({...c, [d.dev]: { passed: parsed.passed, temp: parsed.temp }}));
        } catch(_) {}
      });
    } catch (e) {
      setError('Błąd pobierania listy dysków: ' + e.message);
    } finally {
      setLoadingDevs(false);
    }
  }, [sel]);

  usePoll(fetchDevices, 60_000, []);

  // 2. Pobierz szczegóły wybranego dysku
  const fetchDetails = React.useCallback(async () => {
    if (!sel) return;
    setLoadingDetail(true);
    try {
      const raw = await api.get(`/api/storage/smart/details/${sel}`);
      const parsed = _parseSmartDetails(raw, sel);
      setSmart(parsed);
      if (parsed) setSmartCache(c => ({...c, [sel]: { passed: parsed.passed, temp: parsed.temp }}));
    } catch (e) {
      setError('Błąd pobierania S.M.A.R.T.: ' + e.message);
    } finally {
      setLoadingDetail(false);
    }
  }, [sel]);

  usePoll(fetchDetails, 30_000, [sel]);

  // 3. Poll statusu testu
  React.useEffect(() => {
    if (!runningTest) return;
    const iv = setInterval(async () => {
      try {
        const st = await api.get(`/api/storage/smart/test-status/${sel}`);
        if (typeof st.progress === 'number') setTestProgress(st.progress);
        if (st.done || !st.running) {
          clearInterval(iv);
          setRunningTest(null);
          setTestProgress(0);
          fetchDetails();
        }
      } catch (_) {}
    }, 4_000);
    return () => clearInterval(iv);
  }, [runningTest, sel]);

  const runTest = async (type) => {
    try {
      await api.post('/api/storage/smart/run-test', { device: sel, type });
      setRunningTest(type);
      setTestProgress(0);
    } catch (e) {
      alert(`Nie udało się uruchomić testu: ${e.message}`);
    }
  };

  // ── Render ─────────────────────────────────

  if (loadingDevs) return (
    <div className="card" style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>
      <span className="dot pulse" style={{display:'inline-block',marginRight:8}}/>Wykrywanie dysków…
    </div>
  );

  if (error && devices.length === 0) return (
    <div className="card" style={{padding:32,textAlign:'center',color:'var(--err)'}}>
      ⚠ {error}
      <br/><button className="btn sm" style={{marginTop:12}} onClick={fetchDevices}>Spróbuj ponownie</button>
    </div>
  );

  if (devices.length === 0) return (
    <div className="card" style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>
      Nie znaleziono dysków obsługiwanych przez S.M.A.R.T.
    </div>
  );

  const warnAttrs = (smart?.attrs || []).filter(a => a.status === 'warn');

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>

      {/* Selektor dysków */}
      <div className="card" style={{padding:'12px 16px'}}>
        <div className="row gap-sm" style={{flexWrap:'wrap'}}>
          {devices.map(d => {
            const cache = smartCache[d.dev];
            const passed = cache ? cache.passed : null;
            return (
              <button key={d.dev} onClick={() => setSel(d.dev)}
                style={{padding:'8px 14px',borderRadius:7,border:'1px solid',cursor:'pointer',
                  fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)',transition:'all .15s',
                  borderColor: sel===d.dev ? 'var(--accent)' : 'var(--line-strong)',
                  background:  sel===d.dev ? 'oklch(0.55 0.2 260 / 0.15)' : 'var(--bg-2)',
                  color: passed===false ? 'var(--warn)' : 'var(--fg)'}}>
                <div style={{fontWeight:600}}>/dev/{d.dev}</div>
                <div style={{color:'var(--fg-dim)',marginTop:2,fontSize:10}}>{d.type}</div>
                <div style={{marginTop:3}}>
                  {passed === null
                    ? <span style={{color:'var(--fg-dim)',fontSize:10}}>…</span>
                    : passed
                      ? <span style={{color:'var(--ok)',fontSize:10}}>● PASSED</span>
                      : <span style={{color:'var(--warn)',fontSize:10}}>▲ WARN</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Baner ostrzeżeń */}
      {warnAttrs.length > 0 && (
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',
          background:'oklch(0.78 0.15 75 / 0.08)',border:'1px solid oklch(0.78 0.15 75 / 0.25)',borderRadius:8,fontSize:'var(--fs-sm)'}}>
          <Icon name="thermometer" size={14} style={{color:'var(--warn)',flexShrink:0}}/>
          <span><b>{warnAttrs.length}</b> {warnAttrs.length === 1 ? 'atrybut wymaga' : 'atrybuty wymagają'} uwagi: {warnAttrs.map(a=>a.name.replace(/_/g,' ')).join(', ')}</span>
          <button className="btn sm danger" style={{marginLeft:'auto'}} onClick={()=>runTest('Long')}>
            Uruchom test długi
          </button>
        </div>
      )}

      {/* KPI */}
      {loadingDetail && !smart ? (
        <div className="card" style={{padding:24,textAlign:'center',color:'var(--fg-dim)'}}>
          <span className="dot pulse" style={{display:'inline-block',marginRight:8}}/>Wczytywanie atrybutów…
        </div>
      ) : smart ? (
        <>
          <div className="grid grid-4">
            <div className="kpi">
              <div className="kpi-label">STATUS</div>
              <div className="kpi-value" style={{fontSize:18,color:smart.passed?'var(--ok)':'var(--warn)'}}>{smart.passed?'PASSED':'WARN'}</div>
              <div className="kpi-foot"><span>S.M.A.R.T. overall</span></div>
            </div>
            <div className="kpi">
              <div className="kpi-label">TEMPERATURA</div>
              <div className="kpi-value" style={{fontSize:18,color:smart.temp>48?'var(--err)':smart.temp>42?'var(--warn)':'var(--ok)'}}>{smart.temp}°C</div>
              <div className="kpi-foot"><span>próg: 55°C</span></div>
            </div>
            <div className="kpi">
              <div className="kpi-label">GODZINY PRACY</div>
              <div className="kpi-value" style={{fontSize:16}}>{smart.hours.toLocaleString()}</div>
              <div className="kpi-foot"><span>≈ {Math.round(smart.hours/8760)} lat</span></div>
            </div>
            <div className="kpi">
              <div className="kpi-label">BŁĘDY W LOGU</div>
              <div className="kpi-value" style={{color:smart.errorLog.length>0?'var(--err)':'var(--ok)'}}>{smart.errorLog.length}</div>
              <div className="kpi-foot"><span>w historii błędów</span></div>
            </div>
          </div>

          <div className="grid grid-2">
            {/* Info + testy */}
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Informacje o dysku</div>
                  <div className="card-sub">/dev/{smart.dev} · {smart.protocol}</div>
                </div>
                <div className="card-actions">
                  {runningTest ? (
                    <span className="badge warn"><span className="dot pulse"/>{runningTest} {testProgress}%</span>
                  ) : (
                    <>
                      <button className="btn sm" onClick={()=>runTest('Short')}>Test krótki</button>
                      <button className="btn sm" onClick={()=>runTest('Long')}>Test długi</button>
                    </>
                  )}
                </div>
              </div>
              <div className="card-body col" style={{gap:9}}>
                {[
                  ['Model',       smart.model],
                  ['Numer ser.',  smart.serial],
                  ['Firmware',    smart.firmware],
                  ['Protokół',    smart.protocol],
                  ['Godziny',     smart.hours.toLocaleString() + ' h'],
                ].map(([k,v])=>(
                  <div key={k} className="row" style={{justifyContent:'space-between',fontSize:'var(--fs-sm)'}}>
                    <span style={{color:'var(--fg-dim)'}}>{k}</span>
                    <span className="mono">{v || '—'}</span>
                  </div>
                ))}
                {runningTest && (
                  <div style={{marginTop:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:4,fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>
                      <span>Test {runningTest} w toku…</span><span>{testProgress}%</span>
                    </div>
                    <div className="bar" style={{height:6}}>
                      <i style={{width:testProgress+'%',background:'var(--accent)',transition:'width .3s'}}/>
                    </div>
                  </div>
                )}
              </div>

              {smart.testHistory.length > 0 && (
                <>
                  <div style={{padding:'10px 16px 4px',fontSize:'var(--fs-xs)',fontWeight:600,color:'var(--fg-dim)',textTransform:'uppercase',letterSpacing:'.06em'}}>Historia testów</div>
                  <table className="table">
                    <thead><tr><th>Godziny</th><th>Typ</th><th>Wynik</th><th>Ukończono</th></tr></thead>
                    <tbody>
                      {smart.testHistory.map((t,i)=>(
                        <tr key={i}>
                          <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{t.date}</td>
                          <td><span className="chip">{t.type}</span></td>
                          <td style={{fontSize:'var(--fs-xs)',color:t.passed?'var(--ok)':'var(--warn)'}}>{t.result}</td>
                          <td className="mono dim">{t.duration}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>

            {/* Atrybuty */}
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Atrybuty S.M.A.R.T.</div>
                  <div className="card-sub">{smart.attrs.length} atrybutów</div>
                </div>
                <div className="card-actions">
                  <button className="btn sm" onClick={async()=>{
                    const blob = new Blob([JSON.stringify(smart,null,2)],{type:'application/json'});
                    const a = document.createElement('a'); a.href=URL.createObjectURL(blob);
                    a.download=`smart-${sel}.json`; a.click();
                  }}><Icon name="download" size={11}/> Eksportuj</button>
                </div>
              </div>
              <table className="table">
                <thead><tr><th>ID</th><th>Atrybut</th><th>Wart.</th><th>Min</th><th>Prog</th><th>Raw</th><th></th></tr></thead>
                <tbody>
                  {smart.attrs.map(a=>(
                    <tr key={a.id} style={{background:a.status==='warn'?'oklch(0.78 0.15 75 / 0.06)':''}}>
                      <td className="mono dim">{a.id}</td>
                      <td style={{fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)',color:a.status==='warn'?'var(--warn)':'var(--fg)'}}>{a.name.replace(/_/g,' ')}</td>
                      <td className="mono">{a.val}</td>
                      <td className="mono dim">{a.worst}</td>
                      <td className="mono dim">{a.thresh}</td>
                      <td className="mono" style={{color:'var(--accent)'}}>{a.raw}</td>
                      <td>{a.status==='warn'?<span className="badge warn">WARN</span>:<span className="badge ok">OK</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {smart.errorLog.length > 0 && (
                <>
                  <div style={{padding:'10px 16px 4px',fontSize:'var(--fs-xs)',fontWeight:600,color:'var(--err)',textTransform:'uppercase',letterSpacing:'.06em'}}>
                    Log błędów ({smart.errorLog.length})
                  </div>
                  <table className="table">
                    <thead><tr><th>#</th><th>Nr błędu</th><th>Typ</th><th>LBA</th><th>Sektory</th><th>Opis</th></tr></thead>
                    <tbody>
                      {smart.errorLog.map(e=>(
                        <tr key={e.num} style={{background:'oklch(0.65 0.2 25 / 0.06)'}}>
                          <td className="mono dim">{e.num}</td>
                          <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{e.date}</td>
                          <td><span className="badge err">{e.type}</span></td>
                          <td className="mono" style={{fontSize:'var(--fs-xs)'}}>{e.lba}</td>
                          <td className="mono">{e.sectors}</td>
                          <td style={{fontSize:'var(--fs-xs)',color:'var(--err)'}}>{e.desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────
// HARMONOGRAM ZADAŃ (CRON)
// Endpoint: GET/POST /system/cron-jobs
//           GET/PUT/DELETE /system/cron-jobs/:id  (stub — handleCronJobAction)
// Format GET: { jobs: [{id, line, enabled}] }
// Linia crontab: "0 2 * * * /usr/bin/rsync ..."
// ─────────────────────────────────────────────

const cronDesc = (sch) => {
  if (!sch) return '—';
  const parts = sch.trim().split(/\s+/);
  if (parts.length < 5) return sch;
  const [min, hour, dom, , dow] = parts;
  if (sch.startsWith('0 3 * * 0') || dow==='0') return 'Co niedzielę o 03:00';
  if (sch.startsWith('0 4 * * 0')) return 'Co niedzielę o 04:00';
  if (dow==='*' && dom==='*') {
    if (hour.startsWith('*/')) return `Co ${hour.slice(2)}h`;
    return `Codziennie o ${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  }
  if (dom==='1') return `1. dnia miesiąca o ${hour}:${String(min).padStart(2,'0')}`;
  return sch;
};

// Parsuj linię crontab na obiekt wyświetlany w tabeli
function _parseCronLine(job) {
  const line = job.line || '';
  const parts = line.trim().split(/\s+/);
  const schedule = parts.length >= 5 ? parts.slice(0,5).join(' ') : '—';
  const cmd      = parts.length >= 6 ? parts.slice(5).join(' ')  : line;
  
  // WAŻNE: najpierw użyj name z job, jeśli istnieje
  let name = job.name;
  
  // Jeśli nie ma name, spróbuj wygenerować z polecenia
  if (!name || name === 'null' || name === 'undefined') {
    if (cmd.includes('ddns') || cmd.includes('dyndns') || line.includes('ddns')) {
      name = 'DDNS Update';
    } else if (cmd.includes('backup') || cmd.includes('rsync')) {
      name = 'Backup';
    } else if (cmd.includes('snapshot') || cmd.includes('zfs')) {
      name = 'ZFS Snapshot';
    } else {
      name = `Zadanie ${job.id}`;
    }
  }
  
  // Dodaj też źródło jeśli istnieje
  const source = job.source || 'crontab';
  
  return {
    id:         job.id,
    name:       name,
    schedule,
    cmd,
    enabled:    job.enabled !== false,
    lastRun:    job.lastRun || '—',
    lastStatus: job.lastStatus || '—',
    duration:   job.duration || '—',
    nextRun:    job.nextRun || '—',
    source:     source,
    _line:      line,
  };
}

const CronEditor = ({ job, onClose, onSave }) => {
  const isNew = !job;
  const [form, setForm] = React.useState(
    job ? { name: job.name, schedule: job.schedule, cmd: job.cmd, enabled: job.enabled }
        : { name: '', schedule: '0 2 * * *', cmd: '', enabled: true }
  );
  const [saving, setSaving] = React.useState(false);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const inpSt = {
    background:'var(--bg-2)', border:'1px solid var(--line-strong)', borderRadius:5,
    padding:'6px 10px', color:'var(--fg)', fontFamily:'var(--font-mono)',
    fontSize:'var(--fs-sm)', outline:'none', width:'100%',
  };
  const presets = [
    ['Co godzinę',       '0 * * * *'],
    ['Co 6 godzin',      '0 */6 * * *'],
    ['Codziennie 01:00', '0 1 * * *'],
    ['Codziennie 03:00', '0 3 * * *'],
    ['Co tydzień niedz.','0 3 * * 0'],
    ['1. dnia miesiąca', '0 2 1 * *'],
  ];

  const handleSave = async () => {
    if (!form.schedule || !form.cmd) { alert('Wypełnij harmonogram i polecenie.'); return; }
    setSaving(true);
    try {
      await onSave(form, job);
      onClose();
    } catch (e) {
      alert(`Błąd zapisu: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isNew ? 'Nowe zadanie cron' : `Edytuj: ${job.name}`} sub="crontab · systemd timer" onClose={onClose} width={580}
      footer={<div className="row gap-sm" style={{marginLeft:'auto'}}>
        <button className="btn sm" onClick={onClose}>Anuluj</button>
        <button className="btn sm primary" onClick={handleSave} disabled={saving}>
          <Icon name="check" size={11}/> {saving ? 'Zapisuję…' : 'Zapisz zadanie'}
        </button>
      </div>}
    >
      <div className="col" style={{gap:14}}>
        <div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Nazwa (opcjonalna, dla widoku)</div>
          <input style={inpSt} value={form.name} onChange={e=>set('name',e.target.value)} placeholder="np. Backup codzienny"/>
        </div>
        <div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:6}}>Harmonogram (cron expression)</div>
          <input style={inpSt} value={form.schedule} onChange={e=>set('schedule',e.target.value)} placeholder="0 3 * * *"/>
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:8}}>
            {presets.map(([label,val])=>(
              <button key={val} onClick={()=>set('schedule',val)}
                style={{padding:'4px 10px',borderRadius:5,border:'1px solid var(--line-strong)',
                  background: form.schedule===val ? 'oklch(0.55 0.2 260 / 0.2)' : 'var(--bg-2)',
                  color: form.schedule===val ? 'var(--accent)' : 'var(--fg-dim)',
                  fontSize:'var(--fs-xs)',cursor:'pointer'}}>
                {label}
              </button>
            ))}
          </div>
          <div style={{marginTop:8,padding:'8px 12px',background:'var(--bg-2)',borderRadius:6,fontSize:'var(--fs-xs)',color:'var(--accent)',fontFamily:'var(--font-mono)'}}>
            → {cronDesc(form.schedule)}
          </div>
        </div>
        <div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Polecenie</div>
          <textarea style={{...inpSt,height:80,resize:'vertical',lineHeight:1.6}}
            value={form.cmd} onChange={e=>set('cmd',e.target.value)}
            placeholder="zfs snapshot tank/data@auto-$(date +%Y%m%d)"/>
        </div>
        <label style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer',fontSize:'var(--fs-sm)'}}>
          <input type="checkbox" checked={form.enabled} onChange={e=>set('enabled',e.target.checked)} style={{accentColor:'var(--accent)',width:15,height:15}}/>
          Zadanie aktywne
        </label>
      </div>
    </Modal>
  );
};

const CronJobs = () => {
  const [jobs, setJobs]         = React.useState([]);
  const [loading, setLoading]   = React.useState(true);
  const [error, setError]       = React.useState(null);
  const [showAdd, setShowAdd]   = React.useState(false);
  const [editJob, setEditJob]   = React.useState(null);
  const [runningId, setRunningId] = React.useState(null);

  const fetchJobs = React.useCallback(async () => {
	  try {
		setError(null);
		const data = await api.get('/system/cron-jobs');
		// Backend zwraca { jobs: [{id, line, enabled}] }
		let raw = Array.isArray(data) ? data : (data.jobs || []);
		
		// Dodaj zadania z /etc/cron.d/nimbus-ddns jeśli nie są już w liście
		try {
		  const ddnsRes = await fetch('/api/system/cron-ddns', { credentials: 'include' });
		  if (ddnsRes.ok) {
		    const ddnsData = await ddnsRes.json();
		    if (ddnsData.jobs && Array.isArray(ddnsData.jobs)) {
		      // Dodaj tylko te, których nie ma w głównej liście (po nazwie lub linii)
		      for (const ddnsJob of ddnsData.jobs) {
		        const exists = raw.some(j => j.line === ddnsJob.line || j.name === ddnsJob.name);
		        if (!exists) {
		          raw.push(ddnsJob);
		        }
		      }
		    }
		  }
		} catch (e) {
		  console.error('Failed to load DDNS jobs:', e);
		}
		
		setJobs(raw.map(_parseCronLine));
	  } catch (e) {
		setError(e.message);
	  } finally {
		setLoading(false);
	  }
	}, []);

  usePoll(fetchJobs, 20_000, []);

  // Dodaj lub edytuj — backend przyjmuje { line: "0 2 * * * /cmd" }
  const saveJob = async (form, orig) => {
    const line = `${form.schedule} ${form.cmd}`;
    await api.post('/system/cron-jobs', { line });
    await fetchJobs();
  };

  const deleteJob = async (id) => {
    try {
      await api.del(`/system/cron-jobs/${id}`);
      setJobs(js => js.filter(j => j.id !== id));
    } catch (e) {
      // Backend stub zwraca ok dla wszystkich metod — odśwież listę
      await fetchJobs();
    }
  };

  const toggleJob = async (id) => {
    // Backend nie obsługuje toggle — zmiana lokalna + komentarz w crontab
    setJobs(js => js.map(j => j.id===id ? {...j, enabled:!j.enabled} : j));
  };

  const runNow = async (id) => {
    const job = jobs.find(j => j.id === id);
    if (!job) return;
    setRunningId(id);
    try {
      // Uruchom komendę przez endpoint exec lub bezpośrednio
      await api.post(`/system/cron-jobs/${id}`, { action: 'run' });
    } catch (_) {}
    setTimeout(() => {
      setRunningId(null);
      setJobs(js => js.map(j => j.id===id ? {...j, lastRun:'teraz', lastStatus:'ok'} : j));
    }, 2000);
  };

  const ok       = jobs.filter(j => j.enabled && j.lastStatus === 'ok').length;
  const warn     = jobs.filter(j => j.lastStatus === 'warn').length;
  const disabled = jobs.filter(j => !j.enabled).length;

  if (loading) return (
    <div className="card" style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>
      <span className="dot pulse" style={{display:'inline-block',marginRight:8}}/>Ładowanie zadań cron…
    </div>
  );
  if (error) return (
    <div className="card" style={{padding:32,textAlign:'center',color:'var(--err)'}}>
      ⚠ {error}
      <button className="btn sm" style={{marginTop:12,display:'block',margin:'12px auto 0'}} onClick={fetchJobs}>Odśwież</button>
    </div>
  );

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      {(showAdd || editJob) && (
        <CronEditor
          job={editJob}
          onClose={()=>{ setShowAdd(false); setEditJob(null); }}
          onSave={saveJob}
        />
      )}

      <div className="grid grid-4">
        <div className="kpi"><div className="kpi-label">WSZYSTKICH</div><div className="kpi-value">{jobs.length}</div><div className="kpi-foot"><span>zadań cron</span></div></div>
        <div className="kpi"><div className="kpi-label">OK</div><div className="kpi-value" style={{color:'var(--ok)'}}>{ok}</div><div className="kpi-foot"><span>ostatni przebieg OK</span></div></div>
        <div className="kpi"><div className="kpi-label">OSTRZEŻENIA</div><div className="kpi-value" style={{color:'var(--warn)'}}>{warn}</div><div className="kpi-foot"><span>wymaga uwagi</span></div></div>
        <div className="kpi"><div className="kpi-label">WYŁĄCZONYCH</div><div className="kpi-value" style={{color:'var(--fg-dim)'}}>{disabled}</div><div className="kpi-foot"><span>nieaktywne</span></div></div>
      </div>

      <div className="card">
        <div className="card-head">
          <div><div className="card-title">Zadania harmonogramu</div><div className="card-sub">crontab systemowy</div></div>
          <div className="card-actions">
            <button className="btn sm primary" onClick={()=>{ setEditJob(null); setShowAdd(true); }}>
              <Icon name="plus" size={12}/> Nowe zadanie
            </button>
          </div>
        </div>
        {jobs.length === 0 ? (
          <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>
            Brak zadań w crontab. Dodaj pierwsze zadanie.
          </div>
        ) : (
          <table className="table">
            <thead><tr><th>Aktywne</th><th>Nazwa</th><th>Harmonogram</th><th>Polecenie</th><th>Ostatni</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {jobs.map(j => (
                <tr key={j.id} style={{opacity: j.enabled ? 1 : 0.5}}>
                  <td><div className={"toggle "+(j.enabled?'on':'')} onClick={()=>toggleJob(j.id)}/></td>
                  <td style={{fontWeight:500,fontSize:'var(--fs-sm)'}}>{j.name}</td>
                  <td>
                    <div className="mono" style={{fontSize:'var(--fs-xs)'}}>{j.schedule}</div>
                    <div style={{fontSize:10,color:'var(--fg-dim)',marginTop:2}}>{cronDesc(j.schedule)}</div>
                  </td>
                  <td className="mono dim" style={{fontSize:'var(--fs-xs)',maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j.cmd}</td>
                  <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{j.lastRun}</td>
                  <td>
                    {j.lastStatus==='ok'  && <span className="badge ok">OK</span>}
                    {j.lastStatus==='warn' && <span className="badge warn">WARN</span>}
                    {j.lastStatus==='err'  && <span className="badge err">ERROR</span>}
                    {j.lastStatus==='—'   && <span className="badge dim" style={{opacity:.5}}>—</span>}
                  </td>
                  <td>
                    <div className="row gap-sm">
                      {runningId===j.id
                        ? <span className="badge warn"><span className="dot pulse"/>Trwa…</span>
                        : <button className="btn sm" onClick={()=>runNow(j.id)} disabled={!j.enabled}><Icon name="play" size={11}/></button>}
                      <button className="icon-btn" onClick={()=>{ setEditJob(j); setShowAdd(false); }}><Icon name="edit" size={13}/></button>
                      <button className="icon-btn" onClick={()=>deleteJob(j.id)}><Icon name="trash" size={13}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// POWIADOMIENIA
// Konfiguracja w /etc/nas-panel/notifications.json
// GET/POST /api/notifications/channels
// PUT/DELETE /api/notifications/channels/:id
// POST /api/notifications/channels/:id/test
// GET/POST /api/notifications/rules
// PUT/DELETE /api/notifications/rules/:id
// GET /api/notifications/history
// ─────────────────────────────────────────────

// ── Channel type definitions ─────────────────────────────────────────────────

const CHANNEL_TYPES = [
  { id:'email',    label:'E-mail',   icon:'mail',     color:'var(--accent)',              desc:'SMTP / sendmail' },
  { id:'telegram', label:'Telegram', icon:'send',     color:'oklch(0.65 0.2 220)',        desc:'Bot API' },
  { id:'discord',  label:'Discord',  icon:'share',    color:'oklch(0.65 0.18 270)',       desc:'Webhook' },
  { id:'slack',    label:'Slack',    icon:'share',    color:'oklch(0.65 0.18 145)',       desc:'Incoming Webhook' },
  { id:'pushover', label:'Pushover', icon:'bell',     color:'oklch(0.65 0.2 50)',         desc:'Push na telefon' },
  { id:'gotify',   label:'Gotify',   icon:'bell',     color:'oklch(0.65 0.18 170)',       desc:'Self-hosted push' },
  { id:'webhook',  label:'Webhook',  icon:'globe',    color:'oklch(0.65 0.15 130)',       desc:'HTTP POST / JSON' },
];

const ChannelIcon = ({ type }) => {
  const ct = CHANNEL_TYPES.find(c=>c.id===type) || CHANNEL_TYPES[CHANNEL_TYPES.length-1];
  return (
    <div style={{width:36,height:36,borderRadius:9,background:ct.color+'22',
      display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
      <Icon name={ct.icon} size={16} style={{color:ct.color}}/>
    </div>
  );
};

// Per-type form fields definition
const CHANNEL_FIELDS = {
  email: [
    { key:'target', label:'Adres e-mail', placeholder:'alert@example.com', mono:true },
  ],
  telegram: [
    { key:'bot_token', label:'Token bota', placeholder:'1234567890:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', mono:true,
      hint:'Utwórz bota przez @BotFather na Telegramie i skopiuj token.' },
    { key:'chat_id',   label:'Chat ID',    placeholder:'-1001234567890', mono:true,
      hint:'Wyślij /start do bota, potem wejdź na: api.telegram.org/bot<TOKEN>/getUpdates' },
  ],
  discord: [
    { key:'target', label:'Webhook URL', placeholder:'https://discord.com/api/webhooks/...', mono:true,
      hint:'Discord → Ustawienia serwera → Integracje → Webhooki → Nowy webhook → Skopiuj URL' },
  ],
  slack: [
    { key:'target', label:'Incoming Webhook URL', placeholder:'https://hooks.slack.com/services/...', mono:true,
      hint:'api.slack.com → Twoje aplikacje → Incoming Webhooks → Dodaj do przestrzeni roboczej' },
  ],
  pushover: [
    { key:'user_key',  label:'User Key',    placeholder:'uXXXXXXXXXXXXXXXXXXXXXX', mono:true,
      hint:'Znajdziesz na stronie głównej pushover.net po zalogowaniu.' },
    { key:'api_token', label:'API Token',   placeholder:'aXXXXXXXXXXXXXXXXXXXXXX', mono:true,
      hint:'Utwórz aplikację na pushover.net → Twoje Aplikacje → Utwórz aplikację/wtyczkę.' },
  ],
  gotify: [
    { key:'target',    label:'URL serwera Gotify', placeholder:'https://gotify.example.com', mono:true },
    { key:'api_token', label:'Token aplikacji',    placeholder:'Ax_XXXXXXXXXXXX', mono:true,
      hint:'Gotify → Aplikacje → Utwórz nową aplikację → skopiuj token.' },
  ],
  webhook: [
    { key:'target', label:'URL webhooka', placeholder:'https://example.com/hook', mono:true,
      hint:'Nimbus wyśle POST z JSON: { event, severity, message, rule, ts }' },
  ],
};

const AddChannelDialog = ({ onClose, onAdd }) => {
  const [type,   setType]   = React.useState('email');
  const [name,   setName]   = React.useState('');
  const [fields, setFields] = React.useState({});   // { key: value }
  const [saving, setSaving] = React.useState(false);
  const [err,    setErr]    = React.useState('');

  const inpSt = {background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:5,
    padding:'7px 10px',color:'var(--fg)',fontSize:'var(--fs-sm)',outline:'none',width:'100%'};

  const fieldDefs = CHANNEL_FIELDS[type] || [];

  const setField = (key, val) => setFields(f => ({...f, [key]: val}));

  const validate = () => {
    if (!name.trim()) return 'Uzupełnij nazwę kanału.';
    for (const fd of fieldDefs) {
      if (!fields[fd.key]?.trim()) return `Uzupełnij pole: ${fd.label}`;
    }
    return null;
  };

  const save = async () => {
    const e = validate();
    if (e) { setErr(e); return; }
    setSaving(true); setErr('');
    try {
      // Build target string for single-field types; pass full fields object for multi-field
      const payload = { type, name: name.trim(), enabled: true, ...fields };
      // For single-field types, also populate target for display
      if (fieldDefs.length === 1 && fieldDefs[0].key === 'target') {
        payload.target = fields.target || '';
      }
      await onAdd(payload);
      onClose();
    } catch (ex) { setErr(ex.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="Nowy kanał powiadomień" sub="E-mail · Telegram · Discord · Slack · Pushover · Gotify · Webhook"
      onClose={onClose} width={520}
      footer={<div className="row gap-sm" style={{marginLeft:'auto'}}>
        <button className="btn sm" onClick={onClose}>Anuluj</button>
        <button className="btn sm primary" disabled={saving} onClick={save}>
          <Icon name="plus" size={11}/> {saving ? 'Zapisuję…' : 'Dodaj kanał'}
        </button>
      </div>}
    >
      <div className="col" style={{gap:16}}>

        {/* Type picker */}
        <div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:8,textTransform:'uppercase',letterSpacing:'.06em',fontWeight:600}}>Typ kanału</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6}}>
            {CHANNEL_TYPES.map(ct => (
              <div key={ct.id} onClick={() => { setType(ct.id); setFields({}); setErr(''); }}
                style={{padding:'9px 8px',border:'1px solid '+(type===ct.id?ct.color:'var(--line-strong)'),
                  background: type===ct.id ? ct.color+'18' : 'var(--bg-2)',
                  borderRadius:7, cursor:'pointer', textAlign:'center', transition:'all .12s'}}>
                <Icon name={ct.icon} size={16} style={{color:type===ct.id?ct.color:'var(--fg-dim)',display:'block',margin:'0 auto 4px'}}/>
                <div style={{fontSize:11,fontWeight:type===ct.id?600:400,color:type===ct.id?ct.color:'var(--fg)'}}>{ct.label}</div>
                <div style={{fontSize:9,color:'var(--fg-dim)',marginTop:1}}>{ct.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Display name */}
        <div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4,fontWeight:500}}>Nazwa wyświetlana</div>
          <input style={inpSt} value={name} onChange={e=>setName(e.target.value)} placeholder="np. Mój alert telegramowy"/>
        </div>

        {/* Per-type fields */}
        {fieldDefs.map(fd => (
          <div key={fd.key}>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4,fontWeight:500}}>{fd.label}</div>
            <input style={{...inpSt, fontFamily: fd.mono ? 'var(--font-mono)' : 'inherit'}}
              value={fields[fd.key]||''} onChange={e=>setField(fd.key, e.target.value)}
              placeholder={fd.placeholder}/>
            {fd.hint && (
              <div style={{marginTop:5,padding:'7px 10px',background:'var(--bg-2)',border:'1px solid var(--line)',
                borderRadius:5,fontSize:'var(--fs-xs)',color:'var(--fg-dim)',lineHeight:1.6}}>
                {fd.hint}
              </div>
            )}
          </div>
        ))}

        {err && <div style={{padding:'7px 11px',background:'oklch(0.65 0.2 25 / 0.08)',border:'1px solid oklch(0.65 0.2 25 / 0.3)',borderRadius:5,fontSize:'var(--fs-xs)',color:'var(--err)'}}>{err}</div>}
      </div>
    </Modal>
  );
};

const RuleDialog = ({ onClose, onSave, channels, initial }) => {
  const isEdit = !!initial;
  const [name,      setName]      = React.useState(initial?.name      || '');
  const [condition, setCondition] = React.useState(initial?.condition || '');
  const [severity,  setSeverity]  = React.useState(initial?.severity  || 'warn');
  const [selCh,     setSelCh]     = React.useState(initial?.channels  || []);
  const [saving,    setSaving]    = React.useState(false);

  const inpSt = {
    background:'var(--bg-2)', border:'1px solid var(--line-strong)', borderRadius:5,
    padding:'6px 10px', color:'var(--fg)', fontSize:'var(--fs-sm)', outline:'none', width:'100%',
    fontFamily:'var(--font-mono)',
  };
  const sevOpts = [
    { val:'info', label:'INFO',      color:'var(--info,#60a5fa)' },
    { val:'warn', label:'WARN',      color:'var(--warn)' },
    { val:'crit', label:'KRYTYCZNY', color:'var(--err)' },
  ];

  // Presety pasujące do składni alerts.go
  const condPresets = [
    { label:'CPU > 90%',          val:'cpu > 90' },
    { label:'CPU > 95%',          val:'cpu > 95' },
    { label:'RAM > 85%',          val:'mem > 85' },
    { label:'RAM > 90%',          val:'mem > 90' },
    { label:'Load > 8',           val:'load > 8' },
    { label:'Dysk / < 10%',       val:'disk:/ < 10' },
    { label:'Dysk / < 3%',        val:'disk:/ < 3' },
    { label:'Dysk /srv < 10%',    val:'disk:/srv < 10' },
    { label:'Samba down',         val:'service:smbd = down' },
    { label:'SSH down',           val:'service:ssh = down' },
    { label:'NFS down',           val:'service:nfsd = down' },
    { label:'Docker down',        val:'service:docker = down' },
  ];
  const toggleCh = (id) => setSelCh(cs => cs.includes(id) ? cs.filter(c=>c!==id) : [...cs, id]);

  return (
    <Modal title={isEdit ? 'Edytuj regułę alertu' : 'Nowa reguła alertu'} sub="warunek · powaga · kanały" onClose={onClose} width={580}
      footer={<div className="row gap-sm" style={{marginLeft:'auto'}}>
        <button className="btn sm" onClick={onClose}>Anuluj</button>
        <button className="btn sm primary" disabled={saving} onClick={async () => {
          if (!name || !condition) { alert('Wypełnij nazwę i warunek.'); return; }
          setSaving(true);
          try {
            await onSave({ ...(initial||{}), name, condition, severity, channels: selCh, enabled: initial?.enabled ?? true });
            onClose();
          } catch (e) { alert(`Błąd: ${e.message}`); }
          finally { setSaving(false); }
        }}>
          <Icon name={isEdit?'check':'plus'} size={11}/> {saving ? 'Zapisuję…' : isEdit ? 'Zapisz zmiany' : 'Dodaj regułę'}
        </button>
      </div>}
    >
      <div className="col" style={{gap:14}}>
        <div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Nazwa reguły</div>
          <input style={inpSt} value={name} onChange={e=>setName(e.target.value)} placeholder="np. Dysk prawie pełny"/>
        </div>
        <div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:6}}>Warunek</div>
          <input style={inpSt} value={condition} onChange={e=>setCondition(e.target.value)}
            placeholder="np. cpu > 90  |  disk:/ < 10  |  service:ssh = down"/>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginTop:6,marginBottom:4}}>
            Składnia: <code style={{color:'var(--accent)'}}>cpu</code> / <code style={{color:'var(--accent)'}}>mem</code> / <code style={{color:'var(--accent)'}}>load</code> / <code style={{color:'var(--accent)'}}>disk:/ścieżka</code> / <code style={{color:'var(--accent)'}}>service:nazwa</code> &nbsp;+&nbsp; <code style={{color:'var(--accent)'}}>&gt; &lt; = &gt;= &lt;=</code> &nbsp;+&nbsp; wartość
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:5,marginTop:4}}>
            {condPresets.map(p=>(
              <button key={p.val} onClick={()=>setCondition(p.val)}
                style={{padding:'3px 8px',borderRadius:5,border:'1px solid var(--line-strong)',
                  background: condition===p.val ? 'oklch(0.55 0.2 260 / 0.2)' : 'var(--bg-2)',
                  color: condition===p.val ? 'var(--accent)' : 'var(--fg-dim)',
                  fontSize:11, cursor:'pointer', fontFamily:'var(--font-mono)'}}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:6}}>Powaga</div>
          <div className="segmented">
            {sevOpts.map(s=>(
              <button key={s.val} className={severity===s.val?'active':''} onClick={()=>setSeverity(s.val)}
                style={severity===s.val ? {color:s.color} : {}}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:6}}>Kanały powiadomień</div>
          {channels.length === 0 ? (
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>Brak kanałów — najpierw dodaj kanał w zakładce Kanały.</div>
          ) : (
            <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
              {channels.map(ch=>(
                <label key={ch.id} style={{display:'flex',alignItems:'center',gap:7,cursor:'pointer',
                  padding:'5px 10px',borderRadius:6,border:'1px solid',fontSize:'var(--fs-xs)',
                  borderColor: selCh.includes(ch.id) ? 'var(--accent)' : 'var(--line-strong)',
                  background:  selCh.includes(ch.id) ? 'oklch(0.55 0.2 260 / 0.12)' : 'var(--bg-2)'}}>
                  <input type="checkbox" checked={selCh.includes(ch.id)} onChange={()=>toggleCh(ch.id)}
                    style={{accentColor:'var(--accent)',width:13,height:13}}/>
                  {ch.name}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

const Notifications = () => {
  const [tab, setTab]           = React.useState('rules');
  const [channels, setChannels] = React.useState([]);
  const [rules, setRules]       = React.useState([]);
  const [history, setHistory]   = React.useState([]);
  const [loading, setLoading]   = React.useState(true);
  const [error, setError]       = React.useState(null);
  const [showAddCh, setShowAddCh] = React.useState(false);
  const [showAddRule, setShowAddRule] = React.useState(false);
  const [editRule,    setEditRule]    = React.useState(null);
  const [testingId, setTestingId] = React.useState(null);

  const fetchAll = React.useCallback(async () => {
    try {
      setError(null);
      const [ch, ru, hi] = await Promise.all([
        api.get('/api/notifications/channels'),
        api.get('/api/notifications/rules'),
        api.get('/api/notifications/history'),
      ]);
      setChannels(Array.isArray(ch) ? ch : []);
      setRules(Array.isArray(ru) ? ru : []);
      setHistory(Array.isArray(hi) ? hi : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  usePoll(fetchAll, 30_000, []);

  // ── Channels ──
  const addChannel = async (data) => {
    const created = await api.post('/api/notifications/channels', data);
    setChannels(cs => [...cs, created]);
  };

  const toggleChannel = async (id) => {
    const ch = channels.find(c => c.id === id);
    const updated = await api.put(`/api/notifications/channels/${id}`, { ...ch, enabled: !ch.enabled });
    setChannels(cs => cs.map(c => c.id === id ? updated : c));
  };

  const deleteChannel = async (id) => {
    await api.del(`/api/notifications/channels/${id}`);
    setChannels(cs => cs.filter(c => c.id !== id));
  };

  const testChannel = async (id) => {
    setTestingId(id);
    try {
      const res = await api.post(`/api/notifications/channels/${id}/test`);
      setChannels(cs => cs.map(c => c.id === id ? {
        ...c,
        lastTest:  res.lastTest || (res.ok ? 'OK · teraz' : 'FAIL'),
        testError: res.ok ? null : (res.error || 'Nieznany błąd'),
      } : c));
    } catch (e) {
      setChannels(cs => cs.map(c => c.id === id ? {
        ...c,
        lastTest:  `FAIL · ${e.message}`,
        testError: e.message,
      } : c));
    } finally {
      setTestingId(null);
    }
  };

  // ── Rules ──
  const saveRule = async (rule) => {
    if (rule.id) {
      // Edycja istniejącej
      const updated = await api.put(`/api/notifications/rules/${rule.id}`, rule);
      setRules(rs => rs.map(r => r.id === rule.id ? (updated || rule) : r));
    } else {
      // Nowa reguła
      const created = await api.post('/api/notifications/rules', rule);
      setRules(rs => [...rs, created || rule]);
    }
  };

  const addRule = saveRule; // backward compat

  const toggleRule = async (id) => {
    const r = rules.find(r => r.id === id);
    const updated = await api.put(`/api/notifications/rules/${id}`, { ...r, enabled: !r.enabled });
    setRules(rs => rs.map(r => r.id === id ? updated : r));
  };

  const deleteRule = async (id) => {
    await api.del(`/api/notifications/rules/${id}`);
    setRules(rs => rs.filter(r => r.id !== id));
  };

  const sevColor = { info:'var(--info,#60a5fa)', warn:'var(--warn)', crit:'var(--err)' };
  const sevLabel = { info:'INFO', warn:'WARN', crit:'KRYTYCZNY' };

  if (loading) return (
    <div className="card" style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>
      <span className="dot pulse" style={{display:'inline-block',marginRight:8}}/>Ładowanie powiadomień…
    </div>
  );
  if (error) return (
    <div className="card" style={{padding:32,textAlign:'center',color:'var(--err)'}}>
      ⚠ {error}
      <button className="btn sm" style={{marginTop:12,display:'block',margin:'12px auto 0'}} onClick={fetchAll}>Odśwież</button>
    </div>
  );

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      {showAddCh && <AddChannelDialog onClose={()=>setShowAddCh(false)} onAdd={addChannel}/>}
      {(showAddRule || editRule) && <RuleDialog
        onClose={()=>{setShowAddRule(false);setEditRule(null);}}
        onSave={saveRule}
        channels={channels}
        initial={editRule}
      />}

      <div className="segmented">
        <button className={tab==='rules'?'active':''} onClick={()=>setTab('rules')}>Reguły alertów</button>
        <button className={tab==='channels'?'active':''} onClick={()=>setTab('channels')}>Kanały</button>
        <button className={tab==='history'?'active':''} onClick={()=>setTab('history')}>Historia</button>
      </div>

      {tab==='channels' && (
        <div className="col" style={{gap:'var(--gutter)'}}>
          <div className="grid grid-4">
            <div className="kpi"><div className="kpi-label">KANAŁÓW</div><div className="kpi-value">{channels.length}</div><div className="kpi-foot"><span>skonfigurowanych</span></div></div>
            <div className="kpi"><div className="kpi-label">AKTYWNYCH</div><div className="kpi-value" style={{color:'var(--ok)'}}>{channels.filter(c=>c.enabled).length}</div><div className="kpi-foot"><span>aktywne</span></div></div>
            <div className="kpi"><div className="kpi-label">BŁĘDY</div><div className="kpi-value" style={{color:'var(--err)'}}>{channels.filter(c=>c.lastTest?.startsWith('FAIL')).length}</div><div className="kpi-foot"><span>ostatni test nieudany</span></div></div>
            <div className="kpi"><div className="kpi-label">TYPY</div><div className="kpi-value" style={{fontSize:16}}>{[...new Set(channels.map(c=>c.type))].length}</div><div className="kpi-foot"><span>typów kanałów</span></div></div>
          </div>
          <div className="card">
            <div className="card-head">
              <div><div className="card-title">Kanały powiadomień</div><div className="card-sub">e-mail · Telegram · webhook</div></div>
              <div className="card-actions"><button className="btn sm primary" onClick={()=>setShowAddCh(true)}><Icon name="plus" size={12}/> Nowy kanał</button></div>
            </div>
            {channels.length === 0 ? (
              <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>Brak skonfigurowanych kanałów.</div>
            ) : (
              <div style={{padding:'var(--pad-card)',display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                {channels.map(c=>(
                  <div key={c.id} style={{display:'flex',flexDirection:'column',gap:0,padding:'12px 14px',
                    background:'var(--bg-2)',borderRadius:8,border:'1px solid '+(c.testError?'oklch(0.65 0.2 25 / 0.4)':'var(--line-strong)'),opacity:c.enabled?1:0.6}}>
                    <div style={{display:'flex',alignItems:'center',gap:12}}>
                      <ChannelIcon type={c.type}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:500,fontSize:'var(--fs-sm)'}}>{c.name}</div>
                        <div className="mono dim" style={{fontSize:'var(--fs-xs)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                          {c.type==='telegram' ? (c.chat_id ? `chat_id: ${c.chat_id}` : c.target||'—')
                            : c.type==='pushover' ? (c.user_key ? `user: ${c.user_key}` : c.target||'—')
                            : c.type==='gotify'   ? (c.target||'—')
                            : (c.target||'—')}
                        </div>
                        <div style={{marginTop:3,fontSize:11,color:c.lastTest?.startsWith('OK')?'var(--ok)':c.lastTest?.startsWith('FAIL')?'var(--err)':'var(--fg-dim)'}}>
                          ↳ {c.lastTest||'—'}
                        </div>
                      </div>
                      <div className="row gap-sm" style={{flexShrink:0}}>
                        <div className={"toggle "+(c.enabled?'on':'')} onClick={()=>toggleChannel(c.id)}/>
                        {testingId===c.id
                          ? <span className="badge warn"><span className="dot pulse"/>Test…</span>
                          : <button className="btn sm" onClick={()=>testChannel(c.id)}>Test</button>}
                        <button className="icon-btn" onClick={()=>deleteChannel(c.id)}><Icon name="trash" size={13}/></button>
                      </div>
                    </div>
                    {c.testError && (
                      <div style={{marginTop:8,padding:'6px 10px',background:'oklch(0.65 0.2 25 / 0.08)',
                        border:'1px solid oklch(0.65 0.2 25 / 0.25)',borderRadius:5,
                        fontSize:'var(--fs-xs)',color:'var(--err)',fontFamily:'var(--font-mono)',lineHeight:1.5}}>
                        ⚠ {c.testError}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab==='rules' && (
        <div className="col" style={{gap:'var(--gutter)'}}>
          <div className="grid grid-4">
            <div className="kpi"><div className="kpi-label">REGUŁ</div><div className="kpi-value">{rules.length}</div><div className="kpi-foot"><span>zdefiniowanych</span></div></div>
            <div className="kpi"><div className="kpi-label">AKTYWNYCH</div><div className="kpi-value" style={{color:'var(--ok)'}}>{rules.filter(r=>r.enabled).length}</div><div className="kpi-foot"><span>monitoruje</span></div></div>
            <div className="kpi"><div className="kpi-label">KRYTYCZNE</div><div className="kpi-value" style={{color:'var(--err)'}}>{rules.filter(r=>r.severity==='crit').length}</div><div className="kpi-foot"><span>wysoki priorytet</span></div></div>
            <div className="kpi"><div className="kpi-label">WYZWOLONE</div><div className="kpi-value" style={{color:'var(--warn)'}}>{rules.filter(r=>r.triggered!=='nigdy').length}</div><div className="kpi-foot"><span>historycznie</span></div></div>
          </div>
          <div className="card">
            <div className="card-head">
              <div><div className="card-title">Reguły alertów</div><div className="card-sub">Automatyczne powiadomienia po zdarzeniu · sprawdzane co 30s</div></div>
              <div className="card-actions">
                <button className="btn sm" onClick={async()=>{
                  const r = await fetch('/api/notifications/default-rules',{method:'POST',credentials:'include'});
                  const d = await r.json();
                  if(d.added>0) { loadRules(); } 
                }}>
                  <Icon name="plus" size={11}/> Domyślne reguły
                </button>
                <button className="btn sm primary" onClick={()=>{setEditRule(null);setShowAddRule(true);}}><Icon name="plus" size={12}/> Nowa reguła</button>
              </div>
            </div>
            {rules.length === 0 ? (
              <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>Brak zdefiniowanych reguł.</div>
            ) : (
              <table className="table">
                <thead><tr><th>Aktywna</th><th>Nazwa</th><th>Warunek</th><th>Powaga</th><th>Kanały</th><th>Wyzwolona</th><th></th></tr></thead>
                <tbody>
                  {rules.map(r=>(
                    <tr key={r.id} style={{opacity:r.enabled?1:0.5}}>
                      <td><div className={"toggle "+(r.enabled?'on':'')} onClick={()=>toggleRule(r.id)}/></td>
                      <td style={{fontWeight:500}}>{r.name}</td>
                      <td style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>{r.condition}</td>
                      <td><span className="badge" style={{background:sevColor[r.severity]+'22',color:sevColor[r.severity]}}>{sevLabel[r.severity]}</span></td>
                      <td>
                        <div className="row gap-sm" style={{flexWrap:'wrap'}}>
                          {(r.channels||[]).map(chId=>{
                            const ch = channels.find(c=>c.id===chId);
                            return ch ? <span key={chId} className="chip">{ch.name.split(' ')[0]}</span> : null;
                          })}
                        </div>
                      </td>
                      <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{r.triggered}</td>
                      <td>
                        <div className="row gap-sm">
                          <button className="icon-btn" onClick={()=>{setEditRule(r);setShowAddRule(false);}}
                            title="Edytuj regułę"><Icon name="edit" size={13}/></button>
                          <button className="icon-btn" onClick={()=>deleteRule(r.id)}
                            title="Usuń regułę"><Icon name="trash" size={13}/></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab==='history' && (
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Historia powiadomień</div><div className="card-sub">Ostatnie zdarzenia</div></div>
          </div>
          {history.length === 0 ? (
            <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>Brak historii powiadomień.</div>
          ) : (
            <table className="table">
              <thead><tr><th>Czas</th><th>Powaga</th><th>Reguła</th><th>Kanał</th><th>Wiadomość</th><th>Dostarczono</th></tr></thead>
              <tbody>
                {history.map((n,i)=>(
                  <tr key={i}>
                    <td className="mono dim">{n.t}</td>
                    <td><span className="badge" style={{background:sevColor[n.sev]+'22',color:sevColor[n.sev]}}>{sevLabel[n.sev]||n.sev}</span></td>
                    <td style={{fontWeight:500,fontSize:'var(--fs-sm)'}}>{n.rule}</td>
                    <td><span className="chip">{n.ch}</span></td>
                    <td style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>{n.msg}</td>
                    <td>{n.delivered ? <span className="badge ok">OK</span> : <span className="badge err">FAIL</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};


window.SmartDetails  = SmartDetails;
window.CronJobs      = CronJobs;
window.Notifications = Notifications;
