// target_engine.js
console.log("TIVITY: Script loaded and executing...");
window.neoJournalInitialized = true;

// --- FIREBASE SYNC LOGIC ---
const SYNC_ID = localStorage.getItem('tivity_sync_id') || (() => {
    const newId = 'USER_' + Math.random().toString(36).substr(2, 9).toUpperCase();
    localStorage.setItem('tivity_sync_id', newId);
    return newId;
})();
console.log("TIVITY: Current Sync ID:", SYNC_ID);

// Helper to push to cloud
async function syncToCloud(collectionName, dataId, data) {
    if (!window.firebaseDB) return;
    try {
        const { doc, setDoc } = window.firestore;
        // Strip out any functions/undefined from data before saving
        const cleanData = JSON.parse(JSON.stringify(data));
        await setDoc(doc(window.firebaseDB, "users", SYNC_ID, collectionName, dataId), cleanData);
    } catch (e) {
        console.error("TIVITY: Cloud sync error", e);
    }
}

// Initial pull from cloud
async function initialCloudPull() {
    if (!window.firebaseDB) return;
    const { getDocs, collection } = window.firestore;
    
    // Pull Tasks
    const taskSnap = await getDocs(collection(window.firebaseDB, "users", SYNC_ID, "tasks"));
    if (!taskSnap.empty) {
        const cloudTasks = [];
        taskSnap.forEach(doc => cloudTasks.push(doc.data()));
        localStorage.setItem('journalTasks', JSON.stringify(cloudTasks));
        renderTasks();
    }

    // Pull Entries
    const entrySnap = await getDocs(collection(window.firebaseDB, "users", SYNC_ID, "entries"));
    if (!entrySnap.empty) {
        const cloudEntries = {};
        entrySnap.forEach(doc => { cloudEntries[doc.id] = doc.data(); });
        localStorage.setItem('journalEntries', JSON.stringify(cloudEntries));
    }
    // Pull Settings (Priorities, Tags, Education)
    const settingsSnap = await getDocs(collection(window.firebaseDB, "users", SYNC_ID, "settings"));
    settingsSnap.forEach(doc => {
        if (doc.id === 'priorities') {
            localStorage.setItem('journalPriorities', JSON.stringify(doc.data().priorities));
        } else if (doc.id === 'tags') {
            localStorage.setItem('journalDefaultTags', JSON.stringify(doc.data().defaultTags));
        } else if (doc.id === 'education') {
            localStorage.setItem('eduCategories', JSON.stringify(doc.data().cats));
        } else if (doc.id === 'notepad') {
            localStorage.setItem('quickNotepadData', doc.data().notes || '');
            const np = document.getElementById('quick-notepad');
            if (np && !np.matches(':focus')) np.value = doc.data().notes || '';
        }
    });
    
    console.log("TIVITY: Initial Cloud Sync Complete.");
}

// Subscribe to real-time updates
function subscribeToCloud() {
    if (!window.firebaseDB) return;
    const { collection, onSnapshot } = window.firestore;

    // ── Tasks ──────────────────────────────────────────────────────────────
    // Use metadata to skip echoing back our OWN writes (prevents loops).
    // The listener fires for remote changes AND for local commits.
    // hasPendingWrites=true means the snapshot is our own local write still
    // being sent to the server — skip it so we don't race with deleteDoc.
    onSnapshot(
        collection(window.firebaseDB, "users", SYNC_ID, "tasks"),
        { includeMetadataChanges: true },
        (snapshot) => {
            // Skip if this snapshot only reflects our own pending local writes
            if (snapshot.metadata.hasPendingWrites) return;

            const tasks = [];
            snapshot.forEach(doc => tasks.push(doc.data()));

            // SAFETY: if cloud is empty but we have local data, push local UP
            // instead of wiping it. This prevents data loss on first sync.
            if (tasks.length === 0) {
                const localTasks = getTasks();
                if (localTasks.length > 0) {
                    console.log("TIVITY: Cloud tasks empty but local data exists — pushing local up.");
                    localTasks.forEach(t => { if (t.id) syncToCloud("tasks", t.id, t); });
                    return; // keep localStorage as-is
                }
            }

            localStorage.setItem('journalTasks', JSON.stringify(tasks));
            renderTasks();
            renderCompletedTasks();
            if (typeof renderCalendar === 'function') renderCalendar();
        }
    );

    // ── Journal Entries ───────────────────────────────────────────────────
    onSnapshot(
        collection(window.firebaseDB, "users", SYNC_ID, "entries"),
        { includeMetadataChanges: true },
        (snapshot) => {
            if (snapshot.metadata.hasPendingWrites) return;
            const entries = {};
            snapshot.forEach(doc => { entries[doc.id] = doc.data(); });

            // SAFETY: if cloud is empty but local has entries, push local up
            if (Object.keys(entries).length === 0) {
                const localEntries = getEntries();
                if (Object.keys(localEntries).length > 0) {
                    console.log("TIVITY: Cloud entries empty but local data exists — pushing local up.");
                    Object.values(localEntries).forEach(e => { if (e.date) syncToCloud("entries", e.date, e); });
                    return;
                }
            }

            localStorage.setItem('journalEntries', JSON.stringify(entries));
            const historyTab = document.getElementById('history-tab');
            if (historyTab && historyTab.classList.contains('active')) {
                renderHistory();
            }
        }
    );

    // ── Settings (priorities, tags, notepad, education cats) ─────────────
    onSnapshot(
        collection(window.firebaseDB, "users", SYNC_ID, "settings"),
        { includeMetadataChanges: true },
        (snapshot) => {
            if (snapshot.metadata.hasPendingWrites) return;
            snapshot.docChanges().forEach(change => {
                const d = change.doc;
                if (d.id === 'priorities') {
                    localStorage.setItem('journalPriorities', JSON.stringify(d.data().priorities));
                    priorities = d.data().priorities;
                    renderPriorityUI();
                    renderTasks();
                } else if (d.id === 'tags') {
                    localStorage.setItem('journalDefaultTags', JSON.stringify(d.data().defaultTags));
                    defaultTags = d.data().defaultTags;
                    renderTagUI();
                } else if (d.id === 'notepad') {
                    const notes = d.data().notes || '';
                    localStorage.setItem('quickNotepadData', notes);
                    const np = document.getElementById('quick-notepad');
                    if (np && !np.matches(':focus')) np.value = notes;
                } else if (d.id === 'education') {
                    localStorage.setItem('eduCategories', JSON.stringify(d.data().cats));
                    if (typeof renderEduCategories === 'function') renderEduCategories();
                }
            });
        }
    );

    // ── Subjects (Education tab) ──────────────────────────────────────────
    onSnapshot(
        collection(window.firebaseDB, "users", SYNC_ID, "subjects"),
        { includeMetadataChanges: true },
        (snapshot) => {
            if (snapshot.metadata.hasPendingWrites) return;
            const subjects = [];
            snapshot.forEach(doc => subjects.push(doc.data()));

            // SAFETY: if cloud is empty but local has subjects, push local up
            if (subjects.length === 0) {
                const localSubjects = getSubjects();
                if (localSubjects.length > 0) {
                    console.log("TIVITY: Cloud subjects empty but local data exists — pushing local up.");
                    localSubjects.forEach(s => { if (s.id) syncToCloud("subjects", s.id, s); });
                    return;
                }
            }

            localStorage.setItem('journalSubjects', JSON.stringify(subjects));
            if (typeof renderSubjects === 'function') renderSubjects();
        }
    );

    console.log("TIVITY: Real-time listeners active on all collections.");
}
// Sync UI Helpers
window.copySyncID = () => {
    const input = document.getElementById('sync-id-display');
    input.select();
    document.execCommand('copy');
    alert("Sync ID Copied! Use this on your other devices.");
};

window.promptChangeSyncID = () => {
    const newId = prompt("Enter the Sync ID from your other device to link them:", SYNC_ID);
    if (newId && newId !== SYNC_ID) {
        localStorage.setItem('tivity_sync_id', newId.trim().toUpperCase());
        alert("Sync ID Updated! Reloading to sync data...");
        location.reload();
    }
};

// --- END FIREBASE SYNC LOGIC ---

// Data Storage Helpers
function getEntries() {
    try {
        return JSON.parse(localStorage.getItem('journalEntries')) || {};
    } catch (e) {
        console.error("TIVITY: Error parsing entries from localStorage", e);
        return {};
    }
}

function saveEntry(entry) {
    const entries = getEntries();
    entries[entry.date] = entry; 
    localStorage.setItem('journalEntries', JSON.stringify(entries));
    // Push to cloud
    syncToCloud("entries", entry.date, entry);
}

// To-Do Logic & State
let priorities = JSON.parse(localStorage.getItem('journalPriorities')) || [
    { id: 'today', name: 'TODAY', color: '#ff0055' },
    { id: 'level-1', name: 'LEVEL 1', color: '#ff6b00' },
    { id: 'level-2', name: 'LEVEL 2', color: '#ffbe0b' },
    { id: 'level-3', name: 'LEVEL 3', color: '#06d6a0' },
    { id: 'future', name: 'FUTURE', color: '#8338ec' },
    { id: 'unimportant', name: 'UNIMPORTANT', color: '#8ecae6' }
];

let defaultTags = JSON.parse(localStorage.getItem('journalDefaultTags')) || ['WORK', 'HEALTH', 'URGENT', 'LIFE', 'CODE'];

function savePriorities() {
    localStorage.setItem('journalPriorities', JSON.stringify(priorities));
    renderPriorityUI();
    // Push to cloud
    syncToCloud("settings", "priorities", { priorities });
}

function saveDefaultTags() {
    localStorage.setItem('journalDefaultTags', JSON.stringify(defaultTags));
    renderTagUI();
    // Push to cloud
    syncToCloud("settings", "tags", { defaultTags });
}

function getTasks() {
    try {
        return JSON.parse(localStorage.getItem('journalTasks')) || [];
    } catch (e) {
        return [];
    }
}

function saveTasks(tasks) {
    // ONLY write to localStorage here.
    // Each action (add, edit, toggleTask, deleteTask) is responsible for
    // its own Firestore write/delete so we never accidentally resurrect
    // a deleted document by re-uploading the full array.
    localStorage.setItem('journalTasks', JSON.stringify(tasks));
    if (typeof renderCalendar === 'function') renderCalendar();
    checkDueDates();
}

