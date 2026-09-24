(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const pad2 = (n) => String(n).padStart(2, '0');
  const isoLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const todayStr = () => isoLocal(new Date());

  // ---------- State ----------
  let tasks = [];
  let assessments = [];
  let currentFilter = 'all';
  let searchTerm = '';
  let selectedColor = 'orange';
  let weekOffset = 0;

  function normalizeTask(row) {
    return {
      id: row.id,
      title: row.title,
      notes: row.notes || '',
      due: row.due || '',
      repeat: row.repeat || 'none',
      color: row.color || 'orange',
      completed: !!row.completed,
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    };
  }

  function normalizeAssessment(row) {
    return { id: row.id, name: row.name, date: row.date };
  }

  async function loadData() {
    const userId = window.currentUser.id;
    const [taskRes, assessRes] = await Promise.all([
      window.sb.from('tasks').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      window.sb.from('assessments').select('*').eq('user_id', userId).order('date', { ascending: true }),
    ]);

    if (taskRes.error) console.error(taskRes.error);
    if (assessRes.error) console.error(assessRes.error);

    tasks = (taskRes.data || []).map(normalizeTask);
    assessments = (assessRes.data || []).map(normalizeAssessment);
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---------- Week helpers ----------
  function getWeekDates(offset) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const day = now.getDay(); // 0 Sun .. 6 Sat
    const mondayDelta = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayDelta + offset * 7);
    const dates = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      dates.push(d);
    }
    return dates;
  }

  function fmtISO(d) {
    return isoLocal(d);
  }

  function fmtShort(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function renderWeek() {
    const dates = getWeekDates(weekOffset);
    const range = $('#weekRange');
    range.textContent = `${fmtShort(dates[0])} - ${fmtShort(dates[4])}, ${dates[4].getFullYear()}`;

    const grid = $('#weekGrid');
    grid.innerHTML = '';
    const todayISO = todayStr();

    dates.forEach((d) => {
      const iso = fmtISO(d);
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      const isToday = iso === todayISO;

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'day-card' + (isToday ? ' today' : '');
      card.dataset.date = iso;

      const dayAssessments = assessments.filter((a) => a.date === iso);

      let inner = `
        <div class="day-name">${dayName}</div>
        <div class="day-date">${fmtShort(d)}</div>
      `;

      if (dayAssessments.length === 0) {
        inner += `<div class="day-empty">No assessment</div>`;
      } else {
        inner += dayAssessments
          .map(
            (a) => `<div class="assess-pill"><span class="dot"></span><span>${escapeHTML(a.name)}</span></div>`
          )
          .join('');
      }

      card.innerHTML = inner;
      grid.appendChild(card);
    });
  }

  function renderUpcoming() {
    const wrap = $('#upcomingAssessments');
    const todayISO = todayStr();
    const upcoming = assessments
      .filter((a) => a.date >= todayISO)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);

    if (upcoming.length === 0) {
      wrap.innerHTML = `<div class="upcoming-empty">No upcoming assessments.</div>`;
      return;
    }

    wrap.innerHTML = upcoming
      .map((a) => {
        const d = new Date(a.date + 'T00:00:00');
        return `<div class="upcoming-item"><span class="u-name">${escapeHTML(a.name)}</span><span class="u-date">${fmtShort(d)}</span></div>`;
      })
      .join('');
  }

  // ---------- Day detail modal ----------
  let dayModalDate = null;

  function openDayModal(iso) {
    dayModalDate = iso;
    renderDayModal();
    $('#dayOverlay').classList.add('open');
  }

  function closeDayModal() {
    $('#dayOverlay').classList.remove('open');
    dayModalDate = null;
  }

  function renderDayModal() {
    if (!dayModalDate) return;
    const d = new Date(dayModalDate + 'T00:00:00');

    $('#dayModalWeekday').textContent = d.toLocaleDateString('en-US', { weekday: 'long' });
    $('#dayModalDate').textContent = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const dayAssessments = assessments.filter((a) => a.date === dayModalDate);
    const assessWrap = $('#dayModalAssessments');
    if (dayAssessments.length === 0) {
      assessWrap.innerHTML = `<div class="day-modal-empty">No assessments on this day yet.</div>`;
    } else {
      assessWrap.innerHTML = dayAssessments
        .map(
          (a) => `
          <div class="day-modal-item">
            <div class="dmi-left"><span class="dot"></span><span>${escapeHTML(a.name)}</span></div>
            <button class="dmi-remove" data-action="remove-assess" data-id="${a.id}" aria-label="Remove assessment">${iconTrash()}</button>
          </div>`
        )
        .join('');
    }

    const dayTasks = tasks.filter((t) => t.due === dayModalDate);
    const taskWrap = $('#dayModalTasks');
    if (dayTasks.length === 0) {
      taskWrap.innerHTML = `<div class="day-modal-empty">No tasks due this day.</div>`;
    } else {
      taskWrap.innerHTML = dayTasks
        .map(
          (t) => `
          <div class="day-modal-item ${t.completed ? 'task-done' : ''}">
            <div class="dmi-left">
              <button class="task-check" data-action="toggle-task" data-id="${t.id}">${iconCheck()}</button>
              <span>${escapeHTML(t.title)}</span>
            </div>
          </div>`
        )
        .join('');
    }
  }

  // ---------- Tasks ----------
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function iconCheck() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  }

  function iconCalendar() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
  }

  function iconRepeat() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;
  }

  function iconEdit() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
  }

  function iconTrash() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`;
  }

  function taskDateMeta(task) {
    if (!task.due) return '';
    const todayISO = todayStr();
    const isOverdue = task.due < todayISO && !task.completed;
    const isToday = task.due === todayISO;
    const d = new Date(task.due + 'T00:00:00');
    const cls = isOverdue ? 'overdue' : isToday ? 'due-today' : '';
    const label = isOverdue ? 'Overdue' : isToday ? 'Due today' : fmtShort(d);
    return `<span class="meta-badge ${cls}">${iconCalendar()}${label}</span>`;
  }

  function matchesFilter(task) {
    const todayISO = todayStr();
    switch (currentFilter) {
      case 'open':
        return !task.completed;
      case 'today':
        return task.due === todayISO && !task.completed;
      case 'overdue':
        return task.due && task.due < todayISO && !task.completed;
      case 'completed':
        return task.completed;
      default:
        return true;
    }
  }

  function matchesSearch(task) {
    if (!searchTerm) return true;
    const t = searchTerm.toLowerCase();
    return (
      task.title.toLowerCase().includes(t) ||
      (task.notes || '').toLowerCase().includes(t)
    );
  }

  function renderTasks() {
    const list = $('#taskList');
    const visible = tasks.filter((t) => matchesFilter(t) && matchesSearch(t));

    // sort: incomplete first, then by due date asc (no-date last), then created desc
    visible.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (a.due && b.due) return a.due.localeCompare(b.due);
      if (a.due) return -1;
      if (b.due) return 1;
      return b.createdAt - a.createdAt;
    });

    if (visible.length === 0) {
      list.innerHTML = `
        <div class="empty-state" id="emptyState">
          <div class="empty-icon">✦</div>
          <p class="empty-title">Nothing here yet</p>
          <p class="empty-sub">Add a task or switch the current filter.</p>
        </div>`;
    } else {
      list.innerHTML = visible
        .map((t) => {
          const notesHTML = t.notes
            ? `<p class="task-notes">${escapeHTML(t.notes)}</p>`
            : '';
          const repeatBadge =
            t.repeat && t.repeat !== 'none'
              ? `<span class="meta-badge">${iconRepeat()}${t.repeat[0].toUpperCase() + t.repeat.slice(1)}</span>`
              : '';
          return `
          <div class="task-item ${t.completed ? 'completed' : ''}" data-color="${t.color}" data-id="${t.id}">
            <button class="task-check" data-action="toggle">${iconCheck()}</button>
            <div class="task-body">
              <p class="task-title">${escapeHTML(t.title)}</p>
              ${notesHTML}
              <div class="task-meta">
                ${taskDateMeta(t)}
                ${repeatBadge}
              </div>
            </div>
            <div class="task-actions">
              <button class="task-icon-btn delete" data-action="delete" aria-label="Delete task">${iconTrash()}</button>
            </div>
          </div>`;
        })
        .join('');
    }

    const openCount = tasks.filter((t) => !t.completed).length;
    $('#openTasksCount').textContent = openCount;
  }

  async function addTask() {
    const titleInput = $('#taskInput');
    const notesInput = $('#notesInput');
    const dueInput = $('#dueInput');
    const repeatInput = $('#repeatInput');

    const title = titleInput.value.trim();
    if (!title) {
      titleInput.focus();
      titleInput.style.borderColor = '#c73838';
      setTimeout(() => (titleInput.style.borderColor = ''), 900);
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

    const { data, error } = await window.sb.from('tasks').insert(payload).select().single();
    if (error) {
      console.error(error);
      toast('Could not add task');
      return;
    }

    tasks.push(normalizeTask(data));

    titleInput.value = '';
    notesInput.value = '';
    dueInput.value = '';
    repeatInput.value = 'none';

    renderTasks();
    toast('Task added');
  }

  async function addAssessment() {
    const nameInput = $('#assessInput');
    const dateInput = $('#assessDateInput');

    const name = nameInput.value.trim();
    const date = dateInput.value;

    if (!name || !date) {
      const target = !name ? nameInput : dateInput;
      target.focus();
      target.style.borderColor = '#c73838';
      setTimeout(() => (target.style.borderColor = ''), 900);
      return;
    }

    const { data, error } = await window.sb
      .from('assessments')
      .insert({ user_id: window.currentUser.id, name, date })
      .select()
      .single();

    if (error) {
      console.error(error);
      toast('Could not add assessment');
      return;
    }

    assessments.push(normalizeAssessment(data));
    nameInput.value = '';
    dateInput.value = '';

    renderWeek();
    renderUpcoming();
    toast('Assessment added');
  }

  async function handleTaskListClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const item = e.target.closest('.task-item');
    const id = item.dataset.id;
    const task = tasks.find((t) => t.id === id);
    if (!task) return;

    if (btn.dataset.action === 'toggle') {
      const next = !task.completed;
      task.completed = next;
      renderTasks();
      const { error } = await window.sb.from('tasks').update({ completed: next }).eq('id', id);
      if (error) {
        console.error(error);
        task.completed = !next;
        renderTasks();
        toast('Could not update task');
      }
    } else if (btn.dataset.action === 'delete') {
      tasks = tasks.filter((t) => t.id !== id);
      renderTasks();
      const { error } = await window.sb.from('tasks').delete().eq('id', id);
      if (error) {
        console.error(error);
        toast('Could not delete task');
        await loadData();
        renderTasks();
      } else {
        toast('Task deleted');
      }
    }
  }

  // ---------- Timer ----------
  let timerSeconds = 25 * 60;
  let timerTotal = 25 * 60;
  let timerInterval = null;
  let timerRunning = false;

  function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function updateTimerDisplay() {
    $('#timerDisplay').textContent = formatTime(timerSeconds);
  }

  function startPauseTimer() {
    const btn = $('#timerStartPause');
    if (timerRunning) {
      clearInterval(timerInterval);
      timerRunning = false;
      btn.textContent = 'Start';
      return;
    }
    timerRunning = true;
    btn.textContent = 'Pause';
    timerInterval = setInterval(() => {
      timerSeconds--;
      updateTimerDisplay();
      if (timerSeconds <= 0) {
        clearInterval(timerInterval);
        timerRunning = false;
        btn.textContent = 'Start';
        toast('Focus session complete!');
      }
    }, 1000);
  }

  function resetTimer() {
    clearInterval(timerInterval);
    timerRunning = false;
    timerSeconds = timerTotal;
    updateTimerDisplay();
    $('#timerStartPause').textContent = 'Start';
  }

  function setTimerPreset(min) {
    timerTotal = min * 60;
    timerSeconds = timerTotal;
    updateTimerDisplay();
    $$('.chip-btn').forEach((c) => c.classList.toggle('active', Number(c.dataset.min) === min));
    resetTimer();
  }

  // ---------- Events ----------
  function bindEvents() {
    $('#addTaskBtn').addEventListener('click', addTask);
    $('#taskInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addTask();
    });

    $('#addAssessBtn').addEventListener('click', addAssessment);
    $('#assessInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addAssessment();
    });

    $('#colorRow').addEventListener('click', (e) => {
      const sw = e.target.closest('.swatch');
      if (!sw) return;
      $$('.swatch').forEach((s) => s.classList.remove('active'));
      sw.classList.add('active');
      selectedColor = sw.dataset.color;
    });

    $('#taskList').addEventListener('click', handleTaskListClick);

    $('#searchInput').addEventListener('input', (e) => {
      searchTerm = e.target.value;
      renderTasks();
    });

    $('#filterRow').addEventListener('click', (e) => {
      const chip = e.target.closest('.filter-chip');
      if (!chip) return;
      $$('.filter-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter;
      renderTasks();
    });

    $('#clearCompletedBtn').addEventListener('click', async () => {
      const completedIds = tasks.filter((t) => t.completed).map((t) => t.id);
      if (completedIds.length === 0) return;
      tasks = tasks.filter((t) => !t.completed);
      renderTasks();
      const { error } = await window.sb.from('tasks').delete().in('id', completedIds);
      if (error) {
        console.error(error);
        toast('Could not clear completed');
        await loadData();
        renderTasks();
      } else {
        toast('Completed tasks cleared');
      }
    });

    $('#prevWeek').addEventListener('click', () => {
      weekOffset--;
      renderWeek();
    });
    $('#nextWeek').addEventListener('click', () => {
      weekOffset++;
      renderWeek();
    });

    // Day detail modal
    $('#weekGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.day-card');
      if (!card) return;
      openDayModal(card.dataset.date);
    });
    $('#closeDay').addEventListener('click', closeDayModal);
    $('#dayOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'dayOverlay') closeDayModal();
    });
    $('#dayModalAssessments').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="remove-assess"]');
      if (!btn) return;
      const id = btn.dataset.id;
      assessments = assessments.filter((a) => a.id !== id);
      renderDayModal();
      renderWeek();
      renderUpcoming();
      const { error } = await window.sb.from('assessments').delete().eq('id', id);
      if (error) {
        console.error(error);
        toast('Could not remove assessment');
        await loadData();
        renderDayModal();
        renderWeek();
        renderUpcoming();
      } else {
        toast('Assessment removed');
      }
    });
    $('#dayModalTasks').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="toggle-task"]');
      if (!btn) return;
      const t = tasks.find((x) => x.id === btn.dataset.id);
      if (!t) return;
      const next = !t.completed;
      t.completed = next;
      renderDayModal();
      renderTasks();
      const { error } = await window.sb.from('tasks').update({ completed: next }).eq('id', t.id);
      if (error) {
        console.error(error);
        t.completed = !next;
        renderDayModal();
        renderTasks();
      }
    });

    // Timer modal
    $('#timerBtn').addEventListener('click', () => {
      $('#timerOverlay').classList.add('open');
    });
    $('#closeTimer').addEventListener('click', () => {
      $('#timerOverlay').classList.remove('open');
    });
    $('#timerOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'timerOverlay') $('#timerOverlay').classList.remove('open');
    });
    $('#timerStartPause').addEventListener('click', startPauseTimer);
    $('#timerReset').addEventListener('click', resetTimer);
    $$('.chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => setTimerPreset(Number(btn.dataset.min)));
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        $('#timerOverlay').classList.remove('open');
        closeDayModal();
      }
    });
  }

  // ---------- Init ----------
  async function init() {
    await window.astroplanReady;
    bindEvents();
    await loadData();
    renderWeek();
    renderUpcoming();
    renderTasks();
    updateTimerDisplay();
    $$('.chip-btn')[0]?.classList.add('active');
  }

  init();
})();
