import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, updateDoc, doc, onSnapshot, query, orderBy, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// Initialize Firebase
let db;
try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
} catch (error) {
    console.error("Firebase initialization failed. Check firebase-config.js", error);
}

// Elements
const taskListEl = document.getElementById('taskList');
const addTaskBtn = document.getElementById('addTaskBtn');
const modalOverlay = document.getElementById('modalOverlay');
const cancelBtn = document.getElementById('cancelBtn');
const saveBtn = document.getElementById('saveBtn');
const taskTitleInput = document.getElementById('taskTitle');
const taskDescriptionInput = document.getElementById('taskDescription');
const taskLinkInput = document.getElementById('taskLink');
const taskDateInput = document.getElementById('taskDate');
const taskASAPInput = document.getElementById('taskASAP');
const taskAssigneeInput = document.getElementById('taskAssignee');
const currentDateEl = document.getElementById('currentDate');
const modalTitle = document.querySelector('.modal h2');

let editingTaskId = null;

// Init
function init() {
    renderDate();
    setupEventListeners();

    if (db) {
        subscribeToTasks();
    } else {
        taskListEl.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted);">Firebase not configured.<br>Please check firebase-config.js</div>';
    }
}

function renderDate() {
    const now = new Date();
    const options = { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' };
    currentDateEl.textContent = now.toLocaleDateString('ja-JP', options).replace(/\//g, '.');
}

function subscribeToTasks() {
    const q = query(collection(db, "tasks"), orderBy("date"));

    // Real-time listener
    onSnapshot(q, (snapshot) => {
        const tasks = [];
        snapshot.forEach((doc) => {
            tasks.push({ id: doc.id, ...doc.data() });
        });
        renderTasks(tasks);
    }, (error) => {
        console.error("Error getting tasks: ", error);
        taskListEl.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--accent-pink);">Error loading tasks.</div>';
    });
}

function renderTasks(tasks) {
    taskListEl.innerHTML = '';

    // Sort: Incomplete first
    const sortedTasks = [...tasks].sort((a, b) => {
        if (a.completed === b.completed) {
            // If both incomplete/complete, sort by date
            // ASAP (isASAP=true) comes first
            if (a.isASAP && !b.isASAP) return -1;
            if (!a.isASAP && b.isASAP) return 1;

            return new Date(a.date) - new Date(b.date);
        }
        return a.completed ? 1 : -1;
    });

    sortedTasks.forEach(task => {
        const taskCard = document.createElement('div');

        // Check urgency (within 3 days OR ASAP)
        const isUrgent = (task.isASAP || checkUrgency(task.date)) && !task.completed;

        taskCard.className = `task-card ${task.completed ? 'completed' : ''} ${isUrgent ? 'urgent' : ''}`;

        // Click card to edit
        taskCard.onclick = () => {
            openModal(task);
        };

        const assigneeClass = (task.assignee || 'Hina').toLowerCase() === 'hina' ? 'hina' : 'togawa';
        const dateDisplay = task.isASAP ? 'なるはや' : formatDate(task.date);

        console.log('Task:', task.title, 'isASAP:', task.isASAP, 'dateDisplay:', dateDisplay);

        taskCard.innerHTML = `
            <div class="checkbox-wrapper" onclick="event.stopPropagation(); toggleTask('${task.id}', ${task.completed})">
                <div class="custom-checkbox">
                    <span class="material-symbols-rounded">check</span>
                </div>
            </div>
            <div class="task-content">
                <div class="task-title">${escapeHtml(task.title)}</div>
                ${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ''}
                ${task.link ? `<a href="${escapeHtml(task.link)}" target="_blank" rel="noopener noreferrer" class="task-link" onclick="event.stopPropagation()">
                    <span class="material-symbols-rounded" style="font-size: 16px;">link</span>
                    リンクを開く
                </a>` : ''}
                <div class="task-meta">
                    <span class="task-date">${dateDisplay} ${isUrgent ? '⚠️' : ''}</span>
                    <span class="assignee-badge ${assigneeClass}">${task.assignee || 'Hina'}</span>
                </div>
            </div>
            <button class="delete-btn" onclick="event.stopPropagation(); deleteTask('${task.id}')">
                <span class="material-symbols-rounded" style="font-size: 18px; color: var(--text-muted);">delete</span>
            </button>
        `;

        taskListEl.appendChild(taskCard);
    });
}

function checkUrgency(dateStr) {
    if (!dateStr) return false;

    // Parse YYYY-MM-DD manually to avoid UTC/Local timezone issues with new Date(string)
    const [year, month, day] = dateStr.split('-').map(Number);
    const dueDate = new Date(year, month - 1, day);
    dueDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const diffTime = dueDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Urgent if due today or within next 3 days
    return diffDays <= 3;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

async function toggleTask(id, currentStatus) {
    if (!db) return;
    const taskRef = doc(db, "tasks", id);
    try {
        await updateDoc(taskRef, {
            completed: !currentStatus
        });
    } catch (e) {
        console.error("Error updating task: ", e);
    }
}

async function saveTask() {
    if (!db) return;
    const title = taskTitleInput.value.trim();
    if (!title) return;

    const isASAP = taskASAPInput.checked;
    const dateVal = isASAP ? new Date().toISOString().split('T')[0] : (taskDateInput.value || new Date().toISOString().split('T')[0]);

    const taskData = {
        title: title,
        description: taskDescriptionInput.value.trim(),
        link: taskLinkInput.value.trim(),
        date: dateVal,
        isASAP: isASAP,
        assignee: taskAssigneeInput.value,
    };

    try {
        if (editingTaskId) {
            // Update existing
            await updateDoc(doc(db, "tasks", editingTaskId), taskData);
        } else {
            // Create new
            taskData.completed = false;
            taskData.createdAt = new Date().toISOString();
            await addDoc(collection(db, "tasks"), taskData);
        }
        closeModal();
    } catch (e) {
        console.error("Error saving task: ", e);
        alert("Failed to save task. Check console.");
    }
}

async function deleteTask(id) {
    if (!confirm("ひなさん本当に消しちゃうよ？")) return;
    if (!db) return;

    try {
        await deleteDoc(doc(db, "tasks", id));
    } catch (e) {
        console.error("Error deleting task: ", e);
    }
}

function openModal(task = null) {
    modalOverlay.classList.add('active');

    if (task) {
        // Edit Mode
        editingTaskId = task.id;
        modalTitle.textContent = "寺崎ひなのタスク編集";
        taskTitleInput.value = task.title;
        taskDescriptionInput.value = task.description || '';
        taskLinkInput.value = task.link || '';
        taskAssigneeInput.value = task.assignee;
        taskASAPInput.checked = !!task.isASAP;

        if (task.isASAP) {
            taskDateInput.disabled = true;
            taskDateInput.value = '';
        } else {
            taskDateInput.disabled = false;
            taskDateInput.value = task.date;
        }
    } else {
        // New Mode
        editingTaskId = null;
        modalTitle.textContent = "寺崎ひなの新しいタスク";
        taskTitleInput.value = '';
        taskDescriptionInput.value = '';
        taskLinkInput.value = '';
        taskASAPInput.checked = false;
        taskDateInput.disabled = false;
        taskDateInput.value = new Date().toISOString().split('T')[0];
    }

    taskTitleInput.focus();
}

function closeModal() {
    modalOverlay.classList.remove('active');
    taskTitleInput.value = '';
    editingTaskId = null;
}

function escapeHtml(text) {
    if (!text) return text;
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function setupEventListeners() {
    addTaskBtn.addEventListener('click', () => openModal());
    cancelBtn.addEventListener('click', closeModal);
    saveBtn.addEventListener('click', saveTask);

    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    // Toggle date input based on ASAP checkbox
    taskASAPInput.addEventListener('change', (e) => {
        if (e.target.checked) {
            taskDateInput.disabled = true;
        } else {
            taskDateInput.disabled = false;
            if (!taskDateInput.value) {
                taskDateInput.value = new Date().toISOString().split('T')[0];
            }
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalOverlay.classList.contains('active')) {
            closeModal();
        }
    });

    // Make global functions available
    window.toggleTask = toggleTask;
    window.deleteTask = deleteTask;
}

// Run
init();
