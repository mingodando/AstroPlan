(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const pad2 = (n) => String(n).padStart(2, '0');
  const isoLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const todayStr = () => isoLocal(new Date());
  const parseISO = (iso) => new Date(iso + 'T00:00:00');

  const COLORS = [
    { key: 'orange', label: 'Orange' },
    { key: 'blue', label: 'Blue' },
    { key: 'green', label: 'Green' },
    { key: 'yellow', label: 'Yellow' },
    { key: 'purple', label: 'Purple' },
    { key: 'gray', label: 'Gray' },
  ];
  const COLOR_KEYS = COLORS.map((c) => c.key);
  const REPEATS = ['none', 'daily', 'weekly', 'monthly'];

  // ---------- State ----------
  let tasks = [];
  let assessments = [];
  let currentFilter = 'all';
  let searchTerm = '';
  let selectedColor = 'orange';
  let editColor = 'orange';
  let weekOffset = 0;
  let lastRenderedDay = todayStr();
  const freshIds = new Set(); // tasks to animate in on next render
  const spawnedNext = new Map(); // repeating task id -> id of the next occurrence it created

  function normalizeTask(row) {
    return {
      id: row.id,
      title: row.title || '',
      notes: row.notes || '',
      due: row.due ? String(row.due).slice(0, 10) : '',
      repeat: REPEATS.includes(row.repeat) ? row.repeat : 'none',
      color: COLOR_KEYS.includes(row.color) ? row.color : 'orange',
      completed: !!row.completed,
      createdAt: row.created_at || new Date().toISOString(),
    };
  }

  function taskRow(t) {
    return {
      id: t.id,
      user_id: window.currentUser.id,
      title: t.title,
      notes: t.notes,
      due: t.due || null,
      repeat: t.repeat,
      color: t.color,
      completed: t.completed,
      created_at: t.createdAt,
    };
  }

  function normalizeAssessment(row) {
    return { id: row.id, name: row.name || '', date: row.date ? String(row.date).slice(0, 10) : '' };
  }

  function assessmentRow(a) {
    return { id: a.id, user_id: window.currentUser.id, name: a.name, date: a.date };
  }

  async function loadData() {
    const userId = window.currentUser.id;
    try {
      const [taskRes, assessRes] = await Promise.all([
        window.sb.from('tasks').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
        window.sb.from('assessments').select('*').eq('user_id', userId).order('date', { ascending: true }),
      ]);
      if (taskRes.error) throw taskRes.error;
      if (assessRes.error) throw assessRes.error;
      tasks = (taskRes.data || []).map(normalizeTask);
      assessments = (assessRes.data || []).map(normalizeAssessment);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  async function resync() {
    if (await loadData()) renderAll();
  }

  // ---------- Toast ----------
  let toastTimer = null;
  let toastHandler = null;

  function toast(msg, opts = {}) {
    const el = $('#toast');
    const actionBtn = $('#toastAction');
    $('#toastMsg').textContent = msg;
    toastHandler = opts.onAction || null;
    actionBtn.hidden = !toastHandler;
    actionBtn.textContent = opts.action || 'Undo';
    el.classList.toggle('error', !!opts.error);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, opts.duration || (toastHandler ? 6000 : 2400));
  }

  function hideToast() {
    $('#toast').classList.remove('show');
    toastHandler = null;
  }

  // ---------- Helpers ----------
  function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function fmtShort(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function daysBetween(fromISO, toISO) {
    return Math.round((parseISO(toISO) - parseISO(fromISO)) / 86400000);
  }

  function relativeLabel(iso) {
    const diff = daysBetween(todayStr(), iso);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (diff > 1 && diff < 7) return `In ${diff} days`;
    return fmtShort(parseISO(iso));
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  function flagInvalid(input, message) {
    input.classList.add('invalid');
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    if (message) toast(message, { error: true });
    const clear = () => {
      input.classList.remove('invalid');
      input.removeAttribute('aria-invalid');
      input.removeEventListener('input', clear);
    };
    input.addEventListener('input', clear);
    setTimeout(clear, 2400);
  }

  function setBusy(btn, busy, label) {
    if (busy) {
      btn.dataset.label = btn.textContent;
      btn.textContent = label;
      btn.disabled = true;
    } else {
      btn.textContent = btn.dataset.label || btn.textContent;
      btn.disabled = false;
    }
  }

  function nextOccurrence(fromISO, repeat) {
    const today = todayStr();
    let d = parseISO(fromISO || today);
    const anchorDay = d.getDate();
    const step = () => {
      if (repeat === 'daily') d.setDate(d.getDate() + 1);
      else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
      else {
        // Monthly: keep the original day where possible (Jan 31 -> Feb 28 -> Mar 31).
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const lastDay = new Date(y, m + 1, 0).getDate();
        d = new Date(y, m, Math.min(anchorDay, lastDay));
      }
    };
    step();
    // Skip past occurrences so an overdue repeating task lands on today or later.
    let guard = 0;
    while (isoLocal(d) < today && guard++ < 1000) step();
    return isoLocal(d);
  }

  // ---------- Icons ----------
  const icon = (paths, sw = 2) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const iconCheck = () => icon('<polyline points="20 6 9 17 4 12"/>', 3);
  const iconCalendar = () => icon('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>');
  const iconRepeat = () => icon('<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>');
  const iconEdit = () => icon('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>');
  const iconTrash = () => icon('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>');

  // ---------- Color pickers ----------
  function renderSwatches(container, selected) {
    container.innerHTML = COLORS.map(
      (c) => `<button type="button" class="swatch${c.key === selected ? ' active' : ''}" data-color="${c.key}"
        role="radio" aria-checked="${c.key === selected}" aria-label="${c.label}" title="${c.label}"
        tabindex="${c.key === selected ? 0 : -1}"></button>`
    ).join('');
  }

  function bindSwatches(container, onPick) {
    const pick = (sw) => {
      $$('.swatch', container).forEach((s) => {
        const on = s === sw;
        s.classList.toggle('active', on);
        s.setAttribute('aria-checked', String(on));
        s.tabIndex = on ? 0 : -1;
      });
      onPick(sw.dataset.color);
    };
    container.addEventListener('click', (e) => {
      const sw = e.target.closest('.swatch');
      if (sw) pick(sw);
    });
    container.addEventListener('keydown', (e) => {
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      const all = $$('.swatch', container);
      const i = all.indexOf(document.activeElement);
      const next = all[(i + dir + all.length) % all.length];
      pick(next);
      next.focus();
    });
  }

  // ---------- Modals ----------
  const modalStack = [];
  const modalCloseHooks = {};

  function openModal(id, focusSel) {
    const overlay = document.getElementById(id);
    if (!overlay.classList.contains('open')) {
      modalStack.push({ id, returnFocus: document.activeElement });
      overlay.classList.add('open');
      document.body.classList.add('modal-open');
    }
    requestAnimationFrame(() => {
      const target = (focusSel && $(focusSel, overlay)) || $('.modal-close', overlay);
      if (target) target.focus({ preventScroll: true });
    });
  }

  function closeModal(id) {
    const overlay = document.getElementById(id);
    if (!overlay.classList.contains('open')) return;
    overlay.classList.remove('open');
    const idx = modalStack.findIndex((m) => m.id === id);
    const entry = idx >= 0 ? modalStack.splice(idx, 1)[0] : null;
    if (modalStack.length === 0) document.body.classList.remove('modal-open');
    if (modalCloseHooks[id]) modalCloseHooks[id]();
    if (entry && entry.returnFocus && document.contains(entry.returnFocus)) {
      entry.returnFocus.focus({ preventScroll: true });
    }
  }

  function bindModal(id) {
    const overlay = document.getElementById(id);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) closeModal(id);
    });
    $$('[data-close]', overlay).forEach((b) => b.addEventListener('click', () => closeModal(id)));
  }

  function trapFocus(e) {
    const top = modalStack[modalStack.length - 1];
    if (!top) return;
    const overlay = document.getElementById(top.id);
    const focusables = $$('button:not([disabled]), input, select, textarea, [tabindex="0"]', overlay)
      .filter((el) => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!overlay.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // ---------- Week ----------
  function mondayOf(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0 Sun .. 6 Sat
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
  }

  function getWeekDates(offset) {
    const monday = mondayOf(new Date());
    monday.setDate(monday.getDate() + offset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  }

  function weekOffsetFor(iso) {
    return Math.round(daysBetween(isoLocal(mondayOf(new Date())), isoLocal(mondayOf(parseISO(iso)))) / 7);
  }

  function renderWeek() {
    const dates = getWeekDates(weekOffset);
    const first = dates[0];
    const last = dates[6];
    const sameMonth = first.getMonth() === last.getMonth();
    const endLabel = sameMonth ? last.getDate() : fmtShort(last);
    const yearLabel = first.getFullYear() === last.getFullYear()
      ? last.getFullYear()
      : `${first.getFullYear()}–${last.getFullYear()}`;
    $('#weekRange').textContent = `${fmtShort(first)} – ${endLabel}, ${yearLabel}` +
      (weekOffset === 0 ? ' · This week' : weekOffset === 1 ? ' · Next week' : weekOffset === -1 ? ' · Last week' : '');
    $('#todayWeek').hidden = weekOffset === 0;

    const todayISO = todayStr();

    $('#weekGrid').innerHTML = dates
      .map((d) => {
        const iso = isoLocal(d);
        const dayAssessments = assessments.filter((a) => a.date === iso);
        const dueCount = tasks.filter((t) => t.due === iso && !t.completed).length;
        const cls = [
          'day-card',
          iso === todayISO ? 'today' : '',
          iso < todayISO ? 'past' : '',
          d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : '',
        ].filter(Boolean).join(' ');

        const shown = dayAssessments.slice(0, 3);
        let body = shown.length === 0
          ? `<div class="day-empty">No assessment</div>`
          : shown.map((a) => `<div class="assess-pill"><span class="dot"></span><span class="pill-text">${escapeHTML(a.name)}</span></div>`).join('');
        if (dayAssessments.length > shown.length) {
          body += `<div class="day-more">+${dayAssessments.length - shown.length} more</div>`;
        }
        if (dueCount > 0) {
          body += `<div class="day-tasks">${plural(dueCount, 'task')} due</div>`;
        }

        const label = `${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}: ` +
          `${plural(dayAssessments.length, 'assessment')}, ${plural(dueCount, 'task')} due`;

        return `
          <button type="button" class="${cls}" data-date="${iso}" aria-label="${escapeHTML(label)}">
            <div class="day-head">
              <span class="day-name">${d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
              <span class="day-date">${fmtShort(d)}</span>
              ${iso === todayISO ? '<span class="today-tag">Today</span>' : ''}
            </div>
            <div class="day-body">${body}</div>
          </button>`;
      })
      .join('');
  }

  function renderUpcoming() {
    const wrap = $('#upcomingAssessments');
    const todayISO = todayStr();
    const all = assessments
      .filter((a) => a.date >= todayISO)
      .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    const upcoming = all.slice(0, 5);

    if (upcoming.length === 0) {
      wrap.innerHTML = `<div class="upcoming-empty">No upcoming assessments.</div>`;
      return;
    }

    wrap.innerHTML = upcoming
      .map((a) => {
        const rel = relativeLabel(a.date);
        const soon = daysBetween(todayISO, a.date) <= 2;
        return `<button type="button" class="upcoming-item" data-date="${a.date}">
            <span class="u-name">${escapeHTML(a.name)}</span>
            <span class="u-date${soon ? ' soon' : ''}" title="${escapeHTML(parseISO(a.date).toDateString())}">${rel}</span>
          </button>`;
      })
      .join('') + (all.length > upcoming.length
        ? `<div class="upcoming-more">+${all.length - upcoming.length} more later</div>`
        : '');
  }

  // ---------- Day detail modal ----------
  let dayModalDate = null;

  function openDayModal(iso) {
    dayModalDate = iso;
    renderDayModal();
    openModal('dayOverlay');
  }

  modalCloseHooks.dayOverlay = () => {
    dayModalDate = null;
    $('#dayAssessInput').value = '';
  };

  function renderDayModal() {
    if (!dayModalDate) return;
    const d = parseISO(dayModalDate);
    const rel = relativeLabel(dayModalDate);
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });

    $('#dayModalWeekday').textContent = ['Today', 'Tomorrow', 'Yesterday'].includes(rel) ? `${rel} · ${weekday}` : weekday;
    $('#dayModalDate').textContent = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const dayAssessments = assessments.filter((a) => a.date === dayModalDate);
    $('#dayModalAssessments').innerHTML = dayAssessments.length === 0
      ? `<div class="day-modal-empty">No assessments on this day yet.</div>`
      : dayAssessments.map((a) => `
          <div class="day-modal-item">
            <div class="dmi-left"><span class="dot"></span><span class="dmi-text">${escapeHTML(a.name)}</span></div>
            <button type="button" class="dmi-remove" data-action="remove-assess" data-id="${escapeHTML(a.id)}" aria-label="Remove ${escapeHTML(a.name)}" title="Remove">${iconTrash()}</button>
          </div>`).join('');

    const dayTasks = tasks.filter((t) => t.due === dayModalDate);
    $('#dayModalTasks').innerHTML = dayTasks.length === 0
      ? `<div class="day-modal-empty">No tasks due this day.</div>`
      : dayTasks.map((t) => `
          <div class="day-modal-item ${t.completed ? 'task-done' : ''}" data-color="${t.color}">
            <div class="dmi-left">
              <button type="button" class="task-check" data-action="toggle-task" data-id="${escapeHTML(t.id)}"
                role="checkbox" aria-checked="${t.completed}" aria-label="Mark ${escapeHTML(t.title)} ${t.completed ? 'not done' : 'done'}">${iconCheck()}</button>
              <span class="dmi-text">${escapeHTML(t.title)}</span>
            </div>
            <span class="color-dot" aria-hidden="true"></span>
          </div>`).join('');
  }

  // ---------- Tasks ----------
  function taskDateMeta(task) {
    if (!task.due) return '';
    const todayISO = todayStr();
    const isOverdue = task.due < todayISO && !task.completed;
    const isToday = task.due === todayISO;
    const short = fmtShort(parseISO(task.due));
    const cls = isOverdue ? 'overdue' : isToday && !task.completed ? 'due-today' : '';
    const label = isOverdue ? `Overdue · ${short}` : isToday ? 'Due today' : relativeLabel(task.due);
    return `<span class="meta-badge ${cls}" title="${escapeHTML(parseISO(task.due).toDateString())}">${iconCalendar()}${label}</span>`;
  }

  const FILTERS = {
    all: () => true,
    open: (t) => !t.completed,
    today: (t) => t.due === todayStr() && !t.completed,
    overdue: (t) => !!t.due && t.due < todayStr() && !t.completed,
    completed: (t) => t.completed,
  };

  function matchesSearch(task) {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return task.title.toLowerCase().includes(q) || task.notes.toLowerCase().includes(q);
  }

  function emptyStateHTML() {
    let title = 'Nothing here yet';
    let sub = 'Add a task or switch the current filter.';
    if (searchTerm.trim()) {
      title = 'No matches';
      sub = `Nothing matches “${escapeHTML(searchTerm.trim())}” in this view.`;
    } else if (tasks.length === 0) {
      title = 'No tasks yet';
      sub = 'Add your first task and it will show up here.';
    } else if (currentFilter === 'open') {
      title = 'All caught up';
      sub = 'Every task is done. Enjoy it.';
    } else if (currentFilter === 'today') {
      title = 'Nothing due today';
      sub = 'Nothing has today as its due date.';
    } else if (currentFilter === 'overdue') {
      title = 'Nothing overdue';
      sub = "You're on top of things.";
    } else if (currentFilter === 'completed') {
      title = 'Nothing completed yet';
      sub = 'Tick a task off and it will land here.';
    }
    return `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">✦</div>
        <p class="empty-title">${title}</p>
        <p class="empty-sub">${sub}</p>
      </div>`;
  }

  function renderTasks() {
    const list = $('#taskList');
    const filter = FILTERS[currentFilter];
    const visible = tasks.filter((t) => filter(t) && matchesSearch(t));

    // Incomplete first, then by due date (no date last), then newest first.
    visible.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
      if (a.due && !b.due) return -1;
      if (!a.due && b.due) return 1;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });

    if (visible.length === 0) {
      list.innerHTML = emptyStateHTML();
    } else {
      list.innerHTML = visible
        .map((t) => {
          const notesHTML = t.notes ? `<p class="task-notes">${escapeHTML(t.notes)}</p>` : '';
          const repeatBadge = t.repeat !== 'none'
            ? `<span class="meta-badge">${iconRepeat()}${t.repeat[0].toUpperCase() + t.repeat.slice(1)}</span>`
            : '';
          const meta = taskDateMeta(t) + repeatBadge;
          return `
          <div class="task-item ${t.completed ? 'completed' : ''} ${freshIds.has(t.id) ? 'is-new' : ''}" data-color="${t.color}" data-id="${escapeHTML(t.id)}">
            <button type="button" class="task-check" data-action="toggle" role="checkbox" aria-checked="${t.completed}"
              aria-label="Mark ${escapeHTML(t.title)} ${t.completed ? 'not done' : 'done'}">${iconCheck()}</button>
            <div class="task-body">
              <p class="task-title">${escapeHTML(t.title)}</p>
              ${notesHTML}
              ${meta ? `<div class="task-meta">${meta}</div>` : ''}
            </div>
            <div class="task-actions">
              <button type="button" class="task-icon-btn" data-action="edit" aria-label="Edit ${escapeHTML(t.title)}" title="Edit">${iconEdit()}</button>
              <button type="button" class="task-icon-btn delete" data-action="delete" aria-label="Delete ${escapeHTML(t.title)}" title="Delete">${iconTrash()}</button>
            </div>
          </div>`;
        })
        .join('');
    }
    freshIds.clear();

    const openCount = tasks.filter((t) => !t.completed).length;
    $('#openTasksCount').textContent = openCount;
    $('#openTasksWord').textContent = openCount === 1 ? 'open task' : 'open tasks';

    $$('.filter-chip').forEach((chip) => {
      const n = tasks.filter(FILTERS[chip.dataset.filter]).length;
      const countEl = $('.count', chip);
      countEl.textContent = n;
      countEl.hidden = n === 0;
      chip.classList.toggle('alert', chip.dataset.filter === 'overdue' && n > 0);
    });

    $('#clearCompletedBtn').disabled = !tasks.some((t) => t.completed);
  }

  function renderAll() {
    lastRenderedDay = todayStr();
    renderWeek();
    renderUpcoming();
    renderTasks();
    renderDayModal();
  }

  async function addTask(e) {
    e.preventDefault();
    const titleInput = $('#taskInput');
    const notesInput = $('#notesInput');
    const dueInput = $('#dueInput');
    const repeatInput = $('#repeatInput');
    const btn = $('#addTaskBtn');
    if (btn.disabled) return;

    const title = titleInput.value.trim();
    if (!title) {
      flagInvalid(titleInput, 'Give the task a name first');
      return;
    }

    const payload = {
      user_id: window.currentUser.id,
      title,
      notes: notesInput.value.trim(),
      due: dueInput.value || null,
      repeat: repeatInput.value,
      color: selectedColor,
      completed: false,
    };

    setBusy(btn, true, 'Adding…');
    const { data, error } = await window.sb.from('tasks').insert(payload).select().single();
    setBusy(btn, false);
    if (error) {
      console.error(error);
      toast('Could not add task. Try again.', { error: true });
      return;
    }

    const task = normalizeTask(data);
    tasks.push(task);
    freshIds.add(task.id);

    titleInput.value = '';
    notesInput.value = '';
    dueInput.value = '';
    repeatInput.value = 'none';
    titleInput.focus();

    // Make sure the new task is visible.
    if (!FILTERS[currentFilter](task) || !matchesSearch(task)) {
      searchTerm = '';
      $('#searchInput').value = '';
      setFilter('all');
    }
    renderWeek();
    renderTasks();
    toast('Task added');
  }

  async function createAssessment(name, date) {
    const { data, error } = await window.sb
      .from('assessments')
      .insert({ user_id: window.currentUser.id, name, date })
      .select()
      .single();
    if (error) {
      console.error(error);
      toast('Could not add assessment. Try again.', { error: true });
      return false;
    }
    assessments.push(normalizeAssessment(data));
    renderWeek();
    renderUpcoming();
    renderDayModal();
    toast('Assessment added');
    return true;
  }

  async function addAssessment(e) {
    e.preventDefault();
    const nameInput = $('#assessInput');
    const dateInput = $('#assessDateInput');
    const btn = $('#addAssessBtn');
    if (btn.disabled) return;

    const name = nameInput.value.trim();
    const date = dateInput.value;
    if (!name) return flagInvalid(nameInput, 'Give the assessment a name first');
    if (!date) return flagInvalid(dateInput, 'Pick a date for the assessment');

    setBusy(btn, true, 'Adding…');
    const ok = await createAssessment(name, date);
    setBusy(btn, false);
    if (!ok) return;

    nameInput.value = '';
    dateInput.value = '';
    // Jump the week view to the new assessment so it's visible straight away.
    weekOffset = weekOffsetFor(date);
    renderWeek();
    nameInput.focus();
  }

  async function addDayAssessment(e) {
    e.preventDefault();
    const input = $('#dayAssessInput');
    const btn = $('button[type="submit"]', e.currentTarget);
    if (btn.disabled || !dayModalDate) return;
    const name = input.value.trim();
    if (!name) return flagInvalid(input);
    setBusy(btn, true, '…');
    const ok = await createAssessment(name, dayModalDate);
    setBusy(btn, false);
    if (ok) {
      input.value = '';
      input.focus();
    }
  }

  async function removeAssessment(id) {
    const a = assessments.find((x) => x.id === id);
    if (!a) return;
    assessments = assessments.filter((x) => x.id !== id);
    renderWeek();
    renderUpcoming();
    renderDayModal();
    const { error } = await window.sb.from('assessments').delete().eq('id', id);
    if (error) {
      console.error(error);
      toast('Could not remove assessment', { error: true });
      await resync();
      return;
    }
    toast('Assessment removed', {
      onAction: async () => {
        const res = await window.sb.from('assessments').insert(assessmentRow(a)).select().single();
        if (res.error) {
          console.error(res.error);
          toast('Could not restore assessment', { error: true });
          return;
        }
        assessments.push(normalizeAssessment(res.data));
        renderWeek();
        renderUpcoming();
        renderDayModal();
        toast('Assessment restored');
      },
    });
  }

  async function toggleTask(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task || task.pending) return;
    const next = !task.completed;
    task.completed = next;
    task.pending = true;
    renderTasks();
    renderWeek();
    renderDayModal();

    const { error } = await window.sb.from('tasks').update({ completed: next }).eq('id', id);
    task.pending = false;
    if (error) {
      console.error(error);
      task.completed = !next;
      renderTasks();
      renderWeek();
      renderDayModal();
      toast('Could not update task', { error: true });
      return;
    }

    if (next && task.repeat !== 'none') {
      await spawnNextOccurrence(task);
    } else if (!next && spawnedNext.has(id)) {
      await removeSpawned(id);
    }
  }

  async function spawnNextOccurrence(task) {
    const due = nextOccurrence(task.due, task.repeat);
    const { data, error } = await window.sb.from('tasks').insert({
      user_id: window.currentUser.id,
      title: task.title,
      notes: task.notes,
      due,
      repeat: task.repeat,
      color: task.color,
      completed: false,
    }).select().single();
    if (error) {
      console.error(error);
      toast('Could not schedule the next repeat', { error: true });
      return;
    }
    const nextTask = normalizeTask(data);
    tasks.push(nextTask);
    freshIds.add(nextTask.id);
    spawnedNext.set(task.id, nextTask.id);
    renderTasks();
    renderWeek();
    renderDayModal();
    const rel = relativeLabel(due);
    const when = /^(Today|Tomorrow|In )/.test(rel) ? rel.charAt(0).toLowerCase() + rel.slice(1) : `on ${rel}`;
    toast(`Done! Next one is due ${when}`);
  }

  async function removeSpawned(parentId) {
    const childId = spawnedNext.get(parentId);
    spawnedNext.delete(parentId);
    const child = tasks.find((t) => t.id === childId);
    if (!child || child.completed) return; // user already did something with it
    tasks = tasks.filter((t) => t.id !== childId);
    renderTasks();
    renderWeek();
    renderDayModal();
    const { error } = await window.sb.from('tasks').delete().eq('id', childId);
    if (error) {
      console.error(error);
      await resync();
    }
  }

  async function restoreTasks(removed, message) {
    const res = await window.sb.from('tasks').insert(removed.map(taskRow)).select();
    if (res.error) {
      console.error(res.error);
      toast('Could not restore', { error: true });
      await resync();
      return;
    }
    (res.data || []).map(normalizeTask).forEach((t) => {
      tasks.push(t);
      freshIds.add(t.id);
    });
    renderTasks();
    renderWeek();
    renderDayModal();
    toast(message);
  }

  async function deleteTask(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    tasks = tasks.filter((t) => t.id !== id);
    renderTasks();
    renderWeek();
    renderDayModal();
    const { error } = await window.sb.from('tasks').delete().eq('id', id);
    if (error) {
      console.error(error);
      toast('Could not delete task', { error: true });
      await resync();
      return;
    }
    toast('Task deleted', { onAction: () => restoreTasks([task], 'Task restored') });
  }

  async function clearCompleted() {
    const removed = tasks.filter((t) => t.completed);
    if (removed.length === 0) return;
    tasks = tasks.filter((t) => !t.completed);
    renderTasks();
    renderWeek();
    renderDayModal();
    const { error } = await window.sb.from('tasks').delete().in('id', removed.map((t) => t.id));
    if (error) {
      console.error(error);
      toast('Could not clear completed tasks', { error: true });
      await resync();
      return;
    }
    toast(`Cleared ${plural(removed.length, 'completed task')}`, {
      onAction: () => restoreTasks(removed, `Restored ${plural(removed.length, 'task')}`),
    });
  }

  function setFilter(filter) {
    currentFilter = filter;
    $$('.filter-chip').forEach((c) => {
      const on = c.dataset.filter === filter;
      c.classList.toggle('active', on);
      c.setAttribute('aria-selected', String(on));
    });
  }

  // ---------- Edit modal ----------
  let editingId = null;

  function openEditModal(id) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    editingId = id;
    $('#editTaskInput').value = t.title;
    $('#editNotesInput').value = t.notes;
    $('#editDueInput').value = t.due;
    $('#editRepeatInput').value = t.repeat;
    editColor = t.color;
    renderSwatches($('#editColorRow'), editColor);
    openModal('editOverlay', '#editTaskInput');
  }

  modalCloseHooks.editOverlay = () => {
    editingId = null;
  };

  async function saveEdit(e) {
    e.preventDefault();
    const btn = $('#editSaveBtn');
    if (btn.disabled) return;
    const t = tasks.find((x) => x.id === editingId);
    if (!t) return closeModal('editOverlay');

    const titleInput = $('#editTaskInput');
    const title = titleInput.value.trim();
    if (!title) return flagInvalid(titleInput, 'A task needs a name');

    const changes = {
      title,
      notes: $('#editNotesInput').value.trim(),
      due: $('#editDueInput').value || null,
      repeat: $('#editRepeatInput').value,
      color: editColor,
    };

    setBusy(btn, true, 'Saving…');
    const { error } = await window.sb.from('tasks').update(changes).eq('id', t.id);
    setBusy(btn, false);
    if (error) {
      console.error(error);
      toast('Could not save changes. Try again.', { error: true });
      return;
    }
    Object.assign(t, changes, { due: changes.due || '' });
    closeModal('editOverlay');
    renderTasks();
    renderWeek();
    renderDayModal();
    toast('Task updated');
  }

  // ---------- Timer ----------
  // The timer is based on an end timestamp so it stays accurate in background
  // tabs, and is saved to localStorage so a page reload doesn't lose it.
  const TIMER_KEY = 'astroplan.timer';
  const RING_CIRC = 2 * Math.PI * 90;
  const baseTitle = document.title;
  const timer = { total: 25 * 60 * 1000, remaining: 25 * 60 * 1000, endAt: 0, running: false };
  let timerInterval = null;

  function saveTimer() {
    try {
      localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
    } catch (_) { /* storage unavailable — not critical */ }
  }

  function restoreTimer() {
    try {
      const saved = JSON.parse(localStorage.getItem(TIMER_KEY) || 'null');
      if (saved && saved.total > 0) Object.assign(timer, saved);
    } catch (_) { /* ignore */ }
    if (timer.running) {
      timer.remaining = timer.endAt - Date.now();
      if (timer.remaining <= 0) {
        timer.running = false;
        timer.remaining = timer.total;
        saveTimer();
      } else {
        timerInterval = setInterval(tickTimer, 250);
      }
    }
  }

  function formatTime(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
  }

  function updateTimerUI() {
    const text = formatTime(timer.remaining);
    $('#timerDisplay').textContent = text;
    const frac = timer.total > 0 ? Math.max(0, Math.min(1, timer.remaining / timer.total)) : 0;
    $('#timerRing').style.strokeDashoffset = String(RING_CIRC * (1 - frac));
    $('#timerStartPause').textContent = timer.running ? 'Pause' : timer.remaining < timer.total ? 'Resume' : 'Start';

    const active = timer.running || timer.remaining < timer.total;
    $('#timerBtnLabel').textContent = active ? (timer.running ? text : `Paused · ${text}`) : 'Study timer';
    $('#timerBtn').classList.toggle('running', timer.running);
    document.title = timer.running ? `${text} · Focus — AstroPlan` : baseTitle;

    const totalMin = timer.total / 60000;
    $$('.timer-presets .chip-btn').forEach((c) => c.classList.toggle('active', Number(c.dataset.min) === totalMin));
  }

  function tickTimer() {
    timer.remaining = timer.endAt - Date.now();
    if (timer.remaining <= 0) {
      clearInterval(timerInterval);
      timer.running = false;
      timer.remaining = timer.total;
      saveTimer();
      updateTimerUI();
      chime();
      toast('Focus session complete! Take a break.', { duration: 5000 });
      return;
    }
    updateTimerUI();
  }

  function startPauseTimer() {
    clearInterval(timerInterval);
    if (timer.running) {
      timer.remaining = Math.max(0, timer.endAt - Date.now());
      timer.running = false;
    } else {
      if (timer.remaining <= 0) timer.remaining = timer.total;
      timer.endAt = Date.now() + timer.remaining;
      timer.running = true;
      timerInterval = setInterval(tickTimer, 250);
      primeAudio();
    }
    saveTimer();
    updateTimerUI();
  }

  function resetTimer() {
    clearInterval(timerInterval);
    timer.running = false;
    timer.remaining = timer.total;
    saveTimer();
    updateTimerUI();
  }

  function setTimerPreset(min) {
    timer.total = min * 60 * 1000;
    resetTimer();
  }

  let audioCtx = null;
  function primeAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx && !audioCtx) audioCtx = new Ctx();
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) { /* no audio — fine */ }
  }

  function chime() {
    try {
      primeAudio();
      if (!audioCtx) return;
      const now = audioCtx.currentTime;
      [880, 1175, 1568].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t0 = now + i * 0.18;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.65);
      });
    } catch (_) { /* ignore */ }
  }

  // ---------- Events ----------
  function bindEvents() {
    $('#taskForm').addEventListener('submit', addTask);
    $('#assessForm').addEventListener('submit', addAssessment);
    $('#dayAssessForm').addEventListener('submit', addDayAssessment);
    $('#editForm').addEventListener('submit', saveEdit);

    renderSwatches($('#colorRow'), selectedColor);
    bindSwatches($('#colorRow'), (c) => (selectedColor = c));
    bindSwatches($('#editColorRow'), (c) => (editColor = c));

    $('#taskList').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      const item = e.target.closest('.task-item');
      if (!btn || !item) return;
      const id = item.dataset.id;
      if (btn.dataset.action === 'toggle') toggleTask(id);
      else if (btn.dataset.action === 'edit') openEditModal(id);
      else if (btn.dataset.action === 'delete') deleteTask(id);
    });
    $('#taskList').addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      const item = e.target.closest('.task-item');
      if (item) openEditModal(item.dataset.id);
    });

    $('#searchInput').addEventListener('input', (e) => {
      searchTerm = e.target.value;
      renderTasks();
    });
    $('#searchInput').addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && e.target.value) {
        e.stopPropagation();
        e.target.value = '';
        searchTerm = '';
        renderTasks();
      }
    });

    $('#filterRow').addEventListener('click', (e) => {
      const chip = e.target.closest('.filter-chip');
      if (!chip) return;
      setFilter(chip.dataset.filter);
      renderTasks();
    });

    $('#openTasksChip').addEventListener('click', () => {
      setFilter('open');
      renderTasks();
      $('.tasks-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    $('#clearCompletedBtn').addEventListener('click', clearCompleted);

    $('#prevWeek').addEventListener('click', () => { weekOffset--; renderWeek(); });
    $('#nextWeek').addEventListener('click', () => { weekOffset++; renderWeek(); });
    $('#todayWeek').addEventListener('click', () => { weekOffset = 0; renderWeek(); });

    $('#weekGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.day-card');
      if (card) openDayModal(card.dataset.date);
    });
    $('#upcomingAssessments').addEventListener('click', (e) => {
      const item = e.target.closest('.upcoming-item');
      if (!item) return;
      weekOffset = weekOffsetFor(item.dataset.date);
      renderWeek();
      openDayModal(item.dataset.date);
    });

    $('#dayModalAssessments').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="remove-assess"]');
      if (btn) removeAssessment(btn.dataset.id);
    });
    $('#dayModalTasks').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="toggle-task"]');
      if (btn) toggleTask(btn.dataset.id);
    });

    ['dayOverlay', 'editOverlay', 'timerOverlay'].forEach(bindModal);

    $('#timerBtn').addEventListener('click', () => openModal('timerOverlay', '#timerStartPause'));
    $('#timerStartPause').addEventListener('click', startPauseTimer);
    $('#timerReset').addEventListener('click', resetTimer);
    $$('.timer-presets .chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => setTimerPreset(Number(btn.dataset.min)));
    });

    $('#toastAction').addEventListener('click', () => {
      const handler = toastHandler;
      hideToast();
      if (handler) handler();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalStack.length) {
        closeModal(modalStack[modalStack.length - 1].id);
      } else if (e.key === 'Tab' && modalStack.length) {
        trapFocus(e);
      }
    });

    // Keep "today", "overdue", etc. correct if the page stays open past midnight.
    const refreshIfNewDay = () => {
      if (todayStr() !== lastRenderedDay) renderAll();
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshIfNewDay();
        if (timer.running) tickTimer();
      }
    });
    setInterval(refreshIfNewDay, 60 * 1000);

    // Keep the timer in sync across tabs.
    window.addEventListener('storage', (e) => {
      if (e.key !== TIMER_KEY) return;
      clearInterval(timerInterval);
      restoreTimer();
      updateTimerUI();
    });
  }

  // ---------- Init ----------
  async function init() {
    await window.astroplanReady;
    if (!(await loadData())) {
      window.astroplanFatal("Couldn't load your tasks. Check your internet connection and try again.");
      return;
    }
    bindEvents();
    restoreTimer();
    renderAll();
    updateTimerUI();
    document.body.classList.add('ready');
  }

  init();
})();
