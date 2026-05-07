// visibility.jsx — globalny manager pollerów
// Zatrzymuje wszystkie setInterval gdy tab jest nieaktywny
// Używaj: const id = safeInterval(fn, ms) zamiast setInterval(fn, ms)

(function() {
  const _intervals = new Set();
  let _paused = false;
  let _pausedIntervals = [];

  window.safeInterval = function(fn, ms) {
    if (_paused) {
      // Zapisz do uruchomienia po powrocie
      const handle = { fn, ms, id: null };
      _pausedIntervals.push(handle);
      return handle;
    }
    const id = setInterval(fn, ms);
    _intervals.add(id);
    return id;
  };

  window.safeClearInterval = function(id) {
    if (typeof id === 'number') {
      clearInterval(id);
      _intervals.delete(id);
    } else if (id && id.id) {
      clearInterval(id.id);
      _pausedIntervals = _pausedIntervals.filter(h => h !== id);
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Zatrzymaj wszystkie pollery
      _pausedIntervals = [];
      _intervals.forEach(id => {
        clearInterval(id);
      });
      _intervals.clear();
      _paused = true;
    } else {
      // Wznów — strona widoczna
      _paused = false;
      // Odśwież store od razu po powrocie
      if (window._syncOnce) window._syncOnce();
    }
  });
})();
