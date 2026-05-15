// ===== Hardware Inventory — API-driven (/api/hardware) =====

const RamSlotCard = ({ slot }) => {
  const empty = !slot.size_gb;
  return (
    <div style={{
      padding:'12px 14px', borderRadius:8,
      background: empty ? 'var(--bg-2)' : 'color-mix(in oklch, var(--accent) 8%, var(--bg-2))',
      border:'1px solid '+(empty?'var(--line)':'color-mix(in oklch, var(--accent) 25%, var(--line))'),
      borderStyle: empty?'dashed':'solid',
    }}>
      <div style={{ fontSize:10, color:'var(--fg-dim)', letterSpacing:'.06em', textTransform:'uppercase', marginBottom:6 }}>{slot.slot}</div>
      {empty ? (
        <div>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)', color:'var(--fg-dim)' }}>— pusty —</div>
          <div style={{ fontSize:'var(--fs-xs)', color:'var(--fg-dim)', marginTop:4 }}>Brak modułu DIMM</div>
        </div>
      ) : (
        <div>
          <div style={{ fontWeight:700, fontFamily:'var(--font-mono)', fontSize:16, color:'var(--accent)' }}>{slot.size_gb} GB</div>
          <div style={{ fontSize:'var(--fs-xs)', color:'var(--fg-muted)' }}>{slot.type} · {slot.speed}</div>
          {slot.mfr && <div style={{ fontSize:10, color:'var(--fg-dim)', marginTop:6, fontFamily:'var(--font-mono)' }}>{slot.mfr} {slot.pn}</div>}
          {slot.sn  && <div style={{ fontSize:9, color:'var(--fg-dim)', fontFamily:'var(--font-mono)', marginTop:2 }}>S/N {slot.sn}</div>}
        </div>
      )}
    </div>
  );
};

