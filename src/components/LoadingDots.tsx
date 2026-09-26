/** An animated "…" for a line that is still working. The dots stay still when motion is reduced. */
export function LoadingDots() {
  return (
    <span aria-hidden="true" className="loading-dots">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}
