/**
 * Run `task` over `inputs` with at most `limit` in flight. A function limit is re-read before
 * each start, so the caller can lower it mid-run; tasks already running are left to finish.
 * Results keep input order, whatever order tasks finish in.
 */
export async function mapPool<T, R>(
  inputs: readonly T[],
  limit: number | (() => number),
  task: (input: T, index: number) => Promise<R>,
): Promise<R[]> {
  const cap = typeof limit === "number" ? () => limit : limit;
  const results: R[] = new Array(inputs.length);
  let next = 0;
  let running = 0;
  async function worker(): Promise<void> {
    while (next < inputs.length && running < Math.max(1, Math.floor(cap()))) {
      const index = next;
      next += 1;
      running += 1;
      results[index] = await task(inputs[index] as T, index);
      running -= 1;
    }
  }
  const workers = Math.max(1, Math.min(Math.floor(cap()), inputs.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
