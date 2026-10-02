(() => {
  const bugsKey = 'traceboard-bugs', importKey = 'traceboard-historical-v2';
  const sheets = {'DB Bugs':'DB','RB Bugs':'RB','HB Bugs':'HB','CRM_HF Bugs':'HF','CI Bugs':'CI','CI_HF Bugs':'CI_HF'};
  const area = document.querySelector('#chartArea');
  const esc = value => String(value || 'Unspecified').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const dateFromSheet = value => {
    if (value instanceof Date && !isNaN(value)) return value.getTime();
    if (typeof value === 'number') return Date.UTC(1899, 11, 30) + value * 86400000;
    const numeric = Number(value); if (Number.isFinite(numeric) && numeric > 30000) return Date.UTC(1899, 11, 30) + numeric * 86400000;
    const parsed = Date.parse(value); return isNaN(parsed) ? null : parsed;
  };
  const counts = (records, field) => records.reduce((all, record) => { const name = record[field] || 'Unspecified'; all[name] = (all[name] || 0) + 1; return all; }, {});
  const barChart = (title, values) => {
    const items = Object.entries(values).sort((a,b) => b[1]-a[1]).slice(0,8), max = items[0]?.[1] || 1;
    return `<article class="chart"><h3>${title}</h3>${items.map(([name,count]) => `<div class="bar-row"><span title="${esc(name)}">${esc(name)}</span><i><b style="width:${Math.round(count/max*100)}%"></b></i><em>${count}</em></div>`).join('')}</article>`;
  };
  const timeChart = records => {
    const now = new Date(), startOfWeek = new Date(now); startOfWeek.setHours(0,0,0,0); startOfWeek.setDate(now.getDate()-((now.getDay()+6)%7));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1), endOfWeek = Date.now();
    const dated = records.filter(record => record.verifiedAt && record.verifiedAt <= endOfWeek);
    const week = dated.filter(record => record.verifiedAt >= startOfWeek.getTime()).length;
    const month = dated.filter(record => record.verifiedAt >= startOfMonth.getTime()).length;
    const max = Math.max(week, month, 1);
    return `<article class="chart comparison"><h3>Verified: this week vs this month</h3><p class="chart-caption">Based on the verification date in your workbook.</p><div class="compare-bars"><div><b style="height:${Math.round(week/max*100)}%"></b><span>${week}</span><small>This week</small></div><div><b style="height:${Math.round(month/max*100)}%"></b><span>${month}</span><small>This month</small></div></div></article>`;
  };
  function showDashboard() {
    const records = JSON.parse(localStorage.getItem(bugsKey) || '[]');
    const historical = records.filter(record => record.imported);
    area.innerHTML = historical.length ? `<div class="dashboard-summary"><span><b>${historical.length.toLocaleString()}</b> historical bugs</span><span><b>${new Set(historical.map(r => r.owner).filter(Boolean)).size}</b> owners</span><span><b>${new Set(historical.map(r => r.release).filter(Boolean)).size}</b> release types</span></div><div class="chart-grid">${barChart('Bugs by release type', counts(records,'release'))}${barChart('Bugs by owner', counts(historical,'owner'))}${timeChart(historical)}</div>` : '<p class="chart-loading">No historical records yet.</p>';
  }
  async function importWorkbook() {
    if (localStorage.getItem(importKey)) return showDashboard();
    try {
      const response = await fetch('Complete%20Bug%20Analysis.xlsx');
      if (!response.ok || !window.XLSX) throw new Error('Workbook unavailable');
      const book = XLSX.read(await response.arrayBuffer(), {type:'array', cellDates:true}), imported = [];
      Object.entries(sheets).forEach(([name, release]) => {
        const sheet = book.Sheets[name]; if (!sheet) return;
        XLSX.utils.sheet_to_json(sheet, {defval:''}).forEach((row, index) => {
          const link = row['Bug Link']; if (!String(link).startsWith('http')) return;
          const verifiedAt = dateFromSheet(row.Date);
          imported.push({id:`import-${release}-${index}-${String(link).slice(-12)}`,title:row.Feature || row.Type || 'Historical bug',link,milestone:String(row.Milestone || ''),release,category:row.Type || 'Unspecified',owner:row.Owner || 'Unassigned',notes:row.Comments || '',startedAt:verifiedAt,finishedAt:verifiedAt,timeUnknown:true,verifiedAt,imported:true,status:'Fixed'});
        });
      });
      const current = JSON.parse(localStorage.getItem(bugsKey) || '[]').filter(record => !record.imported);
      localStorage.setItem(bugsKey, JSON.stringify([...current,...imported]));
      localStorage.setItem(importKey,'true'); location.reload();
    } catch (error) { area.innerHTML = '<p class="chart-loading">The workbook could not be imported. Open the tracker via <code>http://localhost:8000</code>, then refresh.</p>'; }
  }
  importWorkbook();
})();
