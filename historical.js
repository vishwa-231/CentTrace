(() => {
  const storageKey = 'traceboard-bugs';
  const importKey = 'traceboard-historical-imported';
  const sheets = { 'DB Bugs':'DB', 'RB Bugs':'RB', 'HB Bugs':'HB', 'CRM_HF Bugs':'HF', 'CI Bugs':'CI', 'CI_HF Bugs':'CI_HF' };
  const area = document.querySelector('#chartArea');
  const esc = value => String(value || 'Unspecified').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const chart = (title, values) => {
    const entries = Object.entries(values).sort((a,b) => b[1]-a[1]).slice(0, 7), max = entries[0]?.[1] || 1;
    return `<article class="chart"><h3>${title}</h3>${entries.map(([name,count]) => `<div class="bar-row"><span title="${esc(name)}">${esc(name)}</span><i><b style="width:${Math.round(count/max*100)}%"></b></i><em>${count}</em></div>`).join('')}</article>`;
  };
  function showCharts() {
    const records = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const tally = key => records.reduce((result, record) => { const value = record[key] || 'Unspecified'; result[value] = (result[value] || 0) + 1; return result; }, {});
    const historical = records.filter(record => record.imported);
    area.innerHTML = historical.length ? `<p class="analytics-note">${historical.length.toLocaleString()} historical records imported from your workbook.</p><div class="chart-grid">${chart('Bugs by category', tally('category'))}${chart('Bugs by release type', tally('release'))}</div>` : '<p class="chart-loading">No historical records yet.</p>';
  }
  async function importWorkbook() {
    if (localStorage.getItem(importKey)) return showCharts();
    try {
      const response = await fetch('Complete%20Bug%20Analysis.xlsx');
      if (!response.ok || !window.XLSX) throw new Error('Workbook could not be read');
      const book = XLSX.read(await response.arrayBuffer(), {type:'array', cellDates:true});
      const imported = [];
      Object.entries(sheets).forEach(([sheetName, release]) => {
        const sheet = book.Sheets[sheetName]; if (!sheet) return;
        XLSX.utils.sheet_to_json(sheet, {defval:''}).forEach((row, index) => {
          const link = row['Bug Link']; if (!link || !String(link).startsWith('http')) return;
          const date = row.Date instanceof Date ? row.Date.getTime() : Date.now();
          imported.push({ id:`import-${release}-${index}-${String(link).slice(-12)}`, title:row.Feature || row.Type || 'Historical bug', link, milestone:String(row.Milestone || ''), release, category:row.Type || 'Unspecified', notes:row.Comments || '', startedAt:date, finishedAt:date, timeUnknown:true, imported:true, status:'Fixed' });
        });
      });
      const current = JSON.parse(localStorage.getItem(storageKey) || '[]').filter(record => !record.imported);
      localStorage.setItem(storageKey, JSON.stringify([...current, ...imported]));
      localStorage.setItem(importKey, 'true');
      location.reload();
    } catch (error) {
      area.innerHTML = '<p class="chart-loading">The workbook could not be imported. Keep this page open through <code>http://localhost:8000</code> and refresh.</p>';
    }
  }
  importWorkbook();
})();
