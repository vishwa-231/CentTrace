const $ = s => document.querySelector(s);
const startDialog = $('#startDialog'), finishDialog = $('#finishDialog');
let activeFilter = 'all';
let bugs = JSON.parse(localStorage.getItem('traceboard-bugs') || '[]');
const escapeHTML = (text = '') => String(text).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const save = () => localStorage.setItem('traceboard-bugs', JSON.stringify(bugs));
const duration = (start, end = Date.now()) => { const s = Math.max(0, Math.floor((end - start) / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s % 60}s`; };
function render() {
  const selected = activeFilter === 'all' ? bugs : bugs.filter(b => b.status === activeFilter);
  $('#bugList').innerHTML = selected.length ? selected.map(b => { const done = !!b.finishedAt, elapsed = b.timeUnknown ? 'Not timed' : duration(b.startedAt, b.finishedAt); return `<article class="bug"><span class="bug-id">${String(bugs.indexOf(b)+1).padStart(2,'0')}</span><div><div class="bug-title">${escapeHTML(b.title)}</div><a class="bug-link" target="_blank" rel="noreferrer" href="${escapeHTML(b.link)}">Open bug ↗</a></div><div>${done ? `<span class="tag priority-low">${escapeHTML(b.release || '—')}</span><div class="done-meta">${escapeHTML(b.milestone || 'No milestone')}</div>` : '<span class="tag priority-medium">IN PROGRESS</span>'}</div><div class="elapsed ${done ? '' : 'live'}">${elapsed}${done ? '' : ' running'}</div>${done ? '<span class="status status-fixed">Saved</span>' : `<button class="finish-btn" data-finish="${b.id}">Finish →</button>`}</article>`; }).join('') : '<div class="empty"><strong>No bugs here yet.</strong>Start a debugging timer when you pick up your first issue.</div>';
  const active = bugs.filter(b => !b.finishedAt).length, done = bugs.length - active;
  const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const fixedThisWeek = bugs.filter(b => b.finishedAt && b.finishedAt >= weekStart && b.finishedAt <= Date.now()).length;
  $('#openCount').textContent = active; $('#investigatingCount').textContent = active; $('#fixedCount').textContent = fixedThisWeek; $('#todayCount').textContent = bugs.length;
  $('#bugSummary').textContent = bugs.length ? `${active} active · ${done} completed overall · ${fixedThisWeek} verified this week.` : 'A clear record makes debugging calmer.';
}
$('#newBugBtn').onclick = () => startDialog.showModal();
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
$('#startForm').onsubmit = e => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.target)); bugs.unshift({...data, id:Date.now(), startedAt:Date.now(), status:'Investigating'}); save(); e.target.reset(); startDialog.close(); render(); };
function openFinish(id) { const bug = bugs.find(b => b.id === id); if (!bug) return; $('#finishForm [name="id"]').value = id; $('#timerReadout').textContent = `Timer running: ${duration(bug.startedAt)} so far.`; finishDialog.showModal(); }
document.addEventListener('click', e => { const button = e.target.closest('[data-finish]'); if (button) openFinish(Number(button.dataset.finish)); });
$('#finishForm').onsubmit = e => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.target)), bug = bugs.find(b => b.id === Number(data.id)); if (!bug) return; Object.assign(bug, data, {finishedAt:Date.now(), status:'Fixed'}); save(); e.target.reset(); finishDialog.close(); render(); };
document.querySelectorAll('.filter').forEach(b => b.onclick = () => { activeFilter = b.dataset.filter; document.querySelectorAll('.filter').forEach(x => x.classList.toggle('active', x === b)); render(); });
render(); setInterval(render, 1000);
