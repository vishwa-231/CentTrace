const $ = (s) => document.querySelector(s);
const dialog = $('#bugDialog');
const form = $('#bugForm');
let activeFilter = 'all';
let bugs = JSON.parse(localStorage.getItem('traceboard-bugs') || '[]');

const escapeHTML = (text='') => text.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const save = () => localStorage.setItem('traceboard-bugs', JSON.stringify(bugs));
function render(){
  const filtered = activeFilter === 'all' ? bugs : bugs.filter(b => b.status === activeFilter);
  $('#bugList').innerHTML = filtered.length ? filtered.map((b, i) => `<article class="bug"><span class="bug-id">${String(bugs.indexOf(b)+1).padStart(2,'0')}</span><div><div class="bug-title">${escapeHTML(b.title)}</div><div class="bug-meta">${b.steps ? escapeHTML(b.steps.split('\n')[0]) : 'No reproduction steps yet'} · ${b.created}</div></div><div class="tag priority-${b.priority.toLowerCase()}">${b.priority.toUpperCase()}</div><div class="status status-${b.status.toLowerCase()}">${b.status}</div><button class="more" title="Cycle status" data-id="${b.id}">···</button></article>`).join('') : `<div class="empty"><strong>No bugs here yet.</strong>Log your first issue and give your debugging work a home.</div>`;
  const count = status => bugs.filter(b => b.status === status).length;
  $('#openCount').textContent = count('Open'); $('#investigatingCount').textContent = count('Investigating'); $('#fixedCount').textContent = count('Fixed'); $('#todayCount').textContent = bugs.length;
  $('#bugSummary').textContent = bugs.length ? `${bugs.length} issue${bugs.length === 1 ? '' : 's'} recorded — one step closer to clarity.` : 'A clear record makes debugging calmer.';
}
$('#newBugBtn').onclick = () => dialog.showModal();
$('#closeDialog').onclick = $('#cancelBtn').onclick = () => dialog.close();
form.onsubmit = e => { e.preventDefault(); const data = Object.fromEntries(new FormData(form)); bugs.unshift({...data,id:Date.now(),created:'Added today'}); save(); form.reset(); dialog.close(); render(); };
document.addEventListener('click', e => { const btn=e.target.closest('.more'); if(btn){const bug=bugs.find(b=>b.id===+btn.dataset.id); bug.status=bug.status==='Open'?'Investigating':bug.status==='Investigating'?'Fixed':'Open';save();render();} });
document.querySelectorAll('.filter').forEach(button => button.onclick = () => {activeFilter=button.dataset.filter;document.querySelectorAll('.filter').forEach(b=>b.classList.toggle('active',b===button));render()});
render();
