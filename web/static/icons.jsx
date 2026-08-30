// Minimal stroke icon set — original
const Icon = ({ name, size = 16, ...rest }) => {
  const paths = ICONS[name];
  if (!paths) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {paths}
    </svg>
  );
};

const ICONS = {
  dashboard: (<>
    <rect x="3" y="3" width="7" height="9" rx="1.5"/>
    <rect x="14" y="3" width="7" height="5" rx="1.5"/>
    <rect x="14" y="12" width="7" height="9" rx="1.5"/>
    <rect x="3" y="16" width="7" height="5" rx="1.5"/>
  </>),
  disk: (<>
    <ellipse cx="12" cy="6" rx="8" ry="2.5"/>
    <path d="M4 6v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V6"/>
    <path d="M4 12v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6"/>
  </>),
  docker: (<>
    <rect x="3" y="11" width="3" height="3" rx="0.4"/>
    <rect x="7" y="11" width="3" height="3" rx="0.4"/>
    <rect x="11" y="11" width="3" height="3" rx="0.4"/>
    <rect x="7" y="7" width="3" height="3" rx="0.4"/>
    <rect x="11" y="7" width="3" height="3" rx="0.4"/>
    <rect x="11" y="3" width="3" height="3" rx="0.4"/>
    <path d="M3 14h13c2 0 4-1 5-3-1-0.4-3-0.4-4 0.6"/>
  </>),
  network: (<>
    <circle cx="12" cy="12" r="9"/>
    <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>
  </>),
  share: (<>
    <path d="M4 7h12a4 4 0 010 8H8"/>
    <path d="M11 18l-3-3 3-3"/>
    <rect x="17" y="3" width="4" height="4" rx="0.5"/>
  </>),
  media: (<>
    <rect x="3" y="5" width="18" height="14" rx="2"/>
    <path d="M10 9l5 3-5 3z" fill="currentColor"/>
  </>),
  log: (<>
    <path d="M5 3h10l4 4v14H5z"/>
    <path d="M14 3v5h5"/>
    <path d="M8 13h8M8 17h6M8 9h3"/>
  </>),
  process: (<>
    <rect x="4" y="4" width="16" height="16" rx="2"/>
    <path d="M8 9h8M8 13h5M8 17h3"/>
    <circle cx="17" cy="15" r="2" fill="currentColor"/>
  </>),
  terminal: (<>
    <rect x="3" y="4" width="18" height="16" rx="2"/>
    <path d="M7 9l3 3-3 3M13 15h4"/>
  </>),
  package: (<>
    <path d="M21 8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
    <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/>
  </>),
  users: (<>
    <circle cx="9" cy="8" r="3.5"/>
    <path d="M3 20c0-3.5 3-6 6-6s6 2.5 6 6"/>
    <circle cx="17" cy="9" r="2.5"/>
    <path d="M15 20c0-2.5 1.5-4.5 4-4.5s2 0 2 0"/>
  </>),
  settings: (<>
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>
  </>),
  search: (<>
    <circle cx="11" cy="11" r="7"/>
    <path d="m20 20-3.5-3.5"/>
  </>),
  bell: (<>
    <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9z"/>
    <path d="M10 21a2 2 0 004 0"/>
  </>),
  plus: (<><path d="M12 5v14M5 12h14"/></>),
  refresh: (<><path d="M3 12a9 9 0 0115-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 01-15 6.7L3 16"/><path d="M3 21v-5h5"/></>),
  more: (<><circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/></>),
  play: (<><path d="M7 5v14l12-7z" fill="currentColor"/></>),
  stop: (<><rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor"/></>),
  pause: (<><rect x="7" y="5" width="3.5" height="14" fill="currentColor"/><rect x="13.5" y="5" width="3.5" height="14" fill="currentColor"/></>),
  restart: (<><path d="M3 12a9 9 0 1015-6.7L21 8"/><path d="M21 3v5h-5"/></>),
  trash: (<><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></>),
  check: (<><path d="M5 12l4 4L19 7"/></>),
  close: (<><path d="M6 6l12 12M18 6L6 18"/></>),
  chevron: (<><path d="M9 6l6 6-6 6"/></>),
  download: (<><path d="M12 4v12m0 0l-5-5m5 5l5-5"/><path d="M4 20h16"/></>),
  upload: (<><path d="M12 20V8m0 0l-5 5m5-5l5 5"/><path d="M4 4h16"/></>),
  cpu: (<>
    <rect x="6" y="6" width="12" height="12" rx="2"/>
    <rect x="9" y="9" width="6" height="6" rx="1"/>
    <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>
  </>),
  ram: (<><rect x="2" y="8" width="20" height="9" rx="1"/><path d="M6 8v9M10 8v9M14 8v9M18 8v9"/></>),
  thermometer: (<><path d="M12 14V4a2 2 0 014 0v10a4 4 0 11-4 0z" transform="translate(-2 0)"/><circle cx="12" cy="18" r="2" fill="currentColor"/></>),
  globe: (<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a13 13 0 010 18M12 3a13 13 0 000 18"/></>),
  shield: (<><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></>),
  link: (<><path d="M9 15l6-6"/><path d="M14.5 6.5a3 3 0 014 4L16 13"/><path d="M9.5 17.5a3 3 0 01-4-4L8 11"/></>),
  edit: (<><path d="M4 20h4l11-11-4-4L4 16z"/></>),
  filter: (<><path d="M4 5h16l-6 8v6l-4-2v-4z"/></>),
  pause2: (<><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></>),
  arrow_down: (<><path d="M12 5v14m0 0l-5-5m5 5l5-5"/></>),
  arrow_up: (<><path d="M12 19V5m0 0l-5 5m5-5l5 5"/></>),
  hdd: (<><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M13 11h6M13 13h4"/></>),
  ssd: (<><rect x="3" y="7" width="18" height="10" rx="1"/><path d="M7 11h2M11 11h2M15 11h2M7 14h10"/></>),
  folder: (<><path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></>),
  key: (<><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/></>),
  clock: (<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></>),
  mail: (<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></>),
  grid: (<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>),
  drag: (<><circle cx="9" cy="5" r="1.2" fill="currentColor"/><circle cx="15" cy="5" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="19" r="1.2" fill="currentColor"/><circle cx="15" cy="19" r="1.2" fill="currentColor"/></>),
  send: (<><path d="M22 2L11 13M22 2L15 22l-4-9-9-4z"/></>),
  bolt: (<><path d="M13 2L4 14h7l-1 8 9-12h-7z" strokeLinejoin="round"/></>),
  fan: (<>
    <circle cx="12" cy="12" r="2"/>
    <path d="M12 10c0-3 1-7 4-7 2 0 3 2 2 4-1 1.6-3 2.5-6 3"/>
    <path d="M14 12c3 0 7 1 7 4 0 2-2 3-4 2-1.6-1-2.5-3-3-6"/>
    <path d="M12 14c0 3-1 7-4 7-2 0-3-2-2-4 1-1.6 3-2.5 6-3"/>
    <path d="M10 12c-3 0-7-1-7-4 0-2 2-3 4-2 1.6 1 2.5 3 3 6"/>
  </>),
  camera: (<>
    <path d="M3 8a2 2 0 012-2h2l2-2h6l2 2h2a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
    <circle cx="12" cy="13" r="4"/>
  </>),
  router: (<>
    <rect x="2" y="13" width="20" height="8" rx="1.5"/>
    <path d="M7 13V8.5a5 5 0 0110 0V13"/>
    <circle cx="7"  cy="17" r="1" fill="currentColor"/>
    <circle cx="11" cy="17" r="1" fill="currentColor"/>
    <path d="M16 16h4M16 18.5h3"/>
    <circle cx="12" cy="13" r="1.2" fill="currentColor"/>
  </>),
  signal: (<>
    <path d="M1 9a15 15 0 0122 0M5 13a10 10 0 0114 0M9 17a5 5 0 016 0"/>
    <circle cx="12" cy="20" r="1.2" fill="currentColor"/>
  </>),
};

window.Icon = Icon;
