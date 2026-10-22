// Runs `task(attempt, previous)` up to `attempts` times, stopping at the first result `accept` approves.
// Returns the last result either way so the caller can report why it was not accepted.
export async function boundedRetry(task, accept, attempts = 2) {
  let result = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = await task(attempt, result);
    if (accept(result)) break;
  }
  return result;
}
