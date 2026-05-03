// ===== Reaktywny store =====
// Zastępuje window.POOLS, window.CONTAINERS itd.
// Komponenty wywołują useStore('POOLS') i automatycznie się re-renderują
// gdy dane się zmienią.

const _listeners = {};
const _data = {};

function storeSet(key, value) {
  _data[key] = value;
  window[key] = value; // zachowujemy kompatybilność z kodem który czyta window.*
  if (_listeners[key]) {
    _listeners[key].forEach(fn => fn(value));
  }
}

function storeGet(key) {
  return _data[key] !== undefined ? _data[key] : window[key];
}

function useStore(key) {
  const [val, setVal] = React.useState(() => storeGet(key));
  React.useEffect(() => {
    // Synchronizuj jeśli dane już są w _data
    if (_data[key] !== undefined) setVal(_data[key]);
    if (!_listeners[key]) _listeners[key] = new Set();
    _listeners[key].add(setVal);
    return () => _listeners[key].delete(setVal);
  }, [key]);
  return val;
}

window.storeSet = storeSet;
window.storeGet = storeGet;
window.useStore = useStore;
