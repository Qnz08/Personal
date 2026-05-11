function getTaskKey(userId) {
  return userId ? `tasks_${userId}` : "tasks";
}

function getRoutineKey(userId) {
  return userId ? `routines_${userId}` : "routines";
}

function getSettingsKey(userId) {
  return userId ? `settings_${userId}` : "settings";
}

export function loadTasks(userId) {
  return JSON.parse(localStorage.getItem(getTaskKey(userId))) || [];
}

export function saveTasks(tasks, userId) {
  localStorage.setItem(getTaskKey(userId), JSON.stringify(tasks));
}

export function loadRoutines(userId) {
  return JSON.parse(localStorage.getItem(getRoutineKey(userId))) || [];
}

export function saveRoutines(routines, userId) {
  localStorage.setItem(getRoutineKey(userId), JSON.stringify(routines));
}

export function loadSettings(userId) {
  return JSON.parse(localStorage.getItem(getSettingsKey(userId))) || null;
}

export function saveSettings(settings, userId) {
  localStorage.setItem(getSettingsKey(userId), JSON.stringify(settings));
}