function renderPriorityUI() {
    // Update Priority Select in Form
    const select = document.getElementById('todo-priority');
    if (select) {
        select.innerHTML = priorities.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    }

    // Update Filters
    const filterContainer = document.getElementById('todo-filters');
    if (filterContainer) {
        const activeFilter = filterContainer.querySelector('.filter-btn.active')?.getAttribute('data-filter') || 'all';
        
        // Build the HTML for the MENU button and the collapsed list
        filterContainer.innerHTML = `
            <div style="width:100%; text-align:left; margin-bottom:10px;">
                <button id="toggle-menu-btn" class="submit-btn" style="width:auto; padding:4px 10px; font-size:0.65rem; background:#000; color:#fff;">MENU</button>
            </div>
            <div id="todo-filter-list" class="hidden" style="display:flex; flex-wrap:wrap; gap:8px; padding:12px; border:2px solid #000; background:#f8f8f8; margin-bottom:15px; box-shadow: 4px 4px 0 #000;">
                <button class="filter-btn ${activeFilter === 'all' ? 'active' : ''}" data-filter="all">ALL</button>
                <button id="toggle-todo-tools-btn" class="filter-btn" style="background:#000; color:#fff; border-color:#000;">EDIT TOOLS</button>
                ${priorities.map(p => `<button class="filter-btn ${activeFilter === p.id ? 'active' : ''}" data-filter="${p.id}" style="border-color:${p.color}">${p.name}</button>`).join('')}
            </div>
        `;
        
        // 1. Menu Toggle Logic
        const menuBtn = document.getElementById('toggle-menu-btn');
        const filterList = document.getElementById('todo-filter-list');
        if (menuBtn && filterList) {
            menuBtn.onclick = (e) => {
                e.preventDefault();
                filterList.classList.toggle('hidden');
                menuBtn.textContent = filterList.classList.contains('hidden') ? 'MENU' : 'CLOSE MENU';
            };
        }

        // 2. Filter Button Logic
        filterList.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
            btn.onclick = () => {
                filterList.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderTasks(btn.getAttribute('data-filter'));
                
                // Auto-close menu on selection
                filterList.classList.add('hidden');
                menuBtn.textContent = 'MENU';
                console.log("TIVITY: Filter Changed ->", btn.getAttribute('data-filter'));
            };
        });

        // 3. Edit Toggle Logic
        const toggleBtn = document.getElementById('toggle-todo-tools-btn');
        const toolsContainer = document.getElementById('todo-tools-container');
        if (toggleBtn && toolsContainer) {
            toggleBtn.onclick = (e) => {
                e.preventDefault();
                toolsContainer.classList.toggle('hidden');
                toggleBtn.textContent = toolsContainer.classList.contains('hidden') ? 'EDIT TOOLS' : 'CLOSE TOOLS';
            };
        }
    }

    // Update Label Manager
    const labelList = document.getElementById('label-list');
    if (labelList) {
        labelList.innerHTML = priorities.map((p, index) => `
            <div class="label-config-item">
                <input type="text" value="${p.name}" onchange="updatePriorityName('${p.id}', this.value)">
                <input type="color" value="${p.color}" onchange="updatePriorityColor('${p.id}', this.value)">
                <button class="todo-btn" onclick="deletePriority('${p.id}')">X</button>
            </div>
        `).join('');
    }
}

function renderTagUI() {
    const tasks = getTasks();
    const completedTasks = tasks.filter(t => t.done);
    const tagCounts = {};
    completedTasks.forEach(task => {
        (task.tags || []).forEach(tag => {
            const t = tag.toUpperCase();
            tagCounts[t] = (tagCounts[t] || 0) + 1;
        });
    });

    const selectDropdown = document.getElementById('todo-tags');
    const tagList = document.getElementById('default-tag-list');
    
    if (selectDropdown) {
        // Keep the currently selected value if possible
        const currentVal = selectDropdown.value;
        selectDropdown.innerHTML = '<option value="">No Tag</option>' + 
            defaultTags.map(tag => `
                <option value="${tag}">${tag} ${tagCounts[tag.toUpperCase()] ? `(${tagCounts[tag.toUpperCase()]})` : ''}</option>
            `).join('');
        if (currentVal && defaultTags.includes(currentVal)) {
            selectDropdown.value = currentVal;
        }
    }

    if (tagList) {
        tagList.innerHTML = defaultTags.map(tag => `
            <div class="tag-manage-item">
                <span>${tag} ${tagCounts[tag.toUpperCase()] ? `[${tagCounts[tag.toUpperCase()]}]` : ''}</span>
                <button class="todo-btn" onclick="deleteDefaultTag('${tag}')">DELETE</button>
            </div>
        `).join('');
    }
}

window.deleteDefaultTag = (tag) => {
    defaultTags = defaultTags.filter(t => t !== tag);
    saveDefaultTags();
};

window.updatePriorityName = (id, name) => {
    const p = priorities.find(p => p.id === id);
    if (p) { p.name = name.toUpperCase(); savePriorities(); renderTasks(); }
};

window.updatePriorityColor = (id, color) => {
    const p = priorities.find(p => p.id === id);
    if (p) { p.color = color; savePriorities(); renderTasks(); }
};

window.deletePriority = (id) => {
    if (priorities.length <= 1) return alert("Must have at least one priority level.");
    priorities = priorities.filter(p => p.id !== id);
    savePriorities();
    renderTasks();
};

function renderTasks(filter = 'all', containerId = 'todo-list', showDone = false) {
    const tasks = getTasks();
    const list = document.getElementById(containerId);
    if (!list) return;

    list.innerHTML = '';
    const filteredTasks = tasks.filter(t => {
        const matchesFilter = filter === 'all' || t.priority === filter;
        return matchesFilter && t.done === showDone;
    });
    
    // Sort by order
    filteredTasks.sort((a,b) => (a.order || 0) - (b.order || 0));

    if (filteredTasks.length === 0) {
        list.innerHTML = `
            <div class="todo-item" style="border-style: dashed; flex-direction: column; align-items: center; justify-content: center; padding: 20px;">
                <p style="margin-bottom: 10px;">No ${showDone ? 'completed' : 'active'} tasks found. ${showDone ? 'Get to work!' : 'Keep crushing it!'}</p>
                ${!showDone ? `<button onclick="window.toggleTaskForm()" style="background:var(--success); color:#000; border:2px solid #000; border-radius:50%; width:40px; height:40px; font-size:1.5rem; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:2px 2px 0 #000; margin-top:10px;">+</button>` : ''}
            </div>
        `;
        return;
    }

    filteredTasks.forEach((task, index) => {
        const priority = priorities.find(p => p.id === task.priority) || priorities[0];
        const item = document.createElement('div');
        item.className = `todo-item ${task.done ? 'done' : ''}`;
        item.draggable = !task.done;
        item.dataset.id = task.id;
        
        // Inline Edit Click
        item.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('.todo-label') || item.classList.contains('editing')) return;
            startEditing(task.id, item);
        });

        item.innerHTML = `
            <div class="todo-main-row">
                <div class="todo-info">
                    <span class="todo-label" style="background:${priority.color}" onclick="cyclePriority('${task.id}')">${priority.name}</span>
                    <span class="todo-text">${task.text}</span>
                    ${task.dueDate ? `<span class="todo-due">BY: ${task.dueDate}</span>` : ''}
                </div>
                <div class="todo-actions">
                    ${!task.done ? `<button class="todo-btn" onclick="pushTask('${task.id}')" title="Push to Next Day">NEXT DAY →</button>` : ''}
                    <button class="todo-btn" onclick="toggleDetails('${task.id}')">DETAILS</button>
                    <button class="todo-btn" onclick="toggleTask('${task.id}')">${task.done ? 'RESTORE' : 'DONE'}</button>
                    <button class="todo-btn" onclick="deleteTask('${task.id}')">X</button>
                </div>
            </div>
            <div id="details-${task.id}" class="todo-details hidden">
                <p class="todo-desc-text">${task.description || 'No description provided.'}</p>
                <div class="todo-tags">
                    ${(task.tags || []).map(t => `<span class="tag">${t}</span>`).join('')}
                </div>
            </div>
        `;

        if (!task.done) {
            item.addEventListener('dragstart', (e) => {
                item.classList.add('dragging');
                e.dataTransfer.setData('text/plain', task.id);
            });
            item.addEventListener('dragend', () => item.classList.remove('dragging'));
        }

        list.appendChild(item);
    });

    // Add contextual '+' button at the end if not showing completed
    if (!showDone) {
        const addBtnContainer = document.createElement('div');
        addBtnContainer.style.textAlign = 'center';
        addBtnContainer.style.marginTop = '25px';
        addBtnContainer.innerHTML = `<button onclick="window.toggleTaskForm()" style="background:var(--success); color:#000; border:2px solid #000; border-radius:50%; width:40px; height:40px; font-size:1.5rem; font-weight:bold; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; box-shadow:2px 2px 0 #000;">+</button>`;
        list.appendChild(addBtnContainer);
    }
}

window.toggleTaskForm = () => {
    const todoFormContainer = document.getElementById('todo-form-container');
    if (todoFormContainer) {
        todoFormContainer.classList.toggle('hidden');
        if (!todoFormContainer.classList.contains('hidden')) {
            document.getElementById('todo-input')?.focus();
        }
    }
};

window.startEditing = (id, element) => {
    const tasks = getTasks();
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    element.classList.add('editing');
    element.draggable = false;
    
    const chipHtml = defaultTags.map(tag => `
        <span class="tag-chip" style="font-size:0.7rem; padding:4px 8px; cursor:pointer;" onclick="toggleTagInEditForm('${tag}', '${id}')">+ ${tag}</span>
    `).join('');

    element.innerHTML = `
        <div class="edit-form">
            <div class="edit-row">
                <input type="text" id="edit-text-${id}" value="${task.text}" placeholder="Task name">
                <input type="date" id="edit-due-${id}" value="${task.dueDate || ''}">
            </div>
            <textarea id="edit-desc-${id}" rows="2" placeholder="Description">${task.description || ''}</textarea>
            
            <div style="margin-bottom: 10px; display:flex; flex-wrap:wrap; gap:5px;">
                ${chipHtml}
            </div>
            <input type="text" id="edit-tags-${id}" value="${(task.tags || []).join(', ')}" placeholder="Tags (comma separated)">
            
            <div class="edit-actions">
                <button class="todo-btn" onclick="cancelEdit()">CANCEL</button>
                <button class="todo-btn" style="background:var(--success)" onclick="saveEdit('${id}')">SAVE CHANGES</button>
            </div>
        </div>
    `;
    // Prevent event bubbling to the item click listener
    element.querySelector('.edit-form').addEventListener('click', (e) => e.stopPropagation());
};

window.toggleTagInEditForm = (tag, taskId) => {
    const input = document.getElementById(`edit-tags-${taskId}`);
    if (!input) return;
    let currentTags = input.value.split(',').map(t => t.trim()).filter(t => t);
    
    if (currentTags.includes(tag)) {
        currentTags = currentTags.filter(t => t !== tag);
    } else {
        currentTags.push(tag);
    }
    
    input.value = currentTags.join(', ');
};


window.saveEdit = (id) => {
    const tasks = getTasks();
    const task = tasks.find(t => t.id === id);
    if (task) {
        task.text = document.getElementById(`edit-text-${id}`).value;
        task.dueDate = document.getElementById(`edit-due-${id}`).value;
        task.description = document.getElementById(`edit-desc-${id}`).value;
        const tagsInput = document.getElementById(`edit-tags-${id}`).value;
        task.tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];
        
        saveTasks(tasks);
        syncToCloud("tasks", task.id, task);
        const filter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
        renderTasks(filter);
        renderCompletedTasks();
    }
};

