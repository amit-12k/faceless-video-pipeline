const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Exhausted or zero quotas do not clear within a job, so retrying them only burns more requests.
const isQuotaError = (detail) => /exceeded your current quota|quota exceeded|usage limit|plan limit/i.test(detail);

// Exported so tests can shorten the waits.
export const retryPolicy = { attempts: 3, delayMs: 2000, rateLimitDelayMs: 15000, maxRetryAfterMs: 60000 };

function retryDelay(response, attempt) {
  const seconds = Number(response.headers.get("retry-after"));
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, retryPolicy.maxRetryAfterMs);
  return attempt * (response.status === 429 ? retryPolicy.rateLimitDelayMs : retryPolicy.delayMs);
}

export function postJson(url, headers, payload, stage) {
  return requestJson(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload)
  }, stage);
}

async function requestJson(url, init, stage) {
  let lastError;
  for (let attempt = 1; attempt <= retryPolicy.attempts; attempt += 1) {
    let delay = attempt * retryPolicy.delayMs;
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(120000) });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 400);
        const error = new Error(stage + " API returned HTTP " + response.status + ": " + detail);
        error.retryable = response.status === 408 || response.status >= 500
          || (response.status === 429 && !isQuotaError(detail));
        delay = retryDelay(response, attempt);
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      const retryable = error.retryable || error.name === "TimeoutError" || error.name === "TypeError";
      if (!retryable || attempt === retryPolicy.attempts) break;
      await wait(delay);
    }
  }
  throw lastError;
}
