(function () {
  const vscode = acquireVsCodeApi();

  const targetEl = document.getElementById('target');
  const metaEl = document.getElementById('meta');
  const tabsEl = document.getElementById('tabs');
  const contentEl = document.getElementById('content');
  const copyButton = document.getElementById('copy');
  const formatSelect = document.getElementById('format');

  const MAX_TEXT_CELL_CHARS = 20000;

  let results = null;
  let activeIndex = 0;

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'render') {
      return;
    }
    results = message.results;
    if (!results.statements.some((statement) => statement.index === activeIndex)) {
      activeIndex = results.statements.length > 0 ? results.statements[0].index : 0;
    }
    render();
  });

  copyButton.addEventListener('click', () => {
    const statement = activeStatement();
    if (!statement) {
      return;
    }
    vscode.postMessage({ type: 'copy', format: formatSelect.value, index: statement.index });
  });

  function activeStatement() {
    if (!results) {
      return undefined;
    }
    return results.statements.find((statement) => statement.index === activeIndex);
  }

  function render() {
    tabsEl.textContent = '';
    contentEl.textContent = '';

    if (!results) {
      targetEl.textContent = 'No query run yet';
      targetEl.title = '';
      metaEl.textContent = '';
      contentEl.appendChild(emptyState('Run a query from an SQL editor to see results here.'));
      return;
    }

    targetEl.textContent = results.targetLabel;
    targetEl.title = results.targetPath || results.targetLabel;
    const total = typeof results.totalMs === 'number' ? results.totalMs.toFixed(1) : String(results.totalMs);
    const count = results.statements.length;
    metaEl.textContent = `${count} statement${count === 1 ? '' : 's'} · ${total} ms`;

    for (const statement of results.statements) {
      tabsEl.appendChild(tabButton(statement));
    }

    const active = activeStatement();
    if (active) {
      contentEl.appendChild(statementPanel(active));
    }
    contentEl.scrollTop = 0;
  }

  function tabButton(statement) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab';
    if (statement.index === activeIndex) {
      button.classList.add('active');
    }
    if (statement.status === 'error') {
      button.classList.add('failed');
    }
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', statement.index === activeIndex ? 'true' : 'false');
    button.textContent = tabLabel(statement);
    button.title = statement.sql;
    button.addEventListener('click', () => {
      activeIndex = statement.index;
      render();
    });
    return button;
  }

  function tabLabel(statement) {
    const parts = [String(statement.index), statement.keyword];
    if (statement.status === 'rows') {
      const count = (statement.rows || []).length;
      parts.push(`${count}${statement.truncated ? '+' : ''} ${count === 1 ? 'row' : 'rows'}`);
    } else if (statement.status === 'change') {
      parts.push(`${statement.changes} changed`);
    } else {
      parts.push('error');
    }
    return parts.join(' · ');
  }

  function statementPanel(statement) {
    const panel = document.createElement('div');
    panel.className = 'panel';

    if (statement.status === 'error') {
      panel.appendChild(errorPanel(statement));
      panel.appendChild(sqlDetails(statement));
      return panel;
    }

    if (statement.status === 'change') {
      const summary = document.createElement('div');
      summary.className = 'summary';
      const affected = statement.changes === 1 ? '1 row affected' : `${statement.changes} rows affected`;
      summary.textContent = `${affected} · last insert rowid ${statement.lastInsertRowid} · ${statement.durationMs} ms`;
      panel.appendChild(summary);
      panel.appendChild(sqlDetails(statement));
      return panel;
    }

    if (statement.truncated) {
      const banner = document.createElement('div');
      banner.className = 'banner';
      banner.textContent = `Showing the first ${(statement.rows || []).length} rows — the row limit was reached. Raise "sqlient.maxRows" to fetch more.`;
      panel.appendChild(banner);
    }

    panel.appendChild(resultTable(statement));
    const footer = document.createElement('div');
    footer.className = 'footer';
    const rows = (statement.rows || []).length;
    footer.textContent = `${rows} ${rows === 1 ? 'row' : 'rows'} · ${statement.durationMs} ms`;
    panel.appendChild(footer);
    panel.appendChild(sqlDetails(statement));
    return panel;
  }

  function errorPanel(statement) {
    const box = document.createElement('div');
    box.className = 'error';
    const title = document.createElement('div');
    title.className = 'error-title';
    title.textContent = `Statement ${statement.index} failed`;
    box.appendChild(title);

    const message = document.createElement('div');
    message.className = 'error-message';
    message.textContent = (statement.error && statement.error.message) || 'Unknown error';
    box.appendChild(message);

    if (statement.error && statement.error.code) {
      const code = document.createElement('div');
      code.className = 'error-code';
      code.textContent = statement.error.code;
      box.appendChild(code);
    }

    const location = document.createElement('div');
    location.className = 'error-code';
    location.textContent = `line ${statement.line} · ${statement.durationMs} ms`;
    box.appendChild(location);

    return box;
  }

  function resultTable(statement) {
    const columns = statement.columns || [];
    const rows = statement.rows || [];
    const numericColumns = columns.map((_, columnIndex) => isNumericColumn(rows, columnIndex));
    const table = document.createElement('table');

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'gutter';
    corner.textContent = '#';
    headRow.appendChild(corner);
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      const th = document.createElement('th');
      th.textContent = columns[columnIndex];
      th.title = columns[columnIndex];
      if (numericColumns[columnIndex]) {
        th.classList.add('num');
      }
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    if (rows.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.className = 'no-rows';
      td.colSpan = columns.length + 1;
      td.textContent = 'Query returned no rows.';
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      rows.forEach((row, rowIndex) => {
        const tr = document.createElement('tr');
        const number = document.createElement('td');
        number.className = 'gutter';
        number.textContent = String(rowIndex + 1);
        tr.appendChild(number);
        for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
          const td = document.createElement('td');
          if (numericColumns[columnIndex]) {
            td.classList.add('num');
          }
          appendCell(td, columnIndex < row.length ? row[columnIndex] : null);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      });
    }
    table.appendChild(tbody);
    return table;
  }

  function isNumericColumn(rows, columnIndex) {
    let sawValue = false;
    for (const row of rows) {
      const cell = columnIndex < row.length ? row[columnIndex] : null;
      if (cell === null || cell === undefined) {
        continue;
      }
      sawValue = true;
      if (typeof cell === 'number' || (typeof cell === 'object' && cell.$type === 'bigint')) {
        continue;
      }
      return false;
    }
    return sawValue;
  }

  function appendCell(td, cell) {
    if (cell === null) {
      const span = document.createElement('span');
      span.className = 'null';
      span.textContent = 'NULL';
      td.appendChild(span);
      return;
    }

    if (typeof cell === 'number') {
      td.textContent = String(cell);
      return;
    }

    if (typeof cell === 'string') {
      td.classList.add('text');
      const span = document.createElement('span');
      span.className = 'text-value';
      if (cell.length > MAX_TEXT_CELL_CHARS) {
        span.textContent = `${cell.slice(0, MAX_TEXT_CELL_CHARS)}…`;
        span.title = `${cell.slice(0, 2000)}… (${cell.length} characters)`;
      } else {
        span.textContent = cell;
        span.title = cell.length > 2000 ? `${cell.slice(0, 2000)}…` : cell;
      }
      td.appendChild(span);
      return;
    }

    if (cell.$type === 'bigint') {
      td.classList.add('bigint');
      td.textContent = cell.value;
      return;
    }

    if (cell.$type === 'blob') {
      td.classList.add('blob');
      td.textContent = `BLOB (${cell.bytes} byte${cell.bytes === 1 ? '' : 's'})`;
      td.title = `0x${cell.hex}${cell.truncated ? '…' : ''}`;
      return;
    }

    td.textContent = String(cell);
  }

  function sqlDetails(statement) {
    const details = document.createElement('details');
    details.className = 'sql-details';
    const summary = document.createElement('summary');
    summary.textContent = `SQL · line ${statement.line}`;
    const pre = document.createElement('pre');
    pre.textContent = statement.sql;
    details.appendChild(summary);
    details.appendChild(pre);
    return details;
  }

  function emptyState(text) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = text;
    return div;
  }

  render();
  vscode.postMessage({ type: 'ready' });
})();