window.cancelEdit = () => {
    const filter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
    renderTasks(filter);
    renderCompletedTasks();
};

function renderCompletedTasks() {
    renderTasks('all', 'completed-list', true);
    renderTagTracker();
}

window.showTasksOnly = () => {
    const btn = document.querySelector('.nav-btn[data-tab="todo-tab"]');
    if (btn) btn.click();
};

window.showHistoryTab = () => {
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(nb => nb.classList.remove('active'));
    
    document.getElementById('history-tab').classList.add('active');
    document.querySelector('.nav-btn[data-tab="entry-tab"]').classList.add('active');
    
    renderHistory();
};

window.showAnalysisTab = () => {
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(nb => nb.classList.remove('active'));
    
    document.getElementById('analysis-tab').classList.add('active');
    document.querySelector('.nav-btn[data-tab="entry-tab"]').classList.add('active');
};

window.showTagPerformance = () => {
    // Switch to stats tab view
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(nb => nb.classList.remove('active'));
    
    document.getElementById('stats-tab').classList.add('active');
    // We mark the Task button as active because Performance is a sub-page of Tasks
    document.querySelector('.nav-btn[data-tab="todo-tab"]').classList.add('active');
    
    renderTagTracker();
};

window.pushTask = (id) => {
    const tasks = getTasks();
    const task = tasks.find(t => t.id === id);
    if (task) {
        // Use current due date if it exists, otherwise use today
        let baseDate = task.dueDate ? new Date(task.dueDate) : new Date();
        // Handle timezone by using local date addition
        const nextDay = new Date(baseDate.getTime() + (24 * 60 * 60 * 1000));
        
        task.dueDate = nextDay.toISOString().split('T')[0];
        saveTasks(tasks);
        syncToCloud("tasks", task.id, task);
        const filter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
        renderTasks(filter);
    }
};

window.exportData = () => {
    const data = {
        journalEntries: getEntries(),
        journalTasks: getTasks(),
        journalPriorities: JSON.parse(localStorage.getItem('journalPriorities')),
        journalDefaultTags: JSON.parse(localStorage.getItem('journalDefaultTags')),
        geminiApiKey: localStorage.getItem('geminiApiKey'),
        quickNotepadData: localStorage.getItem('quickNotepadData')
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tivity_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

window.importData = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (data.journalEntries) localStorage.setItem('journalEntries', JSON.stringify(data.journalEntries));
            if (data.journalTasks) localStorage.setItem('journalTasks', JSON.stringify(data.journalTasks));
            if (data.journalPriorities) localStorage.setItem('journalPriorities', JSON.stringify(data.journalPriorities));
            if (data.journalDefaultTags) localStorage.setItem('journalDefaultTags', JSON.stringify(data.journalDefaultTags));
            if (data.geminiApiKey) localStorage.setItem('geminiApiKey', data.geminiApiKey);
            if (data.quickNotepadData !== undefined) localStorage.setItem('quickNotepadData', data.quickNotepadData);
            
            alert('DATA IMPORTED SUCCESSFULLY! REFRESHING...');
            window.location.reload();
        } catch (err) {
            alert('ERROR IMPORTING DATA: Invalid backup file.');
        }
    };
    reader.readAsText(file);
};

// --- Stats Dashboard State ---
window.dashboardState = {
    tagName: '',
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    viewMode: 'single' // 'single' or 'yearly'
};

window.renderTagTracker = () => {
    console.log("TIVITY: Rendering Tag Tracker...");
    const tasks = getTasks();
    const tagSet = new Set();
    
    tasks.forEach(task => {
        (task.tags || []).forEach(tag => {
            if (tag) tagSet.add(tag.toUpperCase());
        });
    });

    const selector = document.getElementById('tag-performance-selector');
    if (!selector) return;

    const tags = Array.from(tagSet).sort();
    
    if (tags.length === 0) {
        selector.innerHTML = '';
        document.getElementById('tag-dashboard').innerHTML = '<div class="stat-card" style="border-style:dashed;"><p>No tags found. Add tags to your tasks to track performance!</p></div>';
        return;
    }

    // Default to first tag if none selected
    if (!window.dashboardState.tagName && tags.length > 0) {
        window.dashboardState.tagName = tags[0];
    }

    selector.innerHTML = tags.map(tag => `
        <span class="tag-chip ${window.dashboardState.tagName === tag ? 'active' : ''}" 
              onclick="window.selectStatTag('${tag}')">${tag}</span>
    `).join('');
    
    window.renderTagDashboard();
};

window.selectStatTag = (tagName) => {
    window.dashboardState.tagName = tagName;
    // Update the chips immediately for visual feedback
    const chips = document.querySelectorAll('#tag-performance-selector .tag-chip');
    chips.forEach(chip => {
        if (chip.textContent === tagName) chip.classList.add('active');
        else chip.classList.remove('active');
    });
    window.renderTagDashboard();
};

window.renderTagDashboard = () => {
    const tagName = window.dashboardState.tagName;
    if (!tagName) {
        console.log("TIVITY: No tagName selected for dashboard.");
        return;
    }
    
    console.log(`TIVITY: Rendering dashboard for tag: ${tagName}`);
    const tasks = getTasks();
    const todayStr = new Date().toISOString().split('T')[0];
    
    // Filter tasks containing this tag
    const taggedTasks = tasks.filter(t => (t.tags || []).some(tag => tag.toUpperCase() === tagName));
    
    let completed = 0;
    let missed = 0;
    
    // Calculate stats
    taggedTasks.forEach(task => {
        if (task.done) {
            completed++;
        } else if (task.dueDate && task.dueDate < todayStr) {
            // Pending and past due = missed
            missed++;
        }
    });

    // --- Build Bar Chart (Completed per month for current year) ---
    const currentYear = new Date().getFullYear();
    const monthCounts = new Array(12).fill(0);
    let maxMonthCount = 0;
    
    taggedTasks.forEach(task => {
        if (task.done) {
            // If no due date, we can't accurately chart when it was completed natively unless we add a completedDate field.
            // For now, if it's done and has a due date, chart it by due date. If no due date, chart by today's month.
            const dateToUse = task.dueDate ? new Date(task.dueDate) : new Date();
            if (dateToUse.getFullYear() === currentYear) {
                const m = dateToUse.getMonth();
                monthCounts[m]++;
                if (monthCounts[m] > maxMonthCount) maxMonthCount = monthCounts[m];
            }
        }
    });

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const barHtml = monthCounts.map((count, i) => {
        const heightPct = maxMonthCount > 0 ? (count / maxMonthCount) * 100 : 0;
        return `
            <div class="bar-col">
                ${count > 0 ? `<span class="bar-count">${count}</span>` : ''}
                <div class="bar-fill" style="height: ${heightPct}%"></div>
                <div class="bar-label">${monthNames[i]}</div>
            </div>
        `;
    }).join('');

    // --- Build Calendar Heatmap(s) ---
    const { year, month, viewMode } = window.dashboardState;
    
    // Helper to generate a single month grid
    const generateMonthHtml = (mYear, mMonth) => {
        const firstDay = new Date(mYear, mMonth, 1).getDay();
        const daysInMonth = new Date(mYear, mMonth + 1, 0).getDate();
        
        const dayStatuses = {};
        taggedTasks.forEach(task => {
            if (!task.dueDate) return;
            const [tYear, tMonth, tDay] = task.dueDate.split('-');
            if (parseInt(tYear) === mYear && parseInt(tMonth) === mMonth + 1) {
                const dayNum = parseInt(tDay);
                if (task.done) {
                    dayStatuses[dayNum] = 'completed';
                } else if (!task.done && task.dueDate < todayStr) {
                    if (dayStatuses[dayNum] !== 'completed') {
                        dayStatuses[dayNum] = 'missed';
                    }
                }
            }
        });

        let html = '';
        if (viewMode === 'yearly') {
            html += `<div class="month-label-mini">${monthNames[mMonth]}</div>`;
        }
        
        html += '<div class="cal-grid-mini">';
        const daysOfWeek = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
        daysOfWeek.forEach(d => html += `<div class="cal-day-mini" style="border:none; border-bottom:2px solid #000; background:transparent;">${d}</div>`);
        
        for (let i = 0; i < firstDay; i++) {
            html += `<div class="cal-day-mini empty"></div>`;
        }
        for (let i = 1; i <= daysInMonth; i++) {
            const status = dayStatuses[i] || '';
            html += `<div class="cal-day-mini ${status}">${viewMode === 'single' ? i : ''}</div>`;
        }
        html += '</div>';
        return html;
    };

    let calContentHtml = '';
    let calHeaderHtml = '';

    if (viewMode === 'single') {
        calHeaderHtml = `
            <div class="calendar-heatmap-controls">
                <button class="heatmap-nav-btn" onclick="changeDashboardMonth(-1)">&larr; PREV</button>
                <div style="font-weight:900; text-transform:uppercase; font-size:1.1rem;">${monthNames[month]} ${year}</div>
                <button class="heatmap-nav-btn" onclick="changeDashboardMonth(1)">NEXT &rarr;</button>
            </div>
            <button class="submit-btn" style="width:100%; margin-bottom:20px; font-size:0.8rem; padding:8px;" onclick="toggleDashboardView()">VIEW ALL 12 MONTHS</button>
        `;
        calContentHtml = `<div>${generateMonthHtml(year, month)}</div>`;
    } else {
        calHeaderHtml = `
            <div class="calendar-heatmap-controls" style="justify-content:center;">
                <div style="font-weight:900; text-transform:uppercase; font-size:1.1rem;">${year} YEAR IN REVIEW</div>
            </div>
            <button class="submit-btn" style="width:100%; margin-bottom:20px; font-size:0.8rem; padding:8px; background:var(--surface);" onclick="toggleDashboardView()">BACK TO SINGLE MONTH</button>
        `;
        calContentHtml = '<div class="yearly-heatmap-grid">';
        for (let m = 0; m < 12; m++) {
            calContentHtml += `<div>${generateMonthHtml(year, m)}</div>`;
        }
        calContentHtml += '</div>';
    }

    // --- Render Final HTML ---
    document.getElementById('tag-dashboard').innerHTML = `
        <div class="dashboard-wrapper">
            <div class="dashboard-summary-grid">
                <div class="stat-card success-theme">
                    <span class="stat-value">${completed}</span>
                    <span class="stat-label">Tasks Completed</span>
                </div>
                <div class="stat-card danger-theme">
                    <span class="stat-value">${missed}</span>
                    <span class="stat-label">Tasks Missed</span>
                </div>
            </div>

            <div class="chart-card">
                <div class="chart-card-header">
                    <span>Monthly Output</span>
                    <span>${currentYear}</span>
                </div>
                <div class="neo-barchart">
                    ${barHtml}
                </div>
            </div>

            <div class="heatmap-card">
                ${calHeaderHtml}
                ${calContentHtml}
            </div>
        </div>
    `;
};


