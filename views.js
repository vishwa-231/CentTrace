(() => {
  const links = document.querySelectorAll('.nav-item[data-view]');
  const setView = view => {
    const summary = view === 'summary';
    document.body.classList.toggle('summary-open', summary);
    links.forEach(link => link.classList.toggle('active', link.dataset.view === view && (summary || link.getAttribute('href') === '#today')));
    window.scrollTo({top:0, behavior:'instant'});
  };
  const applyHash = () => setView(location.hash === '#bug-summary' ? 'summary' : 'tracker');
  links.forEach(link => link.addEventListener('click', () => setView(link.dataset.view)));
  window.addEventListener('hashchange', applyHash);
  applyHash();
})();
