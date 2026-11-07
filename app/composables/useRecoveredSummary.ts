/**
 * Whether the protected preview has recovered books under review, and how many. Loaded in the browser only (the answer depends on the preview password, which the
 * browser already holds), so it never changes the server-rendered markup. When the site is public the answer is `enabled: false` and nothing is shown.
 */
export function useRecoveredSummary() {
  return useFetch<{ enabled: boolean; total: number }>('/api/preview/recovered/summary', {
    key: 'recovered-summary', server: false, lazy: true, default: () => ({ enabled: false, total: 0 }),
  })
}