function initDragAndDrop() {
    const list = document.getElementById('todo-list');
    if (!list) return;

    list.addEventListener('dragover', (e) => {
        e.preventDefault();
        const afterElement = getDragAfterElement(list, e.clientY);
        const dragging = document.querySelector('.dragging');
        if (!dragging) return;
        
        if (afterElement == null) {
            list.appendChild(dragging);
        } else {
            list.insertBefore(dragging, afterElement);
        }
    });

    list.addEventListener('drop', (e) => {
        e.preventDefault();
        const newOrder = Array.from(list.querySelectorAll('.todo-item')).map((el, i) => ({
            id: el.dataset.id,
            order: i
        }));
        
        const allTasks = getTasks();
        newOrder.forEach(item => {
            const t = allTasks.find(x => x.id === item.id);
            if (t) t.order = item.order;
        });
        saveTasks(allTasks);
        // Sync all reordered tasks
        allTasks.forEach(t => { if (t.id) syncToCloud("tasks", t.id, t); });
    });
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.todo-item:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

window.toggleDetails = (id) => {
    document.getElementById(`details-${id}`).classList.toggle('hidden');
};

window.cyclePriority = (taskId) => {
    const tasks = getTasks();
    const task = tasks.find(t => t.id === taskId);
    if (task) {
        const currentIndex = priorities.findIndex(p => p.id === task.priority);
        const nextIndex = (currentIndex + 1) % priorities.length;
        task.priority = priorities[nextIndex].id;
        saveTasks(tasks);
        syncToCloud("tasks", task.id, task);
        renderTasks(document.querySelector('.filter-btn.active').dataset.filter);
    }
};

window.toggleTask = (id) => {
    const tasks = getTasks();
    const task = tasks.find(t => t.id === id);
    if (task) {
        task.done = !task.done;
        saveTasks(tasks);
        syncToCloud("tasks", task.id, task);
        const activeTab = document.querySelector('.nav-btn.active').dataset.tab;
        if (activeTab === 'todo-tab') {
            renderTasks(document.querySelector('.filter-btn.active').dataset.filter);
            renderCompletedTasks();
        }
    }
};

// Delete task locally and from Firestore
window.deleteTask = async (id) => {
    // Remove from local storage
    let tasks = getTasks();
    const beforeCount = tasks.length;
    tasks = tasks.filter(t => t.id !== id);
    if (tasks.length === beforeCount) {
        console.warn('TIVITY: deleteTask called for unknown id', id);
        return;
    }
    saveTasks(tasks);
    // Sync deletion to Firebase by deleting the specific document
    if (typeof syncToCloud === 'function' && window.firebaseDB) {
        try {
            const { doc, deleteDoc } = window.firestore;
            await deleteDoc(doc(window.firebaseDB, "users", SYNC_ID, "tasks", id));
        } catch (e) {
            console.error('TIVITY: Firestore delete error', e);
        }
    }
    const activeTab = document.querySelector('.nav-btn.active').dataset.tab;
    if (activeTab === 'todo-tab') {
        renderTasks(document.querySelector('.filter-btn.active').dataset.filter);
        renderCompletedTasks();
    }
};

function renderHistory() {
    console.log("TIVITY: Rendering history...");
    const entries = getEntries();
    const list = document.getElementById('history-list');
    if (!list) {
        console.error("TIVITY: History list container not found!");
        return;
    }
    
    list.innerHTML = '';
    
    const sortedDates = Object.keys(entries).filter(d => d !== 'undefined').sort((a,b) => new Date(b) - new Date(a));
    
    if (sortedDates.length === 0) {
        console.log("TIVITY: No entries found to render.");
        list.innerHTML = '<div class="history-card" style="border-style: dashed;"><p>No entries found. Start asserting dominance over your day by logging an entry or clicking LOAD DEMO DATA in the Analysis tab!</p></div>';
        return;
    }

    sortedDates.forEach(date => {
        const data = entries[date];
        const card = document.createElement('div');
        card.className = 'history-card';
        card.innerHTML = `
            <h3>${date}</h3>
            <p><strong>SUMMARY:</strong> ${data.summary || 'None'}</p>
            ${data.obstacle ? `<p><strong>OBSTACLE:</strong> ${data.obstacle}</p>` : ''}
            ${data.learned ? `<p><strong>LEARNED:</strong> ${data.learned}</p>` : ''}
            
            <div class="history-meta" style="margin-top:10px; margin-bottom:10px;">
                <strong>Mood:</strong> ${data.mood || '?'} | 
                <strong>Energy:</strong> ${data.energy || '?'} | 
                <strong>Stress:</strong> ${data.stress_level || '?'} ${data.stress_source ? `(${data.stress_source})` : ''} |
                <strong>Alignment:</strong> ${data.alignment || '?'} | 
                <strong>Fin Stress:</strong> ${data.fin_stress || '?'}
            </div>

            ${data.good_events ? `<p><strong>GOOD EVENTS:</strong> ${data.good_events}</p>` : ''}
            ${data.serendipity ? `<p><strong>SERENDIPITY:</strong> ${data.serendipity}</p>` : ''}
            ${data.opportunities ? `<p><strong>OPPORTUNITIES:</strong> ${data.opportunities}</p>` : ''}
            ${data.meaningful_moment ? `<p><strong>MEANINGFUL MOMENT:</strong> ${data.meaningful_moment}</p>` : ''}
            ${data.bravery ? `<p><strong>BRAVERY:</strong> ${data.bravery}</p>` : ''}
            <p><strong>SELF TALK:</strong> ${(data.selfTalk && typeof data.selfTalk === 'string') ? data.selfTalk.toUpperCase() : '?'}</p>

            <div class="history-meta" style="margin-top:10px;">
                <strong>Sleep:</strong> ${data.sleep || 0}h | 
                <strong>Meditate:</strong> ${data.meditation || 0}m | 
                <strong>Exercise:</strong> ${data.exercise || 'None'}
                <br><strong>Diet:</strong> ${data.food || 'Unknown'} | 
                <strong>Supps:</strong> ${data.supplements || 'None'} | 
                <strong>Body:</strong> ${data.body_signals || 'None'}
            </div>
            
            <div class="history-meta" style="margin-top:10px; background:#e5e5f7;">
                <strong>Location:</strong> ${data.location || '?'} | 
                <strong>Nature:</strong> ${data.nature || 'None'} | 
                <strong>Screens:</strong> ${data.screen_time || '?'}
                <br><strong>Creative:</strong> ${data.creative || 'None'}
                <br><strong>Social:</strong> ${data.social || 'None'}
            </div>
        `;
        list.appendChild(card);
    });
}

function initApp() {
    console.log("TIVITY: Initializing engine...");

    // Nav Logic
    const navBtns = document.querySelectorAll('.nav-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    // 1. Journal Form Toggle
    const toggleFormBtn = document.getElementById('toggle-form-btn');
    const formContainer = document.getElementById('form-container');
    if (toggleFormBtn && formContainer) {
        toggleFormBtn.onclick = (e) => {
            e.preventDefault();
            formContainer.classList.toggle('hidden');
            toggleFormBtn.textContent = formContainer.classList.contains('hidden') ? '+ NEW JOURNAL ENTRY' : '- CLOSE FORM';
            console.log("TIVITY: Journal Form Toggled", !formContainer.classList.contains('hidden'));
        };
    }

    // 2. Key & Data Toggle
    const toggleKeyDataBtn = document.getElementById('toggle-key-data-btn');
    const keyDataContainer = document.getElementById('key-data-container');
    if (toggleKeyDataBtn && keyDataContainer) {
        toggleKeyDataBtn.onclick = (e) => {
            e.preventDefault();
            keyDataContainer.classList.toggle('hidden');
            console.log("TIVITY: Key & Data Toggled", !keyDataContainer.classList.contains('hidden'));
        };
    }

    // 3. New Task Form Toggle (now handled globally, just keeping reference cleanup)
    const todoFormContainer = document.getElementById('todo-form-container');


    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const parent = btn.closest('.nav-dropdown');
            const isShowing = parent?.classList.contains('show');

            // 1. Handle Dropdown Toggling
            document.querySelectorAll('.nav-dropdown').forEach(nd => nd.classList.remove('show'));
            if (parent && !isShowing) {
                parent.classList.add('show');
            }

            // 2. Handle Tab Switching (only if button has data-tab)
            const tabId = btn.getAttribute('data-tab');
            if (tabId) {
                console.log(`TIVITY: Switching to tab -> ${tabId}`);
                navBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(tc => tc.classList.remove('active'));
                
                btn.classList.add('active');
                const targetTab = document.getElementById(tabId);
                if (targetTab) {
                    targetTab.classList.add('active');
                }

                if (tabId === 'history-tab') {
                    renderHistory();
                }
                if (tabId === 'todo-tab') {
                    renderPriorityUI();
                    renderTasks();
                    renderCompletedTasks();
                    initDragAndDrop();
                }
            }
        });
    });

    // Close dropdowns on item click or click outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.nav-dropdown')) {
            document.querySelectorAll('.nav-dropdown').forEach(nd => nd.classList.remove('show'));
        }
        if (e.target.closest('.dropdown-item')) {
            document.querySelectorAll('.nav-dropdown').forEach(nd => nd.classList.remove('show'));
        }
    });

    // To-Do Logic
    const todoForm = document.getElementById('todo-form');
    if (todoForm) {
        todoForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = document.getElementById('todo-input').value;
            const priority = document.getElementById('todo-priority').value;
            const dueDate = document.getElementById('todo-due-date').value;
            const tagsInput = document.getElementById('todo-tags').value;
            const description = document.getElementById('todo-desc').value;

            // Since it's a dropdown, tagsInput is just the single selected string
            const tags = tagsInput ? [tagsInput.trim()] : [];
            
            const tasks = getTasks();
            const newTask = {
                id: Date.now().toString(),
                text,
                priority,
                dueDate,
                tags,
                description,
                done: false,
                order: tasks.length
            };
            tasks.push(newTask);
            
            saveTasks(tasks);
            syncToCloud("tasks", newTask.id, newTask);
            todoForm.reset();
            renderTasks();

            // Auto-collapse form
            const todoFormContainer = document.getElementById('todo-form-container');
            if (todoFormContainer) {
                todoFormContainer.classList.add('hidden');
            }
        });
    }

    const manageLabelsBtn = document.getElementById('manage-labels-btn');
    if (manageLabelsBtn) {
        manageLabelsBtn.addEventListener('click', () => {
            document.getElementById('label-manager').classList.toggle('hidden');
        });
    }

    const addLabelBtn = document.getElementById('add-label-btn');
    if (addLabelBtn) {
        addLabelBtn.addEventListener('click', () => {
            const id = 'custom-' + Date.now();
            priorities.push({ id, name: 'NEW LEVEL', color: '#cccccc' });
            savePriorities();
        });
    }

    const manageTagsBtn = document.getElementById('manage-tags-btn');
    if (manageTagsBtn) {
        manageTagsBtn.addEventListener('click', () => {
            document.getElementById('tag-manager').classList.toggle('hidden');
        });
    }

    const addTagBtn = document.getElementById('add-tag-btn');
    if (addTagBtn) {
        addTagBtn.addEventListener('click', () => {
            const name = document.getElementById('new-tag-input').value.trim();
            if (name && !defaultTags.includes(name.toUpperCase())) {
                defaultTags.push(name.toUpperCase());
                saveDefaultTags();
                document.getElementById('new-tag-input').value = '';
            }
        });
    }

    const toggleCompletedBtn = document.getElementById('toggle-completed-btn');
    if (toggleCompletedBtn) {
        toggleCompletedBtn.addEventListener('click', () => {
            const section = document.getElementById('completed-section');
            section.classList.toggle('hidden');
            if (!section.classList.contains('hidden')) {
                renderCompletedTasks();
            }
        });
    }

    // Initial load for tasks if needed
    renderPriorityUI();
    renderTagUI();
    renderTasks();
    renderCompletedTasks();
    renderTagTracker();
    initDragAndDrop();

    // Set today's date in form
    const entryDate = document.getElementById('entry-date');
    if (entryDate) {
        const today = new Date();
        const localDate = today.getFullYear() + '-' +
            String(today.getMonth() + 1).padStart(2, '0') + '-' +
            String(today.getDate()).padStart(2, '0');
        entryDate.value = localDate;
    }

    // Load and Auto-Save API key
    const geminiKeyInput = document.getElementById('gemini-key');
    if (geminiKeyInput) {
        const savedApiKey = localStorage.getItem('geminiApiKey');
        if (savedApiKey) {
            geminiKeyInput.value = savedApiKey;
        }
        
        // Auto-save the key when the user pastes or types it
        geminiKeyInput.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (val) {
                localStorage.setItem('geminiApiKey', val);
            } else {
                localStorage.removeItem('geminiApiKey');
            }
        });
    }

    // Form Submission
    const form = document.getElementById('daily-form');
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const entry = {
                date: document.getElementById('entry-date').value,
                summary: document.getElementById('summary').value,
                obstacle: document.getElementById('obstacle').value,
                learned: document.getElementById('learned').value,
                bravery: document.getElementById('bravery').value,
                mood: document.getElementById('mood').value,
                energy: document.getElementById('energy').value,
                stress_level: document.getElementById('stress_level').value,
                stress_source: document.getElementById('stress_source').value,
                alignment: document.getElementById('alignment').value,
                fin_stress: document.getElementById('fin_stress').value,
                selfTalk: document.getElementById('self-talk').value,
                attract: document.getElementById('attract').value,
                goodDeeds: document.getElementById('good-deeds').value,
                good_events: document.getElementById('good_events').value,
                serendipity: document.getElementById('serendipity').value,
                opportunities: document.getElementById('opportunities').value,
                meaningful_moment: document.getElementById('meaningful_moment').value,
                sleep: document.getElementById('sleep').value,
                meditation: document.getElementById('meditation').value,
                exercise: document.getElementById('exercise').value,
                food: document.getElementById('food').value,
                supplements: document.getElementById('supplements').value,
                body_signals: document.getElementById('body_signals').value,
                location: document.getElementById('location').value,
                nature: document.getElementById('nature').value,
                screen_time: document.getElementById('screen_time').value,
                creative: document.getElementById('creative').value,
                social: document.getElementById('social').value,
                timestamp: new Date().toISOString()
            };
            saveEntry(entry);
            alert('ENTRY SAVED AGGRESSIVELY! GREAT JOB.');
            
            // Auto-hide after save
            const formContainer = document.getElementById('form-container');
            const toggleFormBtn = document.getElementById('toggle-form-btn');
            if (formContainer) formContainer.classList.add('hidden');
            if (toggleFormBtn) toggleFormBtn.textContent = '+ NEW JOURNAL ENTRY';
            
            document.getElementById('daily-form').reset();
            document.getElementById('entry-date').valueAsDate = new Date();
        });
    }

    // Analysis Logic
    const analyzeBtn = document.getElementById('analyze-btn');
    if (analyzeBtn) {
        analyzeBtn.addEventListener('click', () => {
            const apiKey = document.getElementById('gemini-key').value.trim();
            if (!apiKey) {
                alert('ERROR: PLEASE ENTER YOUR GEMINI API KEY FIRST!');
                return;
            }
            localStorage.setItem('geminiApiKey', apiKey);

            const start = document.getElementById('analyze-start').value;
            const end = document.getElementById('analyze-end').value;
            const entries = getEntries();
            const dates = Object.keys(entries)
                .filter(d => (!start || d >= start) && (!end || d <= end))
                .sort();

            if (dates.length === 0) {
                resultDiv.classList.remove('hidden');
                contentDiv.innerHTML = `<div style="padding:20px; background:yellow; color:#000; border:4px solid #000; font-weight:bold;">ERROR: NO ENTRIES FOUND FOR THIS RANGE. Log some data first or click LOAD DEMO DATA.</div>`;
                return;
            }

            const compiledData = dates.map(d => entries[d]);
            const resultDiv = document.getElementById('analysis-result');
            const contentDiv = document.getElementById('result-content');
            
            resultDiv.classList.remove('hidden');
            contentDiv.innerHTML = `<div style="padding:20px; font-weight:bold; background:var(--secondary); color:#fff;">Finding best available AI model...</div>`;
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); 

            async function runAnalysis() {
                try {
                    contentDiv.innerHTML = `<div class="pulse" style="padding:20px; font-weight:bold; background:var(--secondary); color:#fff;">Finding your best AI model...</div>`;
                    
                    // Step 1: Discover what you actually have access to
                    const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
                    const modelsData = await modelsRes.json();
                    
                    if (!modelsData.models) throw new Error("Could not list models. Check your API key.");

                    // Find the best Flash model (prefer 3, then 2, then 1.5)
                    const supported = modelsData.models.filter(m => m.supportedGenerationMethods.includes('generateContent'));
                    const bestModel = supported.find(m => m.name.includes('flash') && m.name.includes('3')) || 
                                      supported.find(m => m.name.includes('flash') && m.name.includes('2')) || 
                                      supported.find(m => m.name.includes('flash')) || 
                                      supported[0];

                    if (!bestModel) throw new Error("No compatible AI models found.");
                    
                    const shortName = bestModel.name.split('/').pop();
                    console.log(`TIVITY: Selected best model -> ${shortName}`);
                    
                    const badge = document.getElementById('active-model-badge');
                    if (badge) {
                        badge.textContent = shortName;
                        badge.style.background = 'var(--success)';
                    }

                    contentDiv.innerHTML = `<div class="pulse" style="padding:20px; font-weight:bold; background:var(--secondary); color:#fff;">Analyzing with ${shortName}...</div>`;

                    const analysisRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${bestModel.name}:generateContent?key=${apiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: `Analyze these journal entries and identify patterns for personal growth. Be aggressive and insightful. Use markdown:\n${JSON.stringify(compiledData)}` }] }]
                        })
                    });

                    if (!analysisRes.ok) {
                        const err = await analysisRes.json();
                        throw new Error(err.error?.message || "Analysis request failed.");
                    }

                    const data = await analysisRes.json();
                    clearTimeout(timeoutId);

                    if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts) {
                        const text = data.candidates[0].content.parts[0].text;
                        contentDiv.innerHTML = `<div style="padding:20px; border:4px solid #000; background:#fff; line-height:1.6; color:#000;">${window.parseMarkdown(text)}</div>`;
                    } else {
                        throw new Error("Unexpected response format from Gemini API.");
                    }

                } catch (err) {
                    clearTimeout(timeoutId);
                    console.error("TIVITY: Analysis process failed:", err);
                    contentDiv.innerHTML = `<div style="padding:20px; background:red; color:#fff; border:4px solid #000; font-weight:bold;">ANALYSIS FAILED: ${err.message}</div>`;
                }
            }

            runAnalysis();
        });
    }

    // Demo Data Logic
    const demoBtn = document.getElementById('demo-data-btn');
    if (demoBtn) {
        console.log("TIVITY: Demo button found and attaching listener.");
        demoBtn.addEventListener('click', () => {
            console.log("TIVITY: Demo button clicked!");
            
            const entries = getEntries();
            console.log("TIVITY: Current entries count:", Object.keys(entries).length);
            
            const today = new Date();
            for (let i = 0; i < 7; i++) {
                const dateClone = new Date(today);
                dateClone.setDate(today.getDate() - i);
                const dString = dateClone.toISOString().split('T')[0];
                entries[dString] = {
                    date: dString,
                    summary: `Demo entry for ${dString}`,
                    mood: i % 2 === 0 ? 'Good' : 'Tired',
                    energy: 5 + i,
                    stress_level: 10 - i,
                    timestamp: dateClone.toISOString()
                };
                console.log(`TIVITY: Created demo entry for ${dString}`);
            }
            
            localStorage.setItem('journalEntries', JSON.stringify(entries));
            console.log("TIVITY: Demo data saved to localStorage.");
            
            // UI Feedback
            const results = document.getElementById('result-content');
            if (results) {
                results.innerHTML = '<div style="padding:20px; background:#00ff00; color:#000; border:4px solid #000; font-weight:bold;">DEMO DATA LOADED SUCCESSFULLY! CHECK THE HISTORY TAB.</div>';
                document.getElementById('analysis-result').classList.remove('hidden');
            }
            
            if (document.getElementById('history-tab').classList.contains('active')) {
                console.log("TIVITY: History tab is active, rendering history.");
                renderHistory();
            }
        });
    }

    // Education Form Logic
    const subjectForm = document.getElementById('subject-form');
    if (subjectForm) {
        subjectForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const title = document.getElementById('subject-title').value;
            const date = document.getElementById('subject-date').value;
            const subjects = getSubjects();
            subjects.push({
                id: Date.now().toString(),
                title,
                date,
                done: false
            });
            saveSubjects(subjects);
            renderSubjects();
            subjectForm.reset();
        });
    }

    // Init subjects on load
    renderSubjects();
}