const HardwareInventory = () => {
  const [tab,  setTab]  = React.useState('overview');
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [installing, setInstalling] = React.useState(false);

  const load = async () => {
    try {
      const r = await fetch('/api/hardware', { credentials:'include' });
      if (!r.ok) return;
      const d = await r.json();
      setData(d);
    } catch(e) {}
    finally { setLoading(false); }
  };

  React.useEffect(() => { load(); }, []);

  const install = async () => {
    setInstalling(true);
    try {
      await fetch('/api/hardware/install', { method:'POST', credentials:'include' });
      await load();
    } finally { setInstalling(false); }
  };

  if (loading) return (
    <div style={{ padding:60, textAlign:'center', color:'var(--fg-dim)' }}>
      <div style={{ width:18, height:18, border:'2px solid var(--line-strong)', borderTopColor:'var(--accent)',
        borderRadius:'50%', animation:'_spin .6s linear infinite', margin:'0 auto 12px' }}/>
      <div style={{ fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)' }}>Odczyt inwentarza sprzętu…</div>
    </div>
  );

  if (!data) return (
    <div className="card" style={{ padding:40, textAlign:'center', color:'var(--fg-dim)' }}>
      Błąd pobierania danych sprzętowych
    </div>
  );

  const cpu   = data.cpu   || {};
  const ram   = data.ram   || [];
  const pcie  = data.pcie  || [];
  const usb   = data.usb   || [];
  const bios  = data.bios  || {};
  const nics  = data.nics  || [];

  const ramUsed  = data.ram_slots_used  || ram.filter(s => s.size_gb > 0).length;
  const ramTotal = data.ram_slots_total || ram.length;
  const ramGB    = data.ram_total_gb    || ram.reduce((s,r) => s + (r.size_gb||0), 0);
  const pcieUsed = pcie.filter(s => s.occupied).length;

  // Ostrzeżenie gdy brak narzędzi
  const missingTools = [];
  if (!data.dmidecode_avail) missingTools.push('dmidecode');
  if (!data.lspci_avail)     missingTools.push('pciutils');
  if (!data.lsusb_avail)     missingTools.push('usbutils');

  return (
    <div className="col" style={{ gap:'var(--gutter)' }}>

      {missingTools.length > 0 && (
        <div style={{ padding:'10px 14px', background:'oklch(0.78 0.15 75 / 0.08)',
          border:'1px solid oklch(0.78 0.15 75 / 0.3)', borderRadius:8,
          display:'flex', alignItems:'center', gap:12, fontSize:'var(--fs-sm)' }}>
          <Icon name="thermometer" size={15} style={{ color:'var(--warn)', flexShrink:0 }}/>
          <div style={{ flex:1 }}>
            Brak narzędzi: <code>{missingTools.join(', ')}</code> — część danych może być niepełna.
          </div>
          <button className="btn sm primary" onClick={install} disabled={installing}>
            {installing ? 'Instalowanie…' : 'Zainstaluj'}
          </button>
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-4">
        <div className="kpi">
          <div className="kpi-label">CPU</div>
          <div className="kpi-value" style={{ fontSize:16 }}>{cpu.cores || '?'}C/{cpu.threads || '?'}T</div>
          <div className="kpi-foot"><span>{(cpu.model || 'Unknown').replace(/AMD Ryzen \d+ |Intel Core /,'')}</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">PAMIĘĆ</div>
          <div className="kpi-value">{ramGB} <span style={{ fontSize:14, color:'var(--fg-dim)', fontWeight:400 }}>GB</span></div>
          <div className="kpi-foot"><span>{ramUsed}/{ramTotal} slotów · {ram[0]?.type || 'DDR'}</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">SLOTY PCIe</div>
          <div className="kpi-value">{pcieUsed}<span style={{ color:'var(--fg-dim)', fontSize:14, fontWeight:400 }}> / {pcie.length}</span></div>
          <div className="kpi-foot"><span>obsadzone</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">URZĄDZENIA USB</div>
          <div className="kpi-value">{usb.length}</div>
          <div className="kpi-foot"><span>podłączone</span></div>
        </div>
      </div>

      {/* Tabs */}
      <div className="segmented">
        {[
          ['overview','Przegląd'], ['cpu','CPU'], ['ram','Pamięć RAM'],
          ['pcie','PCIe'], ['usb','USB'], ['net','Karty sieciowe'], ['bios','BIOS / Płyta'],
        ].map(([id,l]) => (
          <button key={id} className={tab===id?'active':''} onClick={() => setTab(id)}>{l}</button>
        ))}
      </div>

      {/* ── PRZEGLĄD ── */}
      {tab === 'overview' && (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">{bios.board || 'Płyta główna'}</div>
                <div className="card-sub">{bios.chassis || ''}</div>
              </div>
              <button className="btn sm" onClick={load}><Icon name="refresh" size={11}/></button>
            </div>
            <div className="card-body col" style={{ gap:8, fontSize:'var(--fs-sm)' }}>
              {[
                ['Procesor',    cpu.model || '—'],
                ['Pamięć',      ramGB ? `${ramGB} GB ${ram[0]?.type||'DDR'} (${ramUsed}/${ramTotal} slotów)` : '—'],
                ['BIOS',        bios.vendor ? `${bios.vendor} ${bios.version} · ${bios.date}` : '—'],
                ['Firmware',    bios.efi ? `${bios.efi} · ${bios.tpm}` : '—'],
                ['Secure Boot', bios.secure_boot || '—'],
                ['S/N płyty',   bios.board_sn || '—'],
                ['S/N obudowy', bios.chassis_sn || '—'],
              ].map(([k,v]) => (
                <div key={k} style={{ display:'grid', gridTemplateColumns:'140px 1fr', gap:8 }}>
                  <span style={{ color:'var(--fg-dim)' }}>{k}</span>
                  <span className="mono" style={{ wordBreak:'break-all' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><div><div className="card-title">dmidecode --type system</div><div className="card-sub">SMBIOS · DMI</div></div></div>
            <div style={{ padding:'12px 16px', fontFamily:'var(--font-mono)', fontSize:'var(--fs-xs)', color:'var(--fg-muted)', lineHeight:1.7, background:'var(--bg)' }}>
              {data.dmidecode_avail ? (
                <>
                  <div><span style={{ color:'var(--fg-dim)' }}>Manufacturer:</span> {bios.vendor || '—'}</div>
                  <div><span style={{ color:'var(--fg-dim)' }}>Board:</span> {bios.board || '—'}</div>
                  <div><span style={{ color:'var(--fg-dim)' }}>Board Rev:</span> {bios.board_rev || '—'}</div>
                  <div><span style={{ color:'var(--fg-dim)' }}>Board S/N:</span> {bios.board_sn || '—'}</div>
                  <div><span style={{ color:'var(--fg-dim)' }}>Chassis:</span> {bios.chassis || '—'}</div>
                  <div><span style={{ color:'var(--fg-dim)' }}>Chassis S/N:</span> {bios.chassis_sn || '—'}</div>
                  <div><span style={{ color:'var(--fg-dim)' }}>TPM:</span> {bios.tpm || '—'}</div>
                  <div><span style={{ color:'var(--fg-dim)' }}>Secure Boot:</span> {bios.secure_boot || '—'}</div>
                </>
              ) : (
                <div style={{ color:'var(--warn)' }}>dmidecode niedostępny — zainstaluj pakiet</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── CPU ── */}
      {tab === 'cpu' && (
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">{cpu.model || 'Procesor'}</div><div className="card-sub">{cpu.socket ? `socket ${cpu.socket}` : ''}{cpu.tdp ? ` · ${cpu.tdp}` : ''}</div></div>
          </div>
          <div className="card-body" style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14 }}>
            {[
              ['Rdzenie / Wątki', `${cpu.cores || '?'} / ${cpu.threads || '?'}`],
              ['Taktowanie baz.', cpu.base_ghz || '—'],
              ['Boost',          cpu.boost_ghz || '—'],
              ['TDP',            cpu.tdp || '—'],
              ['Socket',         cpu.socket || '—'],
              ['Cache',          cpu.cache || '—'],
              ['Microcode',      cpu.microcode || '—'],
              ['Vendor',         cpu.vendor || '—'],
              ['Family',         cpu.family || '—'],
            ].map(([k,v]) => (
              <div key={k}>
                <div style={{ fontSize:10, color:'var(--fg-dim)', letterSpacing:'.06em', textTransform:'uppercase', marginBottom:3 }}>{k}</div>
                <div className="mono" style={{ fontSize:'var(--fs-sm)' }}>{v}</div>
              </div>
            ))}
            {cpu.flags && cpu.flags.length > 0 && (
              <div style={{ gridColumn:'1/-1' }}>
                <div style={{ fontSize:10, color:'var(--fg-dim)', letterSpacing:'.06em', textTransform:'uppercase', marginBottom:6 }}>Flagi CPU</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                  {cpu.flags.map(f => <span key={f} className="chip mono" style={{ fontSize:10 }}>{f}</span>)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── RAM ── */}
      {tab === 'ram' && (
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Gniazda DIMM</div><div className="card-sub">{ramUsed}/{ramTotal} obsadzone · {ramGB} GB</div></div>
          </div>
          {ram.length === 0 ? (
            <div style={{ padding:32, textAlign:'center', color:'var(--fg-dim)', fontSize:'var(--fs-sm)' }}>
              {data.dmidecode_avail ? 'Brak danych DIMM' : 'Zainstaluj dmidecode aby zobaczyć sloty RAM'}
            </div>
          ) : (
            <div className="card-body" style={{ display:'grid', gridTemplateColumns:`repeat(${Math.min(ram.length, 4)},1fr)`, gap:10 }}>
              {ram.map((s,i) => <RamSlotCard key={i} slot={s}/>)}
            </div>
          )}
        </div>
      )}

      {/* ── PCIe ── */}
      {tab === 'pcie' && (
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">lspci · Urządzenia PCIe</div><div className="card-sub">{pcieUsed}/{pcie.length} obsadzonych</div></div>
            <button className="btn sm" onClick={load}><Icon name="refresh" size={11}/></button>
          </div>
          {!data.lspci_avail ? (
            <div style={{ padding:32, textAlign:'center', color:'var(--fg-dim)', fontSize:'var(--fs-sm)' }}>
              Zainstaluj <code>pciutils</code> aby zobaczyć urządzenia PCIe
            </div>
          ) : pcie.length === 0 ? (
            <div style={{ padding:32, textAlign:'center', color:'var(--fg-dim)', fontSize:'var(--fs-sm)' }}>Brak urządzeń PCIe</div>
          ) : (
            <table className="table">
              <thead><tr><th>Slot</th><th>Urządzenie</th><th>Vendor</th><th>Driver</th><th>Status</th></tr></thead>
              <tbody>
                {pcie.map((s,i) => (
                  <tr key={i}>
                    <td className="mono" style={{ fontWeight:600, fontSize:'var(--fs-xs)' }}>{s.slot}</td>
                    <td>{s.device || <span style={{ color:'var(--fg-dim)', fontStyle:'italic' }}>pusty slot</span>}</td>
                    <td className="mono dim" style={{ fontSize:'var(--fs-xs)' }}>{s.vendor || '—'}</td>
                    <td className="mono">{s.driver || '—'}</td>
                    <td>{s.occupied ? <span className="badge ok">aktywny</span> : <span className="badge">wolny</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── USB ── */}
      {tab === 'usb' && (
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">lsusb · Urządzenia USB</div><div className="card-sub">{usb.length} podłączonych</div></div>
            <button className="btn sm" onClick={load}><Icon name="refresh" size={11}/></button>
          </div>
          {!data.lsusb_avail ? (
            <div style={{ padding:32, textAlign:'center', color:'var(--fg-dim)', fontSize:'var(--fs-sm)' }}>
              Zainstaluj <code>usbutils</code> aby zobaczyć urządzenia USB
            </div>
          ) : usb.length === 0 ? (
            <div style={{ padding:32, textAlign:'center', color:'var(--fg-dim)', fontSize:'var(--fs-sm)' }}>Brak urządzeń USB</div>
          ) : (
            <table className="table">
              <thead><tr><th>Bus</th><th>Vendor:Product</th><th>Urządzenie</th></tr></thead>
              <tbody>
                {usb.map((u,i) => (
                  <tr key={i}>
                    <td className="mono dim">{u.bus}</td>
                    <td className="mono">{u.vendor}</td>
                    <td>{u.device}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── NIC ── */}
      {tab === 'net' && (
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Karty sieciowe</div><div className="card-sub">ethtool · ip link · /sys/class/net</div></div>
            <button className="btn sm" onClick={load}><Icon name="refresh" size={11}/></button>
          </div>
          {nics.length === 0 ? (
            <div style={{ padding:32, textAlign:'center', color:'var(--fg-dim)', fontSize:'var(--fs-sm)' }}>Brak interfejsów sieciowych</div>
          ) : (
            <table className="table">
              <thead><tr><th>Interfejs</th><th>MAC</th><th>Driver</th><th>Prędkość</th><th>MTU</th><th>Stan</th></tr></thead>
              <tbody>
                {nics.map(n => (
                  <tr key={n.name}>
                    <td className="mono" style={{ fontWeight:600 }}>{n.name}</td>
                    <td className="mono dim">{n.mac || '—'}</td>
                    <td className="mono">{n.driver || '—'}</td>
                    <td className="mono">{n.speed || '—'}</td>
                    <td className="mono dim">{n.mtu}</td>
                    <td>{n.state === 'up' ? <span className="badge ok">up</span> : <span className="badge">down</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── BIOS ── */}
      {tab === 'bios' && (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head"><div><div className="card-title">BIOS / UEFI</div></div></div>
            <div className="card-body col" style={{ gap:8, fontSize:'var(--fs-sm)' }}>
              {[
                ['Vendor',      bios.vendor || '—'],
                ['Wersja',      bios.version || '—'],
                ['Data',        bios.date || '—'],
                ['Standard',    bios.efi || '—'],
                ['TPM',         bios.tpm || '—'],
                ['Secure Boot', bios.secure_boot || '—'],
              ].map(([k,v]) => (
                <div key={k} style={{ display:'grid', gridTemplateColumns:'120px 1fr' }}>
                  <span style={{ color:'var(--fg-dim)' }}>{k}</span><span className="mono">{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><div><div className="card-title">Płyta główna</div></div></div>
            <div className="card-body col" style={{ gap:8, fontSize:'var(--fs-sm)' }}>
              {[
                ['Model',       bios.board || '—'],
                ['Rewizja',     bios.board_rev || '—'],
                ['S/N',         bios.board_sn || '—'],
                ['Obudowa',     bios.chassis || '—'],
                ['S/N obudowy', bios.chassis_sn || '—'],
              ].map(([k,v]) => (
                <div key={k} style={{ display:'grid', gridTemplateColumns:'120px 1fr' }}>
                  <span style={{ color:'var(--fg-dim)' }}>{k}</span><span className="mono">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

window.HardwareInventory = HardwareInventory;
