// ===== Users + Settings =====

const useStore = window.useStore;
const storeSet = window.storeSet;
const Icon = window.Icon;
const Docker = window.Docker;
const Terminal = window.Terminal;
const Storage = window.Storage;

const PERMISSIONS = [
  { id:'admin',    label:'Administracja systemem'    },
  { id:'storage',  label:'Magazyn i pule'            },
  { id:'docker',   label:'Kontenery Docker'          },
  { id:'network',  label:'Konfiguracja sieci'        },
  { id:'shares',   label:'Udziały SMB/NFS'           },
  { id:'users',    label:'Zarządzanie użytkownikami' },
  { id:'media',    label:'Serwery mediów'            },
  { id:'logs',     label:'Odczyt logów'              },
  { id:'terminal', label:'Dostęp SSH/Terminal'       },
];

const ROLE_DEFAULTS = {
  'Administrator': PERMISSIONS.map(p => p.id),
  'Operator':      ['storage','docker','shares','media','logs'],
  'Tylko odczyt':  ['logs','media'],
  'Service':       ['storage','shares'],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const avatarColor = (id='') => {
  const h1 = (id.charCodeAt(0)||0)*7  % 360;
  const h2 = (id.charCodeAt(0)||0)*13 % 360;
  return `linear-gradient(135deg, oklch(0.7 0.15 ${h1}), oklch(0.55 0.16 ${h2}))`;
};

const Field = ({ label, children }) => (
  <div className="col" style={{gap:4}}>
    <label className="dim" style={{fontSize:'var(--fs-xs)',textTransform:'uppercase',letterSpacing:'.06em',fontWeight:500}}>{label}</label>
    {children}
  </div>
);

const KV = ({ k, v }) => (
  <div className="row" style={{justifyContent:'space-between',gap:16}}>
    <span className="dim" style={{fontSize:'var(--fs-sm)'}}>{k}</span>
    <span style={{fontSize:'var(--fs-sm)'}}>{v}</span>
  </div>
);

const ToggleRow = ({ t, on }) => {
  const [v, setV] = React.useState(!!on);
  return (
    <div className="row" style={{justifyContent:'space-between'}}>
      <span>{t}</span>
      <div className={'toggle '+(v?'on':'')} onClick={()=>setV(!v)}/>
    </div>
  );
};

// ─── Parser użytkowników z API ────────────────────────────────────────────────
const parseUser = (u) => ({
  id:     u.login || u.Login || '?',
  name:   u.name  || u.Name  || u.login || '?',
  login:  u.login || u.Login || '?',
  uid:    u.uid   || u.UID   || 0,
  role:   (u.uid===0 || u.UID===0) ? 'Administrator' : 'Operator',
  groups: u.groups || u.Groups || [],
  shell:  u.shell  || u.Shell  || '/bin/bash',
  active: true,
  twofa:  false,
  last:   '—',
});

// ═══════════════════════════════════════════════════════════════════════════
// UserModal
// ═══════════════════════════════════════════════════════════════════════════

const UserModal = ({ user, onClose, onSave }) => {
  const [u, setU] = React.useState({...user, perms: user.perms || ROLE_DEFAULTS[user.role] || []});
  const [saving, setSaving] = React.useState(false);
  const [newPassword, setNewPassword] = React.useState('');

  const togglePerm = id =>
    setU(p => ({...p, perms: p.perms.includes(id) ? p.perms.filter(x=>x!==id) : [...p.perms, id]}));

  const setRole = role =>
    setU(p => ({...p, role, perms: [...(ROLE_DEFAULTS[role]||[])]}));

  const save = async () => {
    setSaving(true);
    try {
      if (u.id && u.id !== 'new') {
        // Istniejący użytkownik — PUT /api/system/users/{login}
        await fetch('/api/system/users/' + encodeURIComponent(u.login), {
          method: 'PUT', credentials: 'include',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            password: newPassword || undefined,
            shell:    u.shell,
            groups:   (u.groups||[]).join(','),
          }),
        }).catch(()=>{});
      } else {
        // Nowy użytkownik — POST /api/system/users
        await fetch('/api/system/users', {
          method: 'POST', credentials: 'include',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            username: u.login,
            password: newPassword,
            shell:    u.shell || '/bin/bash',
            groups:   (u.groups||[]).join(','),
          }),
        }).catch(()=>{});
      }
      onSave(u);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = () => {
    const pw = prompt('Nowe hasło dla ' + u.login + ':');
    if (!pw) return;
    fetch('/api/system/users/' + encodeURIComponent(u.login), {
      method:'PUT', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({password: pw}),
    }).then(() => alert('Hasło zmienione')).catch(() => alert('Błąd zmiany hasła'));
  };

  return (
    <div className="modal-back" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal" style={{width:'min(720px,95vw)'}} onClick={e=>e.stopPropagation()}>
        <div className="modal-head">
          <div className="row gap-md" style={{flex:1}}>
            <div className="avatar" style={{width:36,height:36,fontSize:13,background:avatarColor(u.id||u.login||'?')}}>
              {(u.name||u.login||'+').split(' ').map(s=>s[0]).join('').toUpperCase().slice(0,2)||'+'}
            </div>
            <div>
              <div style={{fontWeight:600,fontSize:15}}>{u.id&&u.id!=='new' ? 'Edytuj użytkownika' : 'Nowy użytkownik'}</div>
              <div className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{u.login||'login@nimbus'} {u.uid?`· UID ${u.uid}`:''}</div>
            </div>
          </div>
          <button className="icon-btn" style={{marginLeft:'auto'}} onClick={onClose}><Icon name="close" size={14}/></button>
        </div>

        <div className="modal-body col" style={{gap:16}}>
          {/* Dane podstawowe */}
          <div className="grid grid-2" style={{gap:12}}>
            <Field label="Imię i nazwisko">
              <input className="input" value={u.name} onChange={e=>setU({...u,name:e.target.value})}/>
            </Field>
            <Field label="Login">
              <input className="input mono" value={u.login} onChange={e=>setU({...u,login:e.target.value})}
                disabled={!!(u.id&&u.id!=='new')}/>
            </Field>
            <Field label="Nowe hasło (zostaw puste = bez zmian)">
              <input className="input" type="password" placeholder="••••••••"
                value={newPassword} onChange={e=>setNewPassword(e.target.value)}/>
            </Field>
            <Field label="Rola">
              <select className="select" value={u.role} onChange={e=>setRole(e.target.value)}>
                {Object.keys(ROLE_DEFAULTS).map(r=><option key={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Powłoka">
              <input className="input mono" value={u.shell} onChange={e=>setU({...u,shell:e.target.value})}/>
            </Field>
            <Field label="E-mail">
              <input className="input" placeholder={u.login+'@nimbus.lan'}/>
            </Field>
          </div>

          {/* Grupy */}
          {(u.groups||[]).length > 0 && (
            <div>
              <div className="dim" style={{fontSize:'var(--fs-xs)',textTransform:'uppercase',letterSpacing:'.06em',fontWeight:500,marginBottom:6}}>Grupy</div>
              <div className="row" style={{flexWrap:'wrap',gap:6}}>
                {u.groups.map(g=><span key={g} className="chip accent">{g}</span>)}
              </div>
            </div>
          )}

          {/* Macierz uprawnień */}
          <div>
            <div className="row" style={{justifyContent:'space-between',marginBottom:8}}>
              <div style={{fontWeight:600}}>Macierz uprawnień</div>
              <span className="dim mono" style={{fontSize:'var(--fs-xs)'}}>{u.perms.length} / {PERMISSIONS.length} aktywnych</span>
            </div>
            <table className="perm-grid" style={{width:'100%',borderCollapse:'collapse',fontSize:'var(--fs-sm)'}}>
              <thead>
                <tr>
                  <th style={{textAlign:'left',padding:'8px 10px',borderBottom:'1px solid var(--line)',fontSize:'var(--fs-xs)',textTransform:'uppercase',color:'var(--fg-muted)',fontWeight:500}}>Sekcja</th>
                  <th style={{padding:'8px 10px',borderBottom:'1px solid var(--line)',fontSize:'var(--fs-xs)',textTransform:'uppercase',color:'var(--fg-muted)',fontWeight:500}}>Odczyt</th>
                  <th style={{padding:'8px 10px',borderBottom:'1px solid var(--line)',fontSize:'var(--fs-xs)',textTransform:'uppercase',color:'var(--fg-muted)',fontWeight:500}}>Zapis</th>
                  <th style={{padding:'8px 10px',borderBottom:'1px solid var(--line)',fontSize:'var(--fs-xs)',textTransform:'uppercase',color:'var(--fg-muted)',fontWeight:500}}>Admin</th>
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS.map(p => {
                  const enabled = u.perms.includes(p.id);
                  const isAdmin = u.role === 'Administrator';
                  const canWrite = enabled && ['Administrator','Operator'].includes(u.role);
                  return (
                    <tr key={p.id}>
                      <td style={{padding:'8px 10px',borderBottom:'1px solid var(--line)'}}>{p.label}</td>
                      <td style={{textAlign:'center',padding:'8px 10px',borderBottom:'1px solid var(--line)'}}>
                        <div className={'checkbox'+(enabled?' on':'')} onClick={()=>togglePerm(p.id)}/>
                      </td>
                      <td style={{textAlign:'center',padding:'8px 10px',borderBottom:'1px solid var(--line)'}}>
                        <div className={'checkbox'+(canWrite?' on':'')} onClick={()=>togglePerm(p.id)}/>
                      </td>
                      <td style={{textAlign:'center',padding:'8px 10px',borderBottom:'1px solid var(--line)'}}>
                        <div className={'checkbox'+(isAdmin&&enabled?' on':'')}/>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Toggles */}
          <div className="row" style={{justifyContent:'space-between',padding:'10px 12px',background:'var(--bg-2)',borderRadius:6,border:'1px solid var(--line)'}}>
            <div>
              <div style={{fontWeight:500}}>Uwierzytelnianie dwuskładnikowe (2FA)</div>
              <div className="dim" style={{fontSize:'var(--fs-xs)'}}>TOTP / klucz sprzętowy WebAuthn</div>
            </div>
            <div className={'toggle'+(u.twofa?' on':'')} onClick={()=>setU({...u,twofa:!u.twofa})}/>
          </div>
          <div className="row" style={{justifyContent:'space-between',padding:'10px 12px',background:'var(--bg-2)',borderRadius:6,border:'1px solid var(--line)'}}>
            <div>
              <div style={{fontWeight:500}}>Konto aktywne</div>
              <div className="dim" style={{fontSize:'var(--fs-xs)'}}>Logowanie i sesje SSH</div>
            </div>
            <div className={'toggle'+(u.active?' on':'')} onClick={()=>setU({...u,active:!u.active})}/>
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Anuluj</button>
          <button className="btn" onClick={resetPassword} disabled={!u.id||u.id==='new'}>Resetuj hasło</button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Zapisywanie…' : 'Zapisz zmiany'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Users
// ═══════════════════════════════════════════════════════════════════════════

const Users = () => {
  const USERS_STORE = useStore('USERS');
  const [users,   setUsers]   = React.useState([]);
  const [groups,  setGroups]  = React.useState([]);
  const [editing, setEditing] = React.useState(null);
  const [search,  setSearch]  = React.useState('');
  const [loading, setLoading] = React.useState(true);

  // Załaduj użytkowników z API
  React.useEffect(() => {
    // Załaduj ze store jeśli już jest
    if (USERS_STORE && USERS_STORE.length) {
      setUsers(USERS_STORE);
      setLoading(false);
    }
    // Zawsze odśwież z API
    fetch('/api/system/users', {credentials:'include'})
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!Array.isArray(data) || !data.length) return;
        const parsed = data.map(parseUser);
        setUsers(parsed);
        storeSet('USERS', parsed);
        setLoading(false);
      }).catch(()=>{ setLoading(false); });

    // Załaduj grupy
    fetch('/api/system/groups', {credentials:'include'})
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!Array.isArray(data)) return;
        setGroups(data.filter(g => g.gid >= 1000 || ['sudo','docker','adm','staff','users','www-data'].includes(g.name)));
      }).catch(()=>{});
  }, []);

  const deleteUser = async (login) => {
    if (!confirm(`Usunąć użytkownika ${login}? Tej operacji nie można cofnąć.`)) return;
    await fetch('/api/system/users/' + encodeURIComponent(login), {
      method:'DELETE', credentials:'include',
    }).catch(()=>{});
    const updated = users.filter(u => u.login !== login);
    setUsers(updated);
    storeSet('USERS', updated);
  };

  const onSave = (updated) => {
    setUsers(prev => {
      const exists = prev.find(u => u.login === updated.login);
      const next = exists
        ? prev.map(u => u.login===updated.login ? {...u,...updated} : u)
        : [...prev, {...updated, id: updated.login}];
      storeSet('USERS', next);
      return next;
    });
  };

  const filtered = users.filter(u =>
    !search ||
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.login.toLowerCase().includes(search.toLowerCase())
  );

  const allGroups = groups.length
    ? groups
    : [...new Set(users.flatMap(u=>u.groups))].map(name => ({
        name,
        gid: 0,
        members: users.filter(u=>u.groups.includes(name)).map(u=>u.login),
      }));

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      {/* KPI */}
      <div className="grid grid-4">
        <div className="kpi"><div className="kpi-label">WSZYSCY</div><div className="kpi-value">{users.length}</div></div>
        <div className="kpi"><div className="kpi-label">AKTYWNI</div><div className="kpi-value" style={{color:'var(--ok)'}}>{users.filter(u=>u.active).length}</div></div>
        <div className="kpi"><div className="kpi-label">2FA</div><div className="kpi-value" style={{color:'var(--accent)'}}>{users.filter(u=>u.twofa).length}/{users.length}</div></div>
        <div className="kpi"><div className="kpi-label">GRUPY</div><div className="kpi-value">{allGroups.length}</div></div>
      </div>

      {/* Tabela użytkowników */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">Użytkownicy systemu</div>
          <div className="card-actions">
            <div className="topbar-search" style={{flex:'none',width:220}}>
              <Icon name="search" size={12}/>
              <input placeholder="Szukaj użytkownika…" value={search} onChange={e=>setSearch(e.target.value)}/>
            </div>
            <button className="btn sm primary" onClick={()=>setEditing({
              id:'new', name:'', login:'', uid:null,
              role:'Operator', groups:[], shell:'/bin/bash', active:true, twofa:false, last:'—',
              perms:[...ROLE_DEFAULTS['Operator']],
            })}>
              <Icon name="plus" size={12}/> Nowy użytkownik
            </button>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Użytkownik</th><th>Login</th><th>UID</th><th>Rola</th>
              <th>Grupy</th><th>Powłoka</th><th>2FA</th><th>Ostatnie log.</th><th>Stan</th><th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} style={{textAlign:'center',padding:32,color:'var(--fg-dim)'}}>
                <span className="dot pulse" style={{display:'inline-block',marginRight:8}}/>
                Ładowanie użytkowników…
              </td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={10} style={{textAlign:'center',padding:24,color:'var(--fg-dim)'}}>
                {search ? 'Brak wyników' : 'Brak użytkowników'}
              </td></tr>
            )}
            {filtered.map(u => (
              <tr key={u.id}>
                <td>
                  <span className="row gap-sm">
                    <div className="avatar" style={{width:26,height:26,fontSize:10,background:avatarColor(u.id)}}>
                      {(u.name||u.login).split(' ').map(s=>s[0]).join('').toUpperCase().slice(0,2)}
                    </div>
                    <span style={{fontWeight:500}}>{u.name}</span>
                  </span>
                </td>
                <td className="mono">{u.login}</td>
                <td className="mono dim">{u.uid}</td>
                <td>{u.role==='Administrator'
                  ? <span className="badge accent">{u.role}</span>
                  : <span className="chip">{u.role}</span>}
                </td>
                <td>{(u.groups||[]).slice(0,3).map(g=><span key={g} className="chip" style={{marginRight:4}}>{g}</span>)}</td>
                <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{u.shell}</td>
                <td>{u.twofa
                  ? <span className="badge ok"><Icon name="shield" size={10}/> WŁ</span>
                  : <span className="badge warn">WYŁ</span>}
                </td>
                <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{u.last}</td>
                <td>{u.active
                  ? <span className="badge ok"><span className="dot pulse"/>aktywny</span>
                  : <span className="badge"><span className="dot"/>wyłączony</span>}
                </td>
                <td>
                  <div className="row gap-sm">
                    <button className="btn sm" onClick={()=>setEditing({...u,perms:[...(ROLE_DEFAULTS[u.role]||[])]})}>
                      <Icon name="edit" size={11}/>
                    </button>
                    <button className="btn sm danger" onClick={()=>deleteUser(u.login)}>
                      <Icon name="trash" size={11}/>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Grupy */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">Grupy</div>
          <div className="card-actions">
            <button className="btn sm"><Icon name="plus" size={12}/> Nowa grupa</button>
          </div>
        </div>
        <table className="table">
          <thead><tr><th>Grupa</th><th>GID</th><th>Członków</th><th>Użytkownicy</th></tr></thead>
          <tbody>
            {allGroups.slice(0,20).map(g => {
              const members = g.members || users.filter(u=>u.groups.includes(g.name)).map(u=>u.login);
              return (
                <tr key={g.name}>
                  <td><span className="chip">{g.name}</span></td>
                  <td className="mono dim">{g.gid||'—'}</td>
                  <td className="mono">{members.length}</td>
                  <td className="dim" style={{fontSize:'var(--fs-xs)'}}>{members.join(', ')||'—'}</td>
                </tr>
              );
            })}
            {allGroups.length === 0 && (
              <tr><td colSpan={4} style={{textAlign:'center',padding:20,color:'var(--fg-dim)'}}>Ładowanie grup…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && <UserModal user={editing} onClose={()=>setEditing(null)} onSave={onSave}/>}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Settings
// ═══════════════════════════════════════════════════════════════════════════

const Settings = () => {
  const [tab,      setTab]  = React.useState('general');
  const [hostname, setH]    = React.useState('');
  const [tz,       setTz]   = React.useState('');
  const [saving,   setSaving]= React.useState(false);

  React.useEffect(() => {
    fetch('/system/settings', {credentials:'include'})
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!d) return; setH(d.hostname||''); setTz(d.timezone||''); })
      .catch(()=>{});
  }, []);

  const saveGeneral = async () => {
    setSaving(true);
    await fetch('/system/settings', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({hostname, timezone: tz}),
    }).catch(()=>{});
    setSaving(false);
    alert('Zapisano');
  };

  const TABS = [
    ['general','Ogólne'],['backup','Kopie zapasowe'],['alerts','Powiadomienia'],
    ['power','Zasilanie i UPS'],['docker','Docker'],['update','Aktualizacje'],
    ['startup','Uruchamianie'],
    ['2fa','2FA / TOTP'],
  ];

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="tabs">
        {TABS.map(([id,lbl]) => (
          <div key={id} className={'tab'+(tab===id?' active':'')} onClick={()=>setTab(id)}>{lbl}</div>
        ))}
      </div>

      {/* ── Ogólne ── */}
      {tab==='general' && (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head"><div className="card-title">System</div></div>
            <div className="card-body col" style={{gap:12}}>
              <Field label="Nazwa hosta">
                <input className="input mono" value={hostname} onChange={e=>setH(e.target.value)} placeholder="nimbus"/>
              </Field>
              <Field label="Strefa czasowa">
                <input className="input mono" value={tz} onChange={e=>setTz(e.target.value)} placeholder="Europe/Warsaw"/>
              </Field>
              <Field label="Język interfejsu">
                <select className="select"><option value="pl">Polski</option><option value="en">English</option></select>
              </Field>
              <Field label="Synchronizacja czasu (NTP)">
                <input className="input mono" defaultValue="pool.ntp.org"/>
              </Field>
              <button className="btn primary" onClick={saveGeneral} disabled={saving}>
                {saving ? 'Zapisywanie…' : 'Zapisz ustawienia'}
              </button>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><div className="card-title">Bezpieczeństwo</div></div>
            <div className="card-body col" style={{gap:10}}>
              <ToggleRow t="Wymuś 2FA dla administratorów" on/>
              <ToggleRow t="Auto-blokada po 3 nieudanych próbach" on/>
              <ToggleRow t="Wyłącz logowanie hasłem przez SSH" on/>
              <ToggleRow t="Szyfrowanie at-rest na puli tank"/>
              <ToggleRow t="Audyt operacji administracyjnych" on/>
              <hr className="div"/>
              <KV k="Certyfikat HTTPS" v={<span className="badge ok">Let's Encrypt · 78 dni</span>}/>
              <KV k="Brama Tor / hidden service" v={<span className="dim">nieaktywna</span>}/>
            </div>
          </div>
        </div>
      )}

      {/* ── Kopie zapasowe ── */}
      {tab==='backup' && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">Zaplanowane kopie zapasowe</div>
            <div className="card-actions"><button className="btn sm primary"><Icon name="plus" size={12}/> Nowe zadanie</button></div>
          </div>
          <table className="table">
            <thead><tr><th>Nazwa</th><th>Źródło</th><th>Cel</th><th>Harmonogram</th><th>Ostatni</th><th>Stan</th><th></th></tr></thead>
            <tbody>
              {[
                ['codzienne-tank',    'tank/media',   'backup-cold/media',  'codziennie 02:00', '02:00 dzisiaj', 'ok'],
                ['tygodniowe-cloud',  'tank/cloud',   'b2://nimbus-archive', 'niedz. 03:00',   '3 dni',         'ok'],
                ['config-snapshot',   '/etc, /home',  'backup-cold/config', 'co godzinę',      'teraz',         'ok'],
                ['archiwum-zdjec',    'tank/photos',  'rclone://gdrive',    'codziennie 04:00','04:00 dzisiaj', 'warn'],
              ].map(([name,src,dst,sched,last,st])=>(
                <tr key={name}>
                  <td>{name}</td>
                  <td className="mono">{src}</td>
                  <td className="mono">{dst}</td>
                  <td className="mono">{sched}</td>
                  <td className="mono dim">{last}</td>
                  <td><span className={'badge '+st}>{st==='ok'?'OK':'SKIP'}</span></td>
                  <td><button className="btn sm">Uruchom</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Powiadomienia ── */}
      {tab==='alerts' && (
        <div className="card">
          <div className="card-head"><div className="card-title">Kanały powiadomień</div></div>
          <div className="card-body col" style={{gap:10}}>
            {[
              {ch:'E-mail',        val:'kuba@dom.eu',           on:true},
              {ch:'Telegram',      val:'@kuba_admin',            on:true},
              {ch:'Discord',       val:'webhook · #nas-alerts',  on:true},
              {ch:'ntfy.sh',       val:'nimbus-alerts',          on:false},
              {ch:'Push (mobile)', val:'iPhone · iPad',          on:true},
            ].map((c,i)=>(
              <div key={i} className="row" style={{padding:'10px 14px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:6,gap:14}}>
                <div className="cont-icon" style={{width:32,height:32,fontSize:11}}>{c.ch.slice(0,2).toUpperCase()}</div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:500}}>{c.ch}</div>
                  <div className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{c.val}</div>
                </div>
                <div className={'toggle'+(c.on?' on':'')}/>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Zasilanie i UPS ── */}
      {tab==='power' && (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head"><div className="card-title">UPS · APC Smart-UPS 1500</div></div>
            <div className="card-body col" style={{gap:12}}>
              <KV k="Stan"            v={<span className="badge ok"><span className="dot pulse"/>ON-LINE</span>}/>
              <KV k="Bateria"         v={<span className="mono">100% · 42 min rezerwy</span>}/>
              <KV k="Obciążenie"      v={<span className="mono">38% (570 W)</span>}/>
              <KV k="Napięcie wejścia"v={<span className="mono">232 V · 50.0 Hz</span>}/>
              <hr className="div"/>
              <ToggleRow t="Auto-shutdown przy < 10% baterii" on/>
              <ToggleRow t="Powiadomienie przy utracie zasilania" on/>
              <hr className="div"/>
              <div className="row gap-sm">
                <button className="btn" style={{justifyContent:'flex-start',flex:1}}
                  onClick={async()=>{if(confirm('Uruchomić ponownie?')){await fetch('/api/system-restart',{method:'POST',credentials:'include'});}}}>
                  <Icon name="restart" size={14}/> Uruchom ponownie
                </button>
                <button className="btn danger" style={{justifyContent:'flex-start',flex:1}}
                  onClick={async()=>{if(confirm('Wyłączyć serwer?')){await fetch('/api/system-shutdown',{method:'POST',credentials:'include'});}}}>
                  <Icon name="power" size={14}/> Wyłącz
                </button>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><div className="card-title">Zarządzanie energią</div></div>
            <div className="card-body col" style={{gap:12}}>
              <ToggleRow t="Spin-down dysków HDD po 30 min bezczynności" on/>
              <ToggleRow t="Tryb cichy w godz. 22:00–06:00" on/>
              <ToggleRow t="Wake-on-LAN"/>
              <Field label="Plan zasilania CPU">
                <select className="select" defaultValue="balanced">
                  <option value="performance">Wydajność</option>
                  <option value="balanced">Zbalansowany</option>
                  <option value="powersave">Oszczędzanie</option>
                </select>
              </Field>
              <hr className="div"/>
              <div className="row" style={{justifyContent:'space-between'}}>
                <span>Pobór mocy w czasie rzeczywistym</span>
                <span className="mono">142 W · 2.4 kWh / dzień</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Docker ── */}
      {tab==='docker' && <SettingsDocker/>}

      {/* ── Uruchamianie ── */}
      {tab==='startup' && <SettingsStartup/>}
      {tab==='2fa'      && <Settings2FA/>}

      {/* ── Aktualizacje ── */}
      {tab==='update' && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">Aktualizacje systemu</div>
            <div className="card-actions">
              <button className="btn sm" onClick={async()=>{
                const d = await fetch('/system/updates/check',{credentials:'include'}).then(r=>r.json()).catch(()=>null);
                if (d) alert(`Dostępnych pakietów: ${(d.packages||[]).length||d.total||0}`);
              }}>Sprawdź</button>
            </div>
          </div>
          <div className="card-body col" style={{gap:12}}>
            <div style={{padding:14,background:'var(--accent-soft)',border:'1px solid color-mix(in oklch, var(--accent) 30%, transparent)',borderRadius:8}}>
              <div className="row" style={{justifyContent:'space-between'}}>
                <div>
                  <div style={{fontWeight:600}}>Sprawdź dostępne aktualizacje</div>
                  <div className="dim" style={{fontSize:'var(--fs-xs)',marginTop:2}}>apt list --upgradable</div>
                </div>
                <button className="btn primary" onClick={async()=>{
                  if(confirm('Zainstalować dostępne aktualizacje?')) {
                    await fetch('/system/updates/install',{method:'POST',credentials:'include',
                      headers:{'Content-Type':'application/json'},body:'{"packages":[]}'});
                    alert('Aktualizacja uruchomiona — sprawdź zakładkę Aktualizacje');
                  }
                }}>Zainstaluj</button>
              </div>
            </div>
            <div className="row" style={{justifyContent:'space-between',padding:'10px 12px'}}>
              <span>Automatyczne aktualizacje bezpieczeństwa</span><div className="toggle on"/>
            </div>
            <div className="row" style={{justifyContent:'space-between',padding:'10px 12px'}}>
              <span>Automatyczne aktualizacje Docker</span><div className="toggle"/>
            </div>
            <div className="row" style={{justifyContent:'space-between',padding:'10px 12px'}}>
              <span>Kanał wydania</span><span className="chip accent">stable</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


// ── Startup settings tab ──────────────────────────────────────────────────────
const NFSStartupCard = ({ cfg, set, runNow }) => {
  const [entries, setEntries] = React.useState([]);
  const [current, setCurrent] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [saving,  setSaving]  = React.useState(false);
  const [msg,     setMsg]     = React.useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/startup/nfs', { credentials:'include' });
      const d = await r.json();
      setEntries(d.entries || []);
      setCurrent(d.current || []);
    } catch(e) {}
    finally { setLoading(false); }
  };

  React.useEffect(() => { load(); }, []);

  const saveCurrentMounts = async () => {
    setSaving(true); setMsg('');
    try {
      const r = await fetch('/api/startup/nfs', {
        method: 'POST', credentials: 'include',
      });
      const d = await r.json();
      if (d.status === 'ok') {
        setMsg(`✅ Zapisano ${d.saved} udziałów — będą montowane automatycznie po restarcie`);
        load();
      } else {
        setMsg('❌ ' + (d.error || 'błąd'));
      }
    } catch(e) { setMsg('❌ Błąd połączenia'); }
    finally { setSaving(false); }
  };

  const mountNow = async (m) => {
    await fetch('/api/nfs/mount', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: m.source, target: m.target, fstype: m.fstype }),
    });
    setTimeout(load, 1500);
  };

  const umountNow = async (target) => {
    await fetch('/api/nfs/umount', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
    });
    setTimeout(load, 1500);
  };

  const removeEntry = async (target) => {
    const updated = entries.filter(e => e.target !== target);
    // Zapisz zaktualizowaną listę
    await fetch('/api/startup/nfs', { method: 'POST', credentials: 'include' });
    load();
  };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Udziały sieciowe NFS / CIFS</div>
          <div className="card-sub">
            Automatyczne montowanie po restarcie ·
            {current.length > 0 ? ` ${current.length} aktualnie zamontowanych` : ' brak zamontowanych'}
          </div>
        </div>
        <div className="card-actions">
          <button className="btn sm" onClick={load} disabled={loading}>
            <Icon name="refresh" size={11}/> Odśwież
          </button>
          <button className="btn sm primary" onClick={saveCurrentMounts} disabled={saving || current.length === 0}
            title="Zapisuje aktualnie zamontowane udziały NFS/CIFS do pliku — będą montowane po każdym restarcie">
            <Icon name="save" size={11}/> {saving ? 'Zapisuję…' : 'Zapisz zamontowane'}
          </button>
          <button className="btn sm" onClick={() => runNow('restore-nfs')}
            title="Montuje teraz zapisane udziały">
            <Icon name="play" size={11}/> Montuj teraz
          </button>
        </div>
      </div>

      <div className="card-body col" style={{gap:0}}>
        <div style={{display:'flex',alignItems:'center',gap:14,padding:'10px 0',borderBottom:'1px solid var(--line)'}}>
          <div style={{flex:1}}>
            <div style={{fontWeight:500,fontSize:'var(--fs-sm)'}}>Przywróć montowania po restarcie</div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginTop:2}}>
              Montuje zapisane udziały NFS/CIFS przy każdym starcie Nimbus
            </div>
          </div>
          <span className={'toggle' + (cfg.nfsRestore ? ' on' : '')} onClick={() => set('nfsRestore', !cfg.nfsRestore)}/>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 0',borderBottom:'1px solid var(--line)'}}>
          <span style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>Opóźnienie przed montowaniem (s):</span>
          <input type="number" value={cfg.nfsDelay||10} onChange={e=>set('nfsDelay',parseInt(e.target.value)||10)}
            style={{width:60,height:28,padding:'0 8px',background:'var(--bg-2)',border:'1px solid var(--line-strong)',
              borderRadius:5,color:'var(--fg)',fontFamily:'var(--font-mono)',fontSize:'var(--fs-xs)',outline:'none'}}/>
          <span style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>sek. (czas na wstanie sieci)</span>
        </div>
      </div>

      {msg && (
        <div style={{margin:'0 16px 12px',padding:'8px 12px',borderRadius:6,fontSize:'var(--fs-xs)',
          background: msg.startsWith('✅') ? 'color-mix(in oklch,var(--ok) 8%,transparent)' : 'color-mix(in oklch,var(--err) 8%,transparent)',
          border: '1px solid ' + (msg.startsWith('✅') ? 'color-mix(in oklch,var(--ok) 25%,transparent)' : 'color-mix(in oklch,var(--err) 25%,transparent)'),
        }}>{msg}</div>
      )}

      {/* Jak działa */}
      <div style={{padding:'10px 16px',fontSize:'var(--fs-xs)',color:'var(--fg-dim)',
        borderBottom: entries.length > 0 ? '1px solid var(--line)' : 'none',
        background:'color-mix(in oklch,var(--accent) 4%,transparent)'}}>
        💡 <b>Jak to działa:</b> Zamontuj udziały NFS/CIFS ręcznie, potem kliknij <b>Zapisz zamontowane</b> — 
        Nimbus zapamięta je w pliku i będzie montował automatycznie po każdym restarcie.
      </div>

      {/* Tabela zapisanych */}
      {entries.length === 0 && current.length === 0 ? (
        <div style={{padding:'20px',fontSize:'var(--fs-sm)',color:'var(--fg-dim)',textAlign:'center'}}>
          {loading ? 'Ładowanie…' : 'Brak zapisanych ani aktualnie zamontowanych udziałów NFS/CIFS'}
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Źródło</th>
              <th>Punkt montowania</th>
              <th style={{width:70}}>Typ</th>
              <th style={{width:120}}>Status</th>
              <th style={{width:130}}></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} style={{opacity: e.unsaved ? 0.6 : 1}}>
                <td className="mono" style={{fontSize:'var(--fs-xs)'}}>{e.source}</td>
                <td className="mono" style={{fontSize:'var(--fs-xs)'}}>{e.target}</td>
                <td><span className="badge mono" style={{fontSize:10}}>{e.fstype}</span></td>
                <td>
                  {e.unsaved ? (
                    <span className="badge warn" style={{fontSize:10}}>zamontowany · niezapisany</span>
                  ) : e.mounted ? (
                    <span className="badge ok" style={{fontSize:10}}>● zamontowany</span>
                  ) : (
                    <span className="badge err" style={{fontSize:10}}>○ odmontowany</span>
                  )}
                </td>
                <td style={{textAlign:'right'}}>
                  <div style={{display:'flex',gap:4,justifyContent:'flex-end'}}>
                    {e.mounted ? (
                      <button className="btn sm" onClick={() => umountNow(e.target)}>Odmontuj</button>
                    ) : (
                      <button className="btn sm primary" onClick={() => mountNow(e)}>Montuj</button>
                    )}
                    {!e.unsaved && (
                      <button className="icon-btn" title="Usuń z listy" onClick={() => removeEntry(e.target)}>
                        <Icon name="trash" size={11}/>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

const SettingsStartup = () => {
  const [cfg,    setCfg]    = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [saved,  setSaved]  = React.useState(false);
  const [log,    setLog]    = React.useState([]);
  const [loadingLog, setLoadingLog] = React.useState(false);

  React.useEffect(() => {
    fetch('/api/startup/config', { credentials:'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setCfg(d))
      .catch(() => {});
  }, []);

  const set = (k, v) => setCfg(c => ({ ...c, [k]: v }));

  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      await fetch('/api/startup/config', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally { setSaving(false); }
  };

  const loadLog = async () => {
    setLoadingLog(true);
    try {
      const r = await fetch('/api/startup/log', { credentials:'include' });
      const d = r.ok ? await r.json() : null;
      setLog(d?.lines || []);
    } finally { setLoadingLog(false); }
  };

  const runNow = async (action) => {
    await fetch(`/api/startup/${action}`, { method:'POST', credentials:'include' });
    setTimeout(loadLog, 1500);
  };

  if (!cfg) return (
    <div className="card" style={{padding:40,textAlign:'center',color:'var(--fg-dim)'}}>
      <span className="dot pulse" style={{display:'inline-block',marginRight:8}}/>
      Ładowanie ustawień uruchamiania…
    </div>
  );

  const Toggle = ({ label, sub, k }) => (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',
      padding:'12px 16px',background:'var(--bg-2)',border:'1px solid var(--line)',
      borderRadius:8,marginBottom:8}}>
      <div>
        <div style={{fontWeight:500,fontSize:'var(--fs-sm)'}}>{label}</div>
        {sub && <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginTop:2}}>{sub}</div>}
      </div>
      <div className={'toggle'+(cfg[k]?' on':'')} onClick={()=>set(k,!cfg[k])}/>
    </div>
  );

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>

      {/* ─ ZFS ─ */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">ZFS — importowanie puli</div>
            <div className="card-sub">Wykonywane przy każdym starcie serwisu</div>
          </div>
          <div className="card-actions">
            <button className="btn sm" onClick={()=>runNow('import-zfs')}>
              <Icon name="refresh" size={11}/> Uruchom teraz
            </button>
          </div>
        </div>
        <div className="card-body col" style={{gap:0}}>
          <Toggle k="zfsImport"  label="zpool import -a przy starcie"  sub="Importuje wszystkie dostępne poole ZFS"/>
          <Toggle k="zfsMount"   label="zfs mount -a po imporcie"       sub="Montuje wszystkie datasety ZFS"/>
          <Toggle k="zfsLoadKey" label="zfs load-key -a (szyfrowanie)"  sub="Ładuje klucze szyfrowania (wymaga klucza)"/>
        </div>
      </div>

      {/* ─ Docker ─ */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Docker — przywracanie kontenerów</div>
            <div className="card-sub">Stan jest zapisywany co 2 min i przed wyłączeniem</div>
          </div>
          <div className="card-actions">
            <button className="btn sm" onClick={()=>runNow('restore-docker')}>
              <Icon name="refresh" size={11}/> Uruchom teraz
            </button>
          </div>
        </div>
        <div className="card-body col" style={{gap:0}}>
          <Toggle k="dockerRestore"    label="Przywróć kontenery po restarcie"   sub="Uruchamia kontenery które działały przed wyłączeniem"/>
          <Toggle k="dockerSkipPolicy" label="Pomijaj restart=always/unless-stopped" sub="Kontenery z tą polityką Docker startuje sam"/>
          <Toggle k="dockerNotify"     label="Powiadomienie po przywróceniu kontenerów" sub="Wysyła alert z wynikiem do kanałów powiadomień"/>
        </div>
        <div style={{padding:'0 16px 12px',display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>Opóźnienie startu Docker (s):</span>
          <input type="number" value={cfg.dockerDelay||5} onChange={e=>set('dockerDelay',parseInt(e.target.value)||5)}
            style={{width:60,height:28,padding:'0 8px',background:'var(--bg-2)',border:'1px solid var(--line-strong)',
              borderRadius:5,color:'var(--fg)',fontFamily:'var(--font-mono)',fontSize:'var(--fs-xs)',outline:'none'}}/>
          <span style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>sek. (czas na wstanie daemona)</span>
        </div>
      </div>

      {/* ─ NFS/CIFS ─ */}
      <NFSStartupCard cfg={cfg} set={set} runNow={runNow}/>

      {/* ─ Powiadomienia startowe ─ */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">Powiadomienia po starcie</div>
          <div className="card-sub">Wiadomości wysyłane automatycznie po uruchomieniu serwera</div>
        </div>
        <div className="card-body col" style={{gap:0}}>
          <Toggle k="notifyBoot"      label="Powiadomienie o starcie serwera"     sub="Wysyłane natychmiast po uruchomieniu serwisu"/>
          <Toggle k="notifyZFS"       label="Wynik importu puli ZFS"              sub="Raport z zpool import -a i zfs mount -a"/>
          <Toggle k="notifyDocker"    label="Wynik przywracania kontenerów"       sub="Ile kontenerów uruchomiono / pominięto / błąd"/>
          <Toggle k="notifyShutdown"  label="Powiadomienie przed wyłączeniem"     sub="Alert chwilę przed restartem lub shutdown"/>
        </div>
        <div style={{padding:'0 16px 14px'}}>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:6}}>
            Powiadomienia zostaną wysłane do wszystkich aktywnych kanałów skonfigurowanych w zakładce
            &nbsp;<span style={{color:'var(--accent)',cursor:'pointer'}}
              onClick={()=>document.querySelector('[data-tab="alerts"]')?.click()}>
              Powiadomienia
            </span>.
          </div>
        </div>
      </div>

      {/* ─ Opóźnienie startowe ─ */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Czas oczekiwania na start systemu</div>
            <div className="card-sub">Ile sekund czekać po starcie serwisu przed wykonaniem zadań</div>
          </div>
        </div>
        <div className="card-body" style={{display:'flex',alignItems:'center',gap:14}}>
          <input type="number" value={cfg.startupDelay||5} onChange={e=>set('startupDelay',parseInt(e.target.value)||5)}
            style={{width:70,height:34,padding:'0 10px',background:'var(--bg-2)',border:'1px solid var(--line-strong)',
              borderRadius:6,color:'var(--fg)',fontFamily:'var(--font-mono)',fontSize:'var(--fs-base)',outline:'none'}}/>
          <span style={{color:'var(--fg-muted)',fontSize:'var(--fs-sm)'}}>
            sekund — daj systemowi czas na pełne wstanie przed próbą importu ZFS i startu kontenerów
          </span>
        </div>
      </div>

      {/* ─ Log ostatniego startu ─ */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">Log ostatniego uruchomienia</div>
          <div className="card-actions">
            <button className="btn sm" onClick={loadLog} disabled={loadingLog}>
              <Icon name="refresh" size={11}/> {loadingLog ? 'Ładowanie…' : 'Załaduj'}
            </button>
          </div>
        </div>
        {log.length > 0
          ? <div style={{background:'var(--bg)',margin:'0 16px 16px',borderRadius:7,padding:'10px 14px',
              fontFamily:'var(--font-mono)',fontSize:'var(--fs-xs)',lineHeight:1.8,
              maxHeight:260,overflowY:'auto',border:'1px solid var(--line)'}}>
              {log.map((l,i) => {
                const isErr = /error|fail|błąd/i.test(l);
                const isOk  = /zakończon|uruchomion|mounted|import/i.test(l);
                return <div key={i} style={{color:isErr?'var(--err)':isOk?'var(--ok)':'var(--fg-muted)'}}>{l}</div>;
              })}
            </div>
          : <div style={{padding:'20px 16px',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>
              Kliknij „Załaduj" aby pobrać log z journalctl
            </div>
        }
      </div>

      {/* Save */}
      <div style={{display:'flex',justifyContent:'flex-end',gap:10}}>
        {saved && <span className="badge ok" style={{alignSelf:'center'}}><Icon name="check" size={11}/> Zapisano</span>}
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? 'Zapisywanie…' : 'Zapisz ustawienia uruchamiania'}
        </button>
      </div>
    </div>
  );
};

// ── Docker daemon settings tab ────────────────────────────────────────────────
const SettingsDocker = () => {
  const inpSt = {background:'var(--bg-2)',border:'1px solid var(--line-strong)',borderRadius:5,padding:'5px 10px',color:'var(--fg)',fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',outline:'none',width:'100%'};
  
  const [logDriver,setLogDriver]=React.useState('json-file');
  const [logMax,setLogMax]=React.useState('10m');
  const [logFiles,setLogFiles]=React.useState('3');
  const [dataRoot,setDataRoot]=React.useState('/var/lib/docker');
  const [storageDriver,setStorageDriver]=React.useState('overlay2');
  const [mirrors,setMirrors]=React.useState([]);
  const [newMirror,setNewMirror]=React.useState('');
  const [ipv6,setIpv6]=React.useState(false);
  const [experimental,setExperimental]=React.useState(false);
  const [liveRestore,setLiveRestore]=React.useState(true);
  const [memLimit,setMemLimit]=React.useState('');
  const [cpuLimit,setCpuLimit]=React.useState('');
  const [applying,setApplying]=React.useState(false);
  const [loading,setLoading]=React.useState(true);
  const [dockerStatus,setDockerStatus]=React.useState('unknown');
  const [logLevel,setLogLevel]=React.useState('info');
  const [maxConcurrentDownloads,setMaxDownloads]=React.useState(3);
  const [maxConcurrentUploads,setMaxUploads]=React.useState(5);
  const [maxDownloadAttempts,setMaxAttempts]=React.useState(5);
  const [debug,setDebug]=React.useState(false);
  const [iptables,setIptables]=React.useState(true);
  const [ip6tables,setIp6tables]=React.useState(false);
  const [ipForward,setIpForward]=React.useState(true);
  const [ipMasq,setIpMasq]=React.useState(true);
  const [tls,setTls]=React.useState(false);
  const [dnsServers,setDnsServers]=React.useState(['8.8.8.8','8.8.4.4']);
  const [dnsSearch,setDnsSearch]=React.useState(['localdomain']);
  const [addressPools,setAddressPools]=React.useState([]);
  const [hosts,setHosts]=React.useState(['unix:///var/run/docker.sock']);
  const [containerd,setContainerd]=React.useState('/run/containerd/containerd.sock');
  const [logCacheDisabled,setLogCacheDisabled]=React.useState(false);
  const [logCacheCompress,setLogCacheCompress]=React.useState(true);
  const [logEnv,setLogEnv]=React.useState('os,customer');
  const [logLabels,setLogLabels]=React.useState('somelabel');

  React.useEffect(()=>{
    (async()=>{
      try{
        const sr=await fetch('/services/docker/status',{credentials:'include'});
        if(sr.ok)setDockerStatus((await sr.json()).active?'running':'stopped');
        const cr=await fetch('/services/docker/config',{credentials:'include'});
        if(cr.ok){
          const rd=await cr.json();
          let config=typeof rd.config==='string'?JSON.parse(rd.config):rd.config||rd;
          if(config){
            if(config['data-root'])setDataRoot(config['data-root']);
            if(config['storage-driver'])setStorageDriver(config['storage-driver']);
            if(config['log-driver'])setLogDriver(config['log-driver']);
            if(config['log-level'])setLogLevel(config['log-level']);
            const opts=config['log-opts']||{};
            if(opts['max-size'])setLogMax(opts['max-size']);
            if(opts['max-file'])setLogFiles(String(opts['max-file']));
            if(opts['cache-disabled'])setLogCacheDisabled(opts['cache-disabled']==='true');
            if(opts['cache-compress'])setLogCacheCompress(opts['cache-compress']==='true');
            if(opts['env'])setLogEnv(opts['env']);
            if(opts['labels'])setLogLabels(opts['labels']);
            if(config['registry-mirrors'])setMirrors(config['registry-mirrors']);
            if(config['ipv6']!==undefined)setIpv6(config['ipv6']);
            if(config['iptables']!==undefined)setIptables(config['iptables']);
            if(config['ip6tables']!==undefined)setIp6tables(config['ip6tables']);
            if(config['ip-forward']!==undefined)setIpForward(config['ip-forward']);
            if(config['ip-masq']!==undefined)setIpMasq(config['ip-masq']);
            if(config['max-concurrent-downloads'])setMaxDownloads(config['max-concurrent-downloads']);
            if(config['max-concurrent-uploads'])setMaxUploads(config['max-concurrent-uploads']);
            if(config['max-download-attempts'])setMaxAttempts(config['max-download-attempts']);
            if(config['experimental']!==undefined)setExperimental(config['experimental']);
            if(config['debug']!==undefined)setDebug(config['debug']);
            if(config['live-restore']!==undefined)setLiveRestore(config['live-restore']);
            if(config['tls']!==undefined)setTls(config['tls']);
            if(config['dns'])setDnsServers(config['dns']);
            if(config['dns-search'])setDnsSearch(config['dns-search']);
            if(config['default-address-pools'])setAddressPools(config['default-address-pools']);
            if(config['hosts'])setHosts(config['hosts']);
            if(config['containerd'])setContainerd(config['containerd']);
            if(config['default-shm-size'])setMemLimit(config['default-shm-size']);
          }
        }
      }catch(e){console.error(e);}
      setLoading(false);
    })();
  },[]);

  // FUNKCJA MUSI BYĆ TUTAJ, PRZED return!
  const applyConfig = async () => {
    setApplying(true);
    try {
      const configToSave = {
        hosts, containerd, 'data-root': dataRoot, 'storage-driver': storageDriver,
        'log-driver': logDriver, 'log-level': logLevel,
        'log-opts': {'max-size': logMax, 'max-file': logFiles, 'cache-disabled': String(logCacheDisabled), 'cache-compress': String(logCacheCompress), env: logEnv, labels: logLabels},
        'max-concurrent-downloads': maxConcurrentDownloads, 'max-concurrent-uploads': maxConcurrentUploads,
        'max-download-attempts': maxDownloadAttempts, 'registry-mirrors': mirrors,
        ipv6, iptables, ip6tables, 'ip-forward': ipForward, 'ip-masq': ipMasq,
        experimental, debug, 'live-restore': liveRestore, tls,
        dns: dnsServers, 'dns-search': dnsSearch, 'default-address-pools': addressPools,
        ...(memLimit ? {'default-shm-size': memLimit} : {}),
      };
      const resp = await fetch('/services/docker/config', {
        method: 'POST', credentials: 'include',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({config: JSON.stringify(configToSave, null, 2)}),
      });
      if (resp.ok) alert('Zapisano!');
    } catch(e) { alert('Błąd: ' + e.message); }
    setApplying(false);
  };

  const daemonJson = JSON.stringify({
    hosts, containerd, 'data-root': dataRoot, 'storage-driver': storageDriver,
    'log-driver': logDriver, 'log-level': logLevel,
    'log-opts': {'max-size': logMax, 'max-file': logFiles, 'cache-disabled': String(logCacheDisabled), 'cache-compress': String(logCacheCompress), env: logEnv, labels: logLabels},
    'max-concurrent-downloads': maxConcurrentDownloads, 'max-concurrent-uploads': maxConcurrentUploads,
    'max-download-attempts': maxDownloadAttempts, 'registry-mirrors': mirrors,
    ipv6, iptables, ip6tables, 'ip-forward': ipForward, 'ip-masq': ipMasq,
    experimental, debug, 'live-restore': liveRestore, tls,
    dns: dnsServers, 'dns-search': dnsSearch, 'default-address-pools': addressPools,
    ...(memLimit ? {'default-shm-size': memLimit} : {}),
  }, null, 2);

  if (loading) return <div className="card" style={{padding:40,textAlign:'center'}}><span className="dot pulse"/> Ładowanie konfiguracji Dockera...</div>;

  // TERAZ JSX - pełny interfejs
  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      {/* Status */}
      <div className="card" style={{borderColor:dockerStatus==='running'?'var(--ok)':'var(--warn)',background:dockerStatus==='running'?'color-mix(in oklch,var(--ok)10%,var(--bg-2))':'color-mix(in oklch,var(--warn)10%,var(--bg-2))'}}>
        <div className="row" style={{padding:'10px 16px',justifyContent:'space-between'}}>
          <div className="row gap-sm"><span className="dot pulse" style={{color:dockerStatus==='running'?'var(--ok)':'var(--warn)'}}/><span>Docker: <b>{dockerStatus==='running'?'Uruchomiony':'Zatrzymany'}</b></span></div>
          <div className="row gap-sm">
            <button className="btn sm" onClick={async()=>{await fetch('/services/docker/start',{method:'POST',credentials:'include'});setDockerStatus('running');}}>Start</button>
            <button className="btn sm" onClick={async()=>{await fetch('/services/docker/stop',{method:'POST',credentials:'include'});setDockerStatus('stopped');}}>Stop</button>
            <button className="btn sm" onClick={async()=>{await fetch('/services/docker/restart',{method:'POST',credentials:'include'});setDockerStatus('running');}}>Restart</button>
          </div>
        </div>
      </div>

      {/* Główna konfiguracja */}
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><div className="card-title">Daemon Docker</div></div>
          <div className="card-body col" style={{gap:12}}>
            <Field label="Katalog danych"><input style={inpSt} value={dataRoot} onChange={e=>setDataRoot(e.target.value)}/></Field>
            <Field label="Storage driver"><select style={inpSt} value={storageDriver} onChange={e=>setStorageDriver(e.target.value)}><option>overlay2</option><option>devicemapper</option><option>btrfs</option><option>zfs</option></select></Field>
            <Field label="Containerd socket"><input style={inpSt} value={containerd} onChange={e=>setContainerd(e.target.value)}/></Field>
            <Field label="Hosty">
              {hosts.map((h,i)=><div key={i} className="row gap-sm" style={{marginBottom:4}}><input style={inpSt} value={h} onChange={e=>{const n=[...hosts];n[i]=e.target.value;setHosts(n);}}/><button className="icon-btn" onClick={()=>setHosts(h=>h.filter((_,j)=>j!==i))}><Icon name="trash" size={12}/></button></div>)}
              <button className="btn sm" onClick={()=>setHosts([...hosts,'unix:///var/run/docker.sock'])}><Icon name="plus" size={11}/> Dodaj</button>
            </Field>
          </div>
        </div>

        <div className="col" style={{gap:'var(--gutter)'}}>
          <div className="card">
            <div className="card-head"><div className="card-title">Sieć</div></div>
            <div className="card-body col" style={{gap:10}}>
              <div className="row" style={{justifyContent:'space-between'}}><span>IPv6</span><div className={'toggle '+(ipv6?'on':'')} onClick={()=>setIpv6(v=>!v)}/></div>
              <div className="row" style={{justifyContent:'space-between'}}><span>iptables</span><div className={'toggle '+(iptables?'on':'')} onClick={()=>setIptables(v=>!v)}/></div>
              <div className="row" style={{justifyContent:'space-between'}}><span>ip6tables</span><div className={'toggle '+(ip6tables?'on':'')} onClick={()=>setIp6tables(v=>!v)}/></div>
              <div className="row" style={{justifyContent:'space-between'}}><span>IP Forward</span><div className={'toggle '+(ipForward?'on':'')} onClick={()=>setIpForward(v=>!v)}/></div>
              <div className="row" style={{justifyContent:'space-between'}}><span>IP Masquerade</span><div className={'toggle '+(ipMasq?'on':'')} onClick={()=>setIpMasq(v=>!v)}/></div>
              <div className="row" style={{justifyContent:'space-between'}}><span>TLS</span><div className={'toggle '+(tls?'on':'')} onClick={()=>setTls(v=>!v)}/></div>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><div className="card-title">Funkcje</div></div>
            <div className="card-body col" style={{gap:10}}>
              <div className="row" style={{justifyContent:'space-between'}}><span>Live restore</span><div className={'toggle '+(liveRestore?'on':'')} onClick={()=>setLiveRestore(v=>!v)}/></div>
              <div className="row" style={{justifyContent:'space-between'}}><span>Eksperymentalne</span><div className={'toggle '+(experimental?'on':'')} onClick={()=>setExperimental(v=>!v)}/></div>
              <div className="row" style={{justifyContent:'space-between'}}><span>Debug</span><div className={'toggle '+(debug?'on':'')} onClick={()=>setDebug(v=>!v)}/></div>
            </div>
          </div>
        </div>
      </div>

      {/* Logi i limity */}
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><div className="card-title">Log driver</div></div>
          <div className="card-body col" style={{gap:10}}>
            <div className="grid grid-2" style={{gap:10}}>
              <Field label="Driver"><select style={inpSt} value={logDriver} onChange={e=>setLogDriver(e.target.value)}><option>json-file</option><option>journald</option><option>syslog</option><option>none</option><option>local</option></select></Field>
              <Field label="Poziom"><select style={inpSt} value={logLevel} onChange={e=>setLogLevel(e.target.value)}><option>debug</option><option>info</option><option>warn</option><option>error</option></select></Field>
            </div>
            <div className="grid grid-2" style={{gap:10}}>
              <Field label="Max rozmiar"><input style={inpSt} value={logMax} onChange={e=>setLogMax(e.target.value)}/></Field>
              <Field label="Max plików"><input style={inpSt} value={logFiles} onChange={e=>setLogFiles(e.target.value)}/></Field>
            </div>
            <div className="row" style={{justifyContent:'space-between'}}><span>Cache kompresji</span><div className={'toggle '+(logCacheCompress?'on':'')} onClick={()=>setLogCacheCompress(v=>!v)}/></div>
            <Field label="Env"><input style={inpSt} value={logEnv} onChange={e=>setLogEnv(e.target.value)}/></Field>
            <Field label="Labels"><input style={inpSt} value={logLabels} onChange={e=>setLogLabels(e.target.value)}/></Field>
          </div>
        </div>

        <div className="col" style={{gap:'var(--gutter)'}}>
          <div className="card">
            <div className="card-head"><div className="card-title">Limity</div></div>
            <div className="card-body col" style={{gap:10}}>
              <Field label="Max downloads"><input style={inpSt} type="number" value={maxConcurrentDownloads} onChange={e=>setMaxDownloads(parseInt(e.target.value)||3)}/></Field>
              <Field label="Max uploads"><input style={inpSt} type="number" value={maxConcurrentUploads} onChange={e=>setMaxUploads(parseInt(e.target.value)||5)}/></Field>
              <Field label="Max attempts"><input style={inpSt} type="number" value={maxDownloadAttempts} onChange={e=>setMaxAttempts(parseInt(e.target.value)||5)}/></Field>
              <Field label="SHM size"><input style={inpSt} value={memLimit} onChange={e=>setMemLimit(e.target.value)}/></Field>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><div className="card-title">DNS</div></div>
            <div className="card-body col" style={{gap:8}}>
              <Field label="Serwery DNS">
                {dnsServers.map((d,i)=><div key={i} className="row gap-sm"><input style={inpSt} value={d} onChange={e=>{const n=[...dnsServers];n[i]=e.target.value;setDnsServers(n);}}/><button className="icon-btn" onClick={()=>setDnsServers(d=>d.filter((_,j)=>j!==i))}><Icon name="trash" size={12}/></button></div>)}
                <button className="btn sm" onClick={()=>setDnsServers([...dnsServers,'8.8.8.8'])}><Icon name="plus" size={11}/> Dodaj</button>
              </Field>
              <Field label="DNS Search">
                {dnsSearch.map((s,i)=><div key={i} className="row gap-sm"><input style={inpSt} value={s} onChange={e=>{const n=[...dnsSearch];n[i]=e.target.value;setDnsSearch(n);}}/><button className="icon-btn" onClick={()=>setDnsSearch(d=>d.filter((_,j)=>j!==i))}><Icon name="trash" size={12}/></button></div>)}
                <button className="btn sm" onClick={()=>setDnsSearch([...dnsSearch,'local'])}><Icon name="plus" size={11}/> Dodaj</button>
              </Field>
            </div>
          </div>
        </div>
      </div>

      {/* Address Pools */}
      <div className="card">
        <div className="card-head"><div className="card-title">Default Address Pools</div></div>
        <div className="card-body col" style={{gap:8}}>
          {addressPools.length===0&&<div style={{padding:20,textAlign:'center',color:'var(--fg-dim)'}}>Brak pul</div>}
          {addressPools.map((p,i)=><div key={i} className="row" style={{padding:'8px 12px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:6}}><span className="mono">Base: {p.base} / Size: {p.size}</span><button className="icon-btn" onClick={()=>setAddressPools(a=>a.filter((_,j)=>j!==i))}><Icon name="trash" size={13}/></button></div>)}
        </div>
      </div>

      {/* Registry mirrors */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">Registry mirrors</div>
          <div className="card-actions">
            <input style={inpSt} value={newMirror} onChange={e=>setNewMirror(e.target.value)} placeholder="https://..."/>
            <button className="btn sm primary" onClick={()=>{if(newMirror){setMirrors(m=>[...m,newMirror]);setNewMirror('');}}}><Icon name="plus" size={11}/> Dodaj</button>
          </div>
        </div>
        <div className="card-body col" style={{gap:8}}>
          {mirrors.length===0&&<div style={{padding:20,textAlign:'center',color:'var(--fg-dim)'}}>Brak mirrorów</div>}
          {mirrors.map((m,i)=><div key={i} className="row" style={{padding:'8px 12px',background:'var(--bg-2)',border:'1px solid var(--line)',borderRadius:6}}><Icon name="globe" size={14}/><span className="mono" style={{flex:1}}>{m}</span><button className="icon-btn" onClick={()=>setMirrors(ms=>ms.filter((_,j)=>j!==i))}><Icon name="trash" size={13}/></button></div>)}
        </div>
      </div>

      {/* Podgląd JSON */}
      <div className="card">
        <div className="card-head"><div className="card-title">daemon.json — podgląd</div><div className="card-actions"><button className="btn sm primary" onClick={applyConfig} disabled={applying}><Icon name="download" size={11}/> {applying?'Zapisywanie…':'Zastosuj'}</button></div></div>
        <pre style={{margin:0,padding:'14px 18px',fontFamily:'var(--font-mono)',fontSize:'var(--fs-xs)',color:'var(--fg-muted)',lineHeight:1.7,overflowX:'auto',background:'var(--bg)',maxHeight:400}}>{daemonJson}</pre>
      </div>
    </div>
  );
};


// ── Export ────────────────────────────────────────────────────────────────────
window.Users    = Users;
const Settings2FA = () => {
  const [status,    setStatus]    = React.useState(null);
  const [setupData, setSetupData] = React.useState(null);
  const [code,      setCode]      = React.useState('');
  const [secret,    setSecret]    = React.useState('');
  const [disCode,   setDisCode]   = React.useState('');
  const [msg,       setMsg]       = React.useState('');
  const [err,       setErr]       = React.useState('');
  const [step,      setStep]      = React.useState('status'); // status | setup | confirm | disable

  const load = () => {
    fetch('/api/totp/status', {credentials:'include'})
      .then(r=>r.ok?r.json():null)
      .then(d=>d&&setStatus(d)).catch(()=>{});
  };
  React.useEffect(load, []);

  const flash = (m, isErr=false) => {
    if (isErr) { setErr(m); setTimeout(()=>setErr(''),4000); }
    else       { setMsg(m); setTimeout(()=>setMsg(''),3000); }
  };

  const startSetup = async () => {
    const r = await fetch('/api/totp/setup', {credentials:'include'});
    const d = await r.json();
    setSetupData(d); setSecret(d.secret); setStep('setup');
  };

  const confirmSetup = async () => {
    const r = await fetch('/api/totp/setup', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({secret, code}),
    });
    const d = await r.json();
    if (!r.ok) { flash(d.error||'Błąd', true); return; }
    flash('✓ 2FA aktywowane!'); setStep('status'); setCode(''); load();
  };

  const disable2FA = async () => {
    const r = await fetch('/api/totp/disable', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({code: disCode}),
    });
    const d = await r.json();
    if (!r.ok) { flash(d.error||'Błąd', true); return; }
    flash('2FA wyłączone'); setStep('status'); setDisCode(''); load();
  };

  const inpSt = {background:'var(--bg-2)',border:'1px solid var(--line-strong)',
    borderRadius:6,padding:'8px 12px',color:'var(--fg)',fontFamily:'var(--font-mono)',
    fontSize:'var(--fs-base)',outline:'none',width:'100%',letterSpacing:4,textAlign:'center'};

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      {msg && <div style={{padding:'10px 14px',background:'color-mix(in oklch,var(--ok) 10%,transparent)',
        border:'1px solid color-mix(in oklch,var(--ok) 25%,transparent)',borderRadius:7,color:'var(--ok)'}}>{msg}</div>}
      {err && <div style={{padding:'10px 14px',background:'color-mix(in oklch,var(--err) 10%,transparent)',
        border:'1px solid color-mix(in oklch,var(--err) 25%,transparent)',borderRadius:7,color:'var(--err)'}}>{err}</div>}

      {/* Status */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Uwierzytelnianie dwuskładnikowe (2FA)</div>
            <div className="card-sub">TOTP · RFC 6238 · Google Authenticator, Aegis, Bitwarden</div>
          </div>
          {status && (
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span className={'badge '+(status.user_has_2fa?'ok':'')}>
                {status.user_has_2fa ? '🔒 AKTYWNE' : '🔓 WYŁĄCZONE'}
              </span>
            </div>
          )}
        </div>
        <div className="card-body">
          {!status
            ? <div style={{color:'var(--fg-dim)'}}>Ładowanie…</div>
            : status.user_has_2fa
              ? step !== 'disable'
                ? <div className="col" style={{gap:10}}>
                    <div style={{fontSize:'var(--fs-sm)',color:'var(--fg-muted)'}}>
                      2FA jest aktywne dla Twojego konta. Przy każdym logowaniu będziesz proszony o kod z aplikacji.
                    </div>
                    <button className="btn danger" style={{width:'fit-content'}} onClick={()=>setStep('disable')}>
                      Wyłącz 2FA
                    </button>
                  </div>
                : <div className="col" style={{gap:12,maxWidth:320}}>
                    <div style={{fontWeight:500}}>Podaj kod z aplikacji aby wyłączyć 2FA:</div>
                    <input style={inpSt} value={disCode} onChange={e=>setDisCode(e.target.value)}
                      placeholder="000000" maxLength={6} autoFocus/>
                    <div className="row gap-sm">
                      <button className="btn danger" onClick={disable2FA} disabled={disCode.length!==6}>
                        Wyłącz 2FA
                      </button>
                      <button className="btn" onClick={()=>setStep('status')}>Anuluj</button>
                    </div>
                  </div>
              : step === 'status'
                ? <div className="col" style={{gap:10}}>
                    <div style={{fontSize:'var(--fs-sm)',color:'var(--fg-muted)'}}>
                      2FA nie jest aktywne. Włącz je aby zabezpieczyć konto przed nieautoryzowanym dostępem.
                    </div>
                    <button className="btn primary" style={{width:'fit-content'}} onClick={startSetup}>
                      <Icon name="shield" size={12}/> Aktywuj 2FA
                    </button>
                  </div>
                : step === 'setup' && setupData
                  ? <div className="col" style={{gap:16,maxWidth:400}}>
                      <div style={{fontWeight:600}}>1. Zeskanuj QR kod aplikacją TOTP</div>
                      <img src={setupData.qr_url} alt="QR kod 2FA" style={{width:180,height:180,borderRadius:8,border:'2px solid var(--line)'}}/>
                      <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>
                        Lub wpisz ręcznie:<br/>
                        <code style={{fontFamily:'var(--font-mono)',color:'var(--accent)',letterSpacing:2}}>{setupData.secret}</code>
                      </div>
                      <div style={{fontWeight:600}}>2. Wpisz 6-cyfrowy kod z aplikacji</div>
                      <input style={inpSt} value={code} onChange={e=>setCode(e.target.value)}
                        placeholder="000000" maxLength={6} autoFocus/>
                      <div className="row gap-sm">
                        <button className="btn primary" onClick={confirmSetup} disabled={code.length!==6}>
                          Potwierdź i aktywuj
                        </button>
                        <button className="btn" onClick={()=>setStep('status')}>Anuluj</button>
                      </div>
                    </div>
                  : null
          }
        </div>
      </div>

      {/* Info */}
      <div className="card">
        <div className="card-head"><div className="card-title">Jak działa TOTP?</div></div>
        <div className="card-body" style={{fontSize:'var(--fs-sm)',color:'var(--fg-muted)',lineHeight:1.8}}>
          <div>• Aplikacja generuje nowy 6-cyfrowy kod co <strong style={{color:'var(--fg)'}}>30 sekund</strong></div>
          <div>• Kod jest obliczany na podstawie tajnego klucza i bieżącego czasu</div>
          <div>• Nawet jeśli ktoś pozna Twoje hasło — bez telefonu nie zaloguje się</div>
          <div>• Polecane aplikacje: <strong style={{color:'var(--fg)'}}>Aegis</strong> (Android), <strong style={{color:'var(--fg)'}}>Raivo</strong> (iOS), <strong style={{color:'var(--fg)'}}>Bitwarden</strong></div>
        </div>
      </div>
    </div>
  );
};

window.Settings = Settings;