// Start
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

window.changeDashboardMonth = (offset) => {
    let { year, month } = window.dashboardState;
    month += offset;
    if (month > 11) { month = 0; year++; }
    if (month < 0) { month = 11; year--; }
    window.dashboardState.year = year;
    window.dashboardState.month = month;
    window.renderTagDashboard();
};

window.toggleDashboardView = () => {
    window.dashboardState.viewMode = window.dashboardState.viewMode === 'single' ? 'yearly' : 'single';
    window.renderTagDashboard();
};

// --- Education Logic ---

function getSubjects() {
    try {
        return JSON.parse(localStorage.getItem('journalSubjects')) || [];
    } catch (e) {
        return [];
    }
}

function saveSubjects(subjects) {
    localStorage.setItem('journalSubjects', JSON.stringify(subjects));
    // Sync each subject document to Firestore
    subjects.forEach(s => {
        if (s.id) syncToCloud("subjects", s.id, s);
    });
}

window.deleteSubject = async (id) => {
    let subjects = getSubjects();
    subjects = subjects.filter(s => s.id !== id);
    // Save locally first (without syncing — we handle Firestore below)
    localStorage.setItem('journalSubjects', JSON.stringify(subjects));
    renderSubjects();
    // Delete the specific Firestore document
    if (window.firebaseDB) {
        try {
            const { doc, deleteDoc } = window.firestore;
            await deleteDoc(doc(window.firebaseDB, "users", SYNC_ID, "subjects", id));
        } catch (e) {
            console.error('TIVITY: Firestore subject delete error', e);
        }
    }
};

