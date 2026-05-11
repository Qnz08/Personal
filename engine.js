export function chooseBestTask(tasks, availableTime, energy) {
  let best = null;
  let bestScore = -Infinity;

  for (const task of tasks) {
    if (task.estimatedMinutes > availableTime) continue;

    const mentalPenalty =
      task.mentalLoad > energy ? 5 : 0;

    const postponePenalty = task.postponeCount * 2;

    const score =
      task.importance * 4
      - mentalPenalty
      - postponePenalty;

    if (score > bestScore) {
      bestScore = score;
      best = task;
    }
  }

  return best;
}