window.toggleSubject = (id) => {
    let subjects = getSubjects();
    let s = subjects.find(s => s.id === id);
    if (s) {
        s.done = !s.done;
        localStorage.setItem('journalSubjects', JSON.stringify(subjects));
        // Sync only the toggled document
        syncToCloud("subjects", s.id, s);
        renderSubjects();
    }
};

window.renderSubjects = () => {
    const list = document.getElementById('subjects-list');
    if (!list) return;
    const subjects = getSubjects();
    list.innerHTML = '';
    
    // Sort by date or id
    subjects.sort((a, b) => {
        if (a.date && b.date) return new Date(a.date) - new Date(b.date);
        if (a.date) return -1;
        if (b.date) return 1;
        return b.id - a.id;
    });

    subjects.forEach(subject => {
        const item = document.createElement('div');
        item.className = `todo-item ${subject.done ? 'done' : ''}`;
        item.innerHTML = `
            <div class="todo-main-row">
                <div class="todo-info">
                    <span class="todo-text">${subject.title}</span>
                    ${subject.date ? `<span class="todo-due">TARGET: ${subject.date}</span>` : ''}
                </div>
                <div class="todo-actions">
                    <button class="todo-btn" onclick="toggleSubject('${subject.id}')">${subject.done ? 'RESTORE' : 'DONE'}</button>
                    <button class="todo-btn" onclick="deleteSubject('${subject.id}')">X</button>
                </div>
            </div>
        `;
        list.appendChild(item);
    });
};

async function callEduGemini(prompt, resultContainerId, wordType = null) {
    let apiKey = localStorage.getItem('geminiApiKey');
    const container = document.getElementById(resultContainerId);
    
    if (!apiKey) {
        container.innerHTML = '<p style="color:red;"><strong>ERROR:</strong> No Gemini API Key found. Please enter it on the Journal tab.</p>';
        container.classList.remove('hidden');
        return;
    }
    
    container.innerHTML = '<p class="pulse"><em>Finding your best AI Oracle...</em></p>';
    container.classList.remove('hidden');
    
    try {
        // Step 1: Smart discovery
        const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const modelsData = await modelsRes.json();
        
        if (!modelsData.models) throw new Error(modelsData.error?.message || "Could not list models. Check your API key.");
        
        const supported = modelsData.models.filter(m => m.supportedGenerationMethods.includes('generateContent'));
        const bestModel = supported.find(m => m.name.includes('flash') && m.name.includes('3')) || 
                          supported.find(m => m.name.includes('flash') && m.name.includes('2')) || 
                          supported.find(m => m.name.includes('flash')) || 
                          supported[0];

        const shortName = bestModel.name.split('/').pop();
        const badgeId = resultContainerId.replace('-result', '-model-badge').replace('-content', '-model-badge');
        const badge = document.getElementById(badgeId);
        if (badge) {
            badge.textContent = shortName;
            badge.style.background = 'var(--success)';
        }

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${bestModel.name}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 1.0 }
            })
        });

        if (!response.ok) {
            if (response.status === 429) throw new Error("429_RATE_LIMIT");
            throw new Error(`API Error: ${response.status}`);
        }
        
        const data = await response.json();
        let text = data.candidates[0].content.parts[0].text;

        if (wordType === 'vocab') {
            try {
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (!jsonMatch) throw new Error('No JSON found');
                const vocab = JSON.parse(jsonMatch[0]);
                const seen = JSON.parse(localStorage.getItem('seenVocabWords') || '[]');
                if (vocab.word && !seen.includes(vocab.word)) { seen.push(vocab.word); localStorage.setItem('seenVocabWords', JSON.stringify(seen)); }
                renderVocabCard(container, vocab);
            } catch(parseErr) {
                container.innerHTML = `<div style="padding:15px;">${window.parseMarkdown(text)}</div>`;
            }
        } else if (wordType === 'spanish') {
            try {
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (!jsonMatch) throw new Error('No JSON found');
                const spanish = JSON.parse(jsonMatch[0]);
                const seen = JSON.parse(localStorage.getItem('seenSpanishWords') || '[]');
                if (spanish.word && !seen.includes(spanish.word)) { seen.push(spanish.word); localStorage.setItem('seenSpanishWords', JSON.stringify(seen)); }
                renderSpanishCard(container, spanish);
            } catch(parseErr) {
                container.innerHTML = `<div style="padding:15px;">${window.parseMarkdown(text)}</div>`;
            }
        } else {
            // Check if it's structured JSON for a custom category
            try {
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch && !isTest) { // Only try to render structured if not a test result
                    const obj = JSON.parse(jsonMatch[0]);
                    if (obj.title && obj.content) {
                        container.innerHTML = `
                            <div style="padding:20px; border:4px solid #000; background:#fff; box-shadow:6px 6px 0 #000; font-family:inherit;">
                                <h3 style="margin-top:0; border-bottom:4px solid #000; padding-bottom:12px; font-size:1.4rem; letter-spacing:1px; text-transform:uppercase;">${obj.title}</h3>
                                <div style="line-height:1.6; font-size:1.05rem; margin-bottom:20px;">${obj.content.replace(/\n/g, '<br>')}</div>
                                ${obj.example ? `
                                    <div style="background:#f9f9f9; padding:15px; border:3px solid #000; margin-bottom:15px;">
                                        <div style="font-size:0.75rem; font-weight:900; letter-spacing:2px; color:#888; text-transform:uppercase; margin-bottom:8px;">Example</div>
                                        <p style="margin:0; font-style:italic;">"${obj.example}"</p>
                                    </div>` : ''}
                                ${obj.key_takeaway ? `
                                    <div style="background:var(--success); color:#000; padding:12px 15px; border:3px solid #000; font-weight:700;">
                                        💡 KEY TAKEAWAY: ${obj.key_takeaway}
                                    </div>` : ''}
                            </div>
                        `;
                        return;
                    }
                }
            } catch (e) { /* Fallback to markdown */ }
            container.innerHTML = window.parseMarkdown(text);
        }
    } catch (err) {
        if (err.message === "429_RATE_LIMIT") {
            let mockResponse = "";
            if (prompt.includes("GRE")) {
                mockResponse = `<strong>[MOCK DATA - API QUOTA EXCEEDED]</strong><br><br>
<strong>Word:</strong> Ephemeral (adjective)<br>
<strong>Morphology:</strong> Greek <em>ephemeros</em> (lasting a day).<br>
<strong>Definition:</strong> Lasting for a very short time.<br>
<strong>Example:</strong> The beauty of the sunset was ephemeral, fading quickly into night.`;
            } else if (prompt.includes("Spanish")) {
                mockResponse = `<strong>[MOCK DATA - API QUOTA EXCEEDED]</strong><br><br>
<strong>Word:</strong> Sobremesa (noun)<br>
<strong>Meaning:</strong> The time spent after lunch or dinner talking to the people you shared the meal with.<br>
<strong>Example:</strong> Tuvimos una sobremesa muy agradable. (We had a very pleasant after-dinner conversation.)`;
            } else {
                mockResponse = `<strong>[MOCK DATA - API QUOTA EXCEEDED]</strong><br><br>
<em>Google is actively returning a 429 Quota Error for your API Key. This means your app code is 100% correct, but Google AI Studio is rejecting the request (rate limited or out of quota).</em>`;
            }
            container.innerHTML = `<div style="padding:15px; border: 2px dashed var(--secondary); background:#fff;">${mockResponse}</div>`;
        } else {
            container.innerHTML = `<p style="color:var(--secondary); font-weight:bold;">Failed: ${err.message}</p>`;
        }
    }
}

window.parseMarkdown = (text) => {
    if (!text) return "";
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/## (.*?)\n/g, '<h3>$1</h3>\n')
        .replace(/# (.*?)\n/g, '<h2>$1</h2>\n')
        .replace(/\n/g, '<br>');
};

window.getNewEduItem = (type) => {
    let prompt = "";
    let containerId = "";
    
    if (type === 'vocab') {
        const seenVocab = JSON.parse(localStorage.getItem('seenVocabWords') || '[]');
        const avoidList = seenVocab.length > 0 ? `Do NOT use any of these words: ${seenVocab.join(', ')}.` : '';
        prompt = `You are a GRE vocabulary tutor. Give me one advanced, graduate-level GRE vocabulary word. ${avoidList}
Return ONLY valid JSON — no explanation, no markdown, no extra text — in this exact format:
{
  "word": "the word",
  "pronunciation": "phonetic guide e.g. /ep-ih-FAN-ee/",
  "etymology": "Latin/Greek roots and original meaning",
  "forms": [
    { "form": "the exact word as it appears in this grammatical form", "partOfSpeech": "noun/verb/adjective/adverb/etc", "definition": "precise full definition for this form", "example": "A vivid, complete sentence using this form in context" },
    { "form": "another form e.g. adjective or verb form", "partOfSpeech": "...", "definition": "...", "example": "..." }
  ]
}
Include all meaningful morphological forms. Make the definitions precise and the examples vivid and memorable.`;
        containerId = "vocab-content";
    } else if (type === 'spanish') {
        const seenSpanish = JSON.parse(localStorage.getItem('seenSpanishWords') || '[]');
        const avoidList = seenSpanish.length > 0 ? `Do NOT use any of these words/phrases: ${seenSpanish.join(', ')}.` : '';
        prompt = `You are a patient Spanish tutor teaching a complete beginner. The student knows zero Spanish. Teach me one high-frequency, practical Spanish word or phrase that a beginner needs for real everyday conversations — things like greetings, ordering food, asking for directions, expressing needs, common courtesy phrases, or essential verbs like want/need/have/go/be. ${avoidList}
Return ONLY valid JSON — no explanation, no markdown, no extra text — in this exact format:
{
  "word": "the Spanish word or phrase",
  "pronunciation": "simple phonetic guide for English speakers e.g. /preh-FEHR-oh/ — make it easy to sound out",
  "translation": "English meaning",
  "type": "noun / verb / adjective / phrase / expression / etc",
  "gender": "masculine / feminine / neutral / n/a",
  "grammarNotes": [
    "A beginner-friendly grammar note — explain it in plain English as if the student has never studied a language before",
    "Another simple tip or common mistake to avoid"
  ],
  "conjugations": [
    { "tense": "Present", "forms": [{"pronoun": "yo", "form": "..."},  {"pronoun": "tú", "form": "..."}, {"pronoun": "él/ella", "form": "..."}, {"pronoun": "nosotros", "form": "..."}, {"pronoun": "vosotros", "form": "..."}, {"pronoun": "ellos", "form": "..."}] }
  ],
  "examples": [
    { "spanish": "A very simple, short sentence a beginner would actually say.", "english": "Its English translation." },
    { "spanish": "Another practical sentence for a real situation like a restaurant, street, or store.", "english": "Translation." },
    { "spanish": "A third sentence showing a slightly different use.", "english": "Translation." }
  ],
  "tip": "A fun memory trick, cultural note, or simple comparison to English to help this word stick."
}
If the word is not a verb, return an empty array for conjugations. Keep everything simple, friendly, and practical — this person is just starting out.`;
        containerId = "spanish-content";
    } else {
        // Custom Category
        const cats = getEduCategories();
        const cat = cats.find(c => c.id === type);
        const catName = cat ? cat.name : type;
        prompt = `You are an expert tutor for the subject: "${catName}". 
        Provide a concise, high-impact educational insight, concept, or piece of knowledge related to ${catName}.
        Return ONLY valid JSON in this exact format:
        {
          "title": "Short title of the concept",
          "content": "A clear, engaging explanation of the concept (can include bullet points using \\n)",
          "example": "A practical example or use case",
          "key_takeaway": "The one thing to remember"
        }
        Do not include markdown blocks or any other text.`;
        containerId = `${type}-content`;
    }
    
    if (prompt) {
        callEduGemini(prompt, containerId, type);
    }
};

function renderVocabCard(container, vocab) {
    const formsHTML = (vocab.forms || []).map(f => `
        <div style="margin-bottom:18px; padding:14px; border-left:5px solid #ff6b00; background:#fffdf9;">
            <div style="margin-bottom:6px;">
                <span style="font-size:1.15rem; font-weight:900; font-family:inherit; color:#000;">${f.form}</span>
                <span style="margin-left:10px; font-size:0.8rem; font-weight:700; letter-spacing:1px; background:#ff6b00; color:#fff; padding:2px 8px; border-radius:2px; text-transform:uppercase;">${f.partOfSpeech}</span>
            </div>
            <p style="margin:0 0 8px 0; color:#222; font-size:0.97rem; line-height:1.5;">${f.definition}</p>
            <p style="margin:0; font-size:0.93rem; color:#555; font-style:italic; line-height:1.5;">&ldquo;${f.example}&rdquo;</p>
        </div>
    `).join('');

    container.innerHTML = `
        <div style="font-family:inherit; border:4px solid #000; background:#fff; box-shadow:6px 6px 0 #000;">

            <!-- Word Header -->
            <div style="background:#000; color:#fff; padding:18px 20px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
                <div>
                    <div style="font-size:2rem; font-weight:900; letter-spacing:2px; line-height:1;">${vocab.word ? vocab.word.toUpperCase() : 'WORD'}</div>
                    <div style="font-size:0.9rem; color:#ccc; margin-top:4px; font-style:italic;">${vocab.pronunciation || ''}</div>
                </div>
                <button onclick="window.pronounceWord('${(vocab.word||'').replace(/'/g, "\\'")}')"
                    style="background:#ff6b00; color:#fff; border:3px solid #fff; padding:10px 18px; font-family:inherit; font-weight:900; font-size:0.9rem; cursor:pointer; letter-spacing:1px; white-space:nowrap;">
                    🔊 PRONOUNCE
                </button>
            </div>

            <!-- Etymology -->
            <div style="padding:14px 20px; background:#f5f5f5; border-bottom:3px solid #000;">
                <span style="font-size:0.75rem; font-weight:900; letter-spacing:2px; color:#888; text-transform:uppercase;">Etymology</span>
                <p style="margin:4px 0 0 0; color:#333; font-size:0.95rem; line-height:1.5;">${vocab.etymology || 'Unknown origin'}</p>
            </div>

            <!-- Morphological Forms -->
            <div style="padding:18px 20px;">
                <div style="font-size:0.75rem; font-weight:900; letter-spacing:2px; color:#888; text-transform:uppercase; margin-bottom:14px;">Morphological Forms</div>
                ${formsHTML}
            </div>
        </div>
    `;
}

window.pronounceWord = (word, lang = 'en-US') => {
    if (!word) return;
    if (!window.speechSynthesis) return alert('Your browser does not support text-to-speech.');
    const utter = new SpeechSynthesisUtterance(word);
    utter.lang = lang;
    utter.rate = 0.85;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
};

function renderSpanishCard(container, s) {
    const safeWord = (s.word || '').replace(/'/g, "\\'" );

    // Grammar Notes
    const grammarHTML = (s.grammarNotes || []).map(note =>
        `<li style="margin-bottom:8px; line-height:1.5; color:#222;">${note}</li>`
    ).join('');

    // Conjugation table (only if verb has conjugations)
    let conjugationHTML = '';
    if (s.conjugations && s.conjugations.length > 0) {
        const tableRows = (s.conjugations[0].forms || []).map(f =>
            `<tr>
                <td style="padding:7px 12px; font-weight:700; color:#555; border-right:2px solid #eee; white-space:nowrap;">${f.pronoun}</td>
                <td style="padding:7px 12px; color:#000; font-weight:600;">${f.form}</td>
            </tr>`
        ).join('');
        conjugationHTML = `
            <div style="padding:16px 20px; border-top:3px solid #000;">
                <div style="font-size:0.75rem; font-weight:900; letter-spacing:2px; color:#888; text-transform:uppercase; margin-bottom:12px;">Present Tense Conjugation</div>
                <table style="border-collapse:collapse; width:100%; max-width:340px; border:3px solid #000;">
                    ${tableRows}
                </table>
            </div>`;
    }

    // Sentence Examples
    const examplesHTML = (s.examples || []).map((ex, i) => `
        <div style="margin-bottom:14px; padding:12px 14px; background:#f9f9ff; border-left:5px solid #5500ff;">
            <p style="margin:0 0 5px 0; font-weight:700; font-size:1rem; color:#000;">${ex.spanish}</p>
            <p style="margin:0; font-size:0.93rem; color:#555; font-style:italic;">${ex.english}</p>
        </div>
    `).join('');

    // Type / Gender badge
    const typeBadge = s.type ? `<span style="font-size:0.8rem; font-weight:700; letter-spacing:1px; background:#5500ff; color:#fff; padding:2px 8px; border-radius:2px; text-transform:uppercase; margin-right:6px;">${s.type}</span>` : '';
    const genderBadge = (s.gender && s.gender !== 'n/a') ? `<span style="font-size:0.8rem; font-weight:700; letter-spacing:1px; background:#222; color:#fff; padding:2px 8px; border-radius:2px; text-transform:uppercase;">${s.gender}</span>` : '';

    container.innerHTML = `
        <div style="font-family:inherit; border:4px solid #000; background:#fff; box-shadow:6px 6px 0 #000;">

            <!-- Word Header -->
            <div style="background:#000; color:#fff; padding:18px 20px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
                <div>
                    <div style="font-size:2rem; font-weight:900; letter-spacing:2px; line-height:1;">${(s.word || 'WORD').toUpperCase()}</div>
                    <div style="font-size:0.9rem; color:#ccc; margin-top:4px; font-style:italic;">${s.pronunciation || ''}</div>
                </div>
                <button onclick="window.pronounceWord('${safeWord}', 'es-ES')"
                    style="background:#5500ff; color:#fff; border:3px solid #fff; padding:10px 18px; font-family:inherit; font-weight:900; font-size:0.9rem; cursor:pointer; letter-spacing:1px; white-space:nowrap;">
                    🔊 PRONOUNCE
                </button>
            </div>

            <!-- Translation + Type -->
            <div style="padding:14px 20px; background:#f5f5f5; border-bottom:3px solid #000; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                <div>
                    <span style="font-size:0.75rem; font-weight:900; letter-spacing:2px; color:#888; text-transform:uppercase;">Translation</span>
                    <p style="margin:4px 0 0 0; font-size:1.05rem; font-weight:700; color:#000;">${s.translation || ''}</p>
                </div>
                <div>${typeBadge}${genderBadge}</div>
            </div>

            <!-- Grammar Notes -->
            ${ grammarHTML ? `
            <div style="padding:16px 20px; border-bottom:3px solid #000;">
                <div style="font-size:0.75rem; font-weight:900; letter-spacing:2px; color:#888; text-transform:uppercase; margin-bottom:10px;">Grammar Notes</div>
                <ul style="margin:0; padding-left:18px;">${grammarHTML}</ul>
            </div>` : '' }

            <!-- Conjugation Table -->
            ${conjugationHTML}

            <!-- Sentence Examples -->
            <div style="padding:16px 20px; border-top:3px solid #000;">
                <div style="font-size:0.75rem; font-weight:900; letter-spacing:2px; color:#888; text-transform:uppercase; margin-bottom:12px;">Example Sentences</div>
                ${examplesHTML}
            </div>

            <!-- Tip -->
            ${ s.tip ? `
            <div style="padding:14px 20px; background:#fffbea; border-top:3px solid #000;">
                <span style="font-size:0.75rem; font-weight:900; letter-spacing:2px; color:#888; text-transform:uppercase;">Pro Tip</span>
                <p style="margin:6px 0 0 0; color:#333; font-size:0.95rem; line-height:1.5;">💡 ${s.tip}</p>
            </div>` : '' }
        </div>
    `;
}

window.runEduTest = (type) => {
    const input = document.getElementById(`${type}-test-input`).value;
    if (!input) return alert("Please enter a test query first.");
    
    let recentWordsText = "";
    if (type === 'vocab') {
        const seenVocab = JSON.parse(localStorage.getItem('seenVocabWords') || '[]');
        if (seenVocab.length > 0) {
            recentWordsText = `Here is my entire list of learned words in chronological order (oldest to newest): ${seenVocab.join(', ')}. `;
        }
    } else if (type === 'spanish') {
        const seenSpanish = JSON.parse(localStorage.getItem('seenSpanishWords') || '[]');
        if (seenSpanish.length > 0) {
            recentWordsText = `Here is my entire list of learned Spanish words in chronological order (oldest to newest): ${seenSpanish.join(', ')}. `;
        }
    }
    
    const contextMap = {
        'vocab': "I am studying advanced GRE vocabulary. ",
        'spanish': "I am learning Spanish for beginners. ",
        'subject': "I am studying specific subjects and books. "
    };
    
    // Default context for custom types
    let context = contextMap[type];
    if (!context) {
        const cats = getEduCategories();
        const cat = cats.find(c => c.id === type);
        context = `I am studying the subject: "${cat ? cat.name : type}". `;
    }

    const fullPrompt = `${context}${recentWordsText}Please test my knowledge based on this query: "${input}". Provide a short quiz or question.`;
    
    const resultId = `${type}-test-result`;
    const resultDiv = document.getElementById(resultId);
    if (resultDiv) {
        resultDiv.classList.remove('hidden');
        resultDiv.innerHTML = "Generating test...";
    }
    
    callEduGemini(fullPrompt, resultId, type, true);
};

// --- Education Categories Persistence ---
window.getEduCategories = () => {
    const defaults = [
        { id: 'vocab', name: 'Vocabulary', type: 'vocab' },
        { id: 'spanish', name: 'Spanish', type: 'spanish' },
        { id: 'subject', name: 'Subjects to Study', type: 'subject' }
    ];
    const saved = JSON.parse(localStorage.getItem('eduCategories') || '[]');
    // If first time, return defaults
    if (localStorage.getItem('eduCategories') === null) {
        localStorage.setItem('eduCategories', JSON.stringify(defaults));
        return defaults;
    }
    return saved;
};

window.saveEduCategories = (cats) => {
    localStorage.setItem('eduCategories', JSON.stringify(cats));
    // Push to cloud
    syncToCloud("settings", "education", { cats });
};

window.deleteEduSection = (id) => {
    if (!confirm("Are you sure you want to delete this education category?")) return;
    const cats = getEduCategories().filter(c => c.id !== id);
    saveEduCategories(cats);
    location.reload(); // Refresh to update UI based on persisted state
};

window.addCustomEducationSection = () => {
    const name = prompt("Enter the name of the new education category:");
    if (!name) return;
    
    const safeName = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const cats = getEduCategories();
    
    if (cats.find(c => c.id === safeName)) return alert("Category already exists.");
    
    cats.push({ id: safeName, name: name, type: 'custom' });
    saveEduCategories(cats);
    location.reload();
};

// Initial Load of Education Sections
document.addEventListener("DOMContentLoaded", () => {
    const container = document.getElementById('education-sections-container');
    if (!container) return;
    
    const cats = getEduCategories();
    // Clear hardcoded ones from container if any (though we'll clean up index.html next)
    container.innerHTML = '';
    
    cats.forEach(cat => {
        const card = document.createElement('div');
        card.className = 'education-card';
        card.id = `edu-section-${cat.id}`;
        
        let innerHTML = `
            <div class="edu-card-header" style="display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <h3 style="margin:0;">${cat.name}</h3>
                    ${cat.type !== 'subject' ? `<span id="${cat.id}-model-badge" class="model-indicator" style="background:#000; color:#fff; padding:2px 6px; font-size:0.6rem; border:1px solid #000; font-weight:bold;">AI 3.0</span>` : ''}
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    ${cat.type === 'vocab' ? `<button class="todo-btn" style="background:var(--secondary); color:#fff;" onclick="getNewEduItem('vocab')">NEW WORD</button>` : ''}
                    ${cat.type === 'spanish' ? `<button class="todo-btn" style="background:var(--tertiary); color:#fff;" onclick="getNewEduItem('spanish')">NEW WORD</button>` : ''}
                    ${cat.type === 'custom' ? `<button class="todo-btn" style="background:var(--primary); color:#fff;" onclick="getNewEduItem('${cat.id}')">GENERATE</button>` : ''}
                    <button class="todo-btn" onclick="deleteEduSection('${cat.id}')" style="background:#ff4444; color:#fff; padding: 2px 8px; border:2px solid #000; box-shadow:2px 2px 0 #000; font-weight:bold;">X</button>
                </div>
            </div>
        `;

        if (cat.type === 'subject') {
            innerHTML += `
                <form id="subject-form" class="todo-entry-form" style="padding:15px; margin-bottom: 15px;">
                    <div class="field-group" style="margin-bottom:10px;">
                        <input type="text" id="subject-title" placeholder="Subject or Book Title" required>
                    </div>
                    <div class="field-group" style="margin-bottom:10px;">
                        <input type="date" id="subject-date">
                    </div>
                    <button type="submit" class="todo-btn" style="background:var(--success); width:100%;">ADD SUBJECT</button>
                </form>
                <div id="subjects-list" class="todo-list"></div>
            `;
        } else {
            innerHTML += `<div id="${cat.id}-content" class="edu-content-area hidden"></div>`;
        }

        innerHTML += `
            <div class="edu-test-area" style="margin-top:${cat.type === 'subject' ? '20px' : '0'};">
                <h4>Test Your Knowledge</h4>
                <div style="display:flex; gap:10px;">
                    <input type="text" id="${cat.id}-test-input" placeholder="e.g. 'Quiz me'" style="flex:1;">
                    <button class="todo-btn" style="flex:none; width:auto; white-space:nowrap;" onclick="runEduTest('${cat.id}')">TEST ME</button>
                </div>
                <div id="${cat.id}-test-result" class="edu-content-area hidden" style="margin-top: 15px;"></div>
            </div>
        `;
        
        card.innerHTML = innerHTML;
        container.appendChild(card);
    });

    // Re-bind subject form if it exists
    const subForm = document.getElementById('subject-form');
    if (subForm) {
        subForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const title = document.getElementById('subject-title').value;
            const date = document.getElementById('subject-date').value;
            const subjects = getSubjects();
            subjects.push({ id: Date.now().toString(), title, date, done: false });
            saveSubjects(subjects);
            document.getElementById('subject-title').value = '';
            document.getElementById('subject-date').value = '';
            renderSubjects();
        });
        renderSubjects();
    }
});

// --- Quick Notepad Logic ---
document.addEventListener("DOMContentLoaded", () => {
    const notepad = document.getElementById('quick-notepad');
    const status = document.getElementById('notepad-status');
    if (!notepad) return;

    // Load saved data
    const savedNotes = localStorage.getItem('quickNotepadData');
    if (savedNotes) {
        notepad.value = savedNotes;
    }

    const saveNotepad = () => {
        localStorage.setItem('quickNotepadData', notepad.value);
        if (typeof syncToCloud === 'function') {
            syncToCloud("settings", "notepad", { notes: notepad.value });
        }
    };

    // Auto-save logic
    let timeoutId;
    notepad.addEventListener('input', () => {
        status.textContent = 'Saving...';
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            saveNotepad();
            status.textContent = 'Saved';
            setTimeout(() => { status.textContent = ''; }, 2000);
        }, 800);
    });

    // Save on blur or unload to be safe
    notepad.addEventListener('blur', saveNotepad);
    window.addEventListener('beforeunload', saveNotepad);
});

// --- AERIAL VIEW CALENDAR ---
let currentCalDate = new Date();

function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const monthYearText = document.getElementById('cal-month-year');
    if (!grid || !monthYearText) return;

    const year = currentCalDate.getFullYear();
    const month = currentCalDate.getMonth();
    
    const monthNames = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
    monthYearText.textContent = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    let html = '';
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    daysOfWeek.forEach(day => {
        html += `<div class="calendar-day-header">${day}</div>`;
    });

    for (let i = 0; i < firstDay; i++) {
        html += `<div class="calendar-day empty"></div>`;
    }

    const tasks = getTasks();

    for (let i = 1; i <= daysInMonth; i++) {
        const dateStr = `${year}-${String(month+1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        
        let dayTasksHtml = '';
        const dayTasks = tasks.filter(t => t.dueDate === dateStr && !t.done);
        
        dayTasks.forEach(t => {
            const pData = priorities.find(p => p.id === t.priority);
            const color = pData ? pData.color : 'var(--primary)';
            const displayColor = pData ? pData.color : '#000';
            const bg = pData ? '#fff' : 'var(--primary)';
            dayTasksHtml += `<div class="calendar-task" style="border-left: 6px solid ${displayColor};" title="${t.text}">${t.text}</div>`;
        });

        html += `
            <div class="calendar-day">
                <div class="calendar-date-number">${i}</div>
                ${dayTasksHtml}
            </div>
        `;
    }
    grid.innerHTML = html;
    console.log("TIVITY: Calendar rendered with " + (daysInMonth + 7) + " cells.");
}

document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => renderCalendar(), 200);

    const prevBtn = document.getElementById('cal-prev');
    const nextBtn = document.getElementById('cal-next');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            currentCalDate.setMonth(currentCalDate.getMonth() - 1);
            renderCalendar();
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            currentCalDate.setMonth(currentCalDate.getMonth() + 1);
            renderCalendar();
        });
    }

    const toggleBtn = document.getElementById('toggle-calendar-btn');
    const calView = document.getElementById('calendar-view');
    if (toggleBtn && calView) {
        toggleBtn.onclick = (e) => {
            e.preventDefault();
            const isHidden = calView.style.display === 'none';
            calView.style.display = isHidden ? 'block' : 'none';
            toggleBtn.textContent = isHidden ? 'CLOSE CALENDAR' : 'OPEN CALENDAR';
            if (isHidden) renderCalendar();
            console.log("TIVITY: Calendar Toggle", isHidden);
        };
    }

    renderTagUI();
    checkDueDates();

    // Populate Sync ID in UI
    const syncInput = document.getElementById('sync-id-display');
    if (syncInput) syncInput.value = SYNC_ID;

    // Start Firebase Sync
    setTimeout(() => {
        initialCloudPull();
        subscribeToCloud();
    }, 1000);

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./service-worker.js')
                .then(reg => console.log('TIVITY: Service Worker Registered', reg))
                .catch(err => console.error('TIVITY: Service Worker Failed', err));
        });
    }
});

function checkDueDates() {
    const tasks = JSON.parse(localStorage.getItem('journalTasks')) || [];
    const today = new Date().toISOString().split('T')[0];
    
    // Check tomorrow
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = tomorrowDate.toISOString().split('T')[0];

    const urgentTasks = tasks.filter(t => !t.done && (t.dueDate === today || t.dueDate === tomorrow));
    
    if (urgentTasks.length > 0) {
        const taskNames = urgentTasks.map(t => `• ${t.text} (${t.dueDate === today ? 'TODAY' : 'TOMORROW'})`).join('\n');
        // We use a small timeout to ensure the app is loaded before alerting
        setTimeout(() => {
            alert(`⚠️ NEARING DEADLINES:\n\n${taskNames}\n\nDon't let them slide!`);
        }, 1000);
    }
}

// --- DATA PERSISTENCE TOOLS (BACKUP/RESTORE) ---
window.exportAllData = () => {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        data[key] = localStorage.getItem(key);
    }
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tivity_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
};

window.importAllData = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (re) => {
            try {
                const data = JSON.parse(re.target.result);
                Object.keys(data).forEach(key => {
                    localStorage.setItem(key, data[key]);
                });
                alert("✅ DATA RESTORED SUCCESSFULLY!\n\nThe page will now reload to apply your saved state.");
                location.reload();
            } catch (err) {
                alert("❌ ERROR: Invalid backup file.");
                console.error(err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
};
