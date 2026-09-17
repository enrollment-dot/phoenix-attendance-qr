// Own a camera instance until delayed startup and cleanup have both completed.
export function cameraLifecycle() {
  let current = null;
  async function stop() {
    const entry = current;
    if (!entry) return;
    entry.cancelled = true;
    if (!entry.cleanup)
      entry.cleanup = (async () => {
        try {
          await entry.started;
        } catch {
          /* Startup did not complete. */
        }
        try {
          await entry.camera.stop();
        } catch {
          /* Already stopped. */
        }
        try {
          entry.camera.clear();
        } catch {
          /* Removed DOM. */
        }
        if (current === entry) current = null;
      })();
    await entry.cleanup;
  }
  async function start(camera, launch, isCurrent = () => true) {
    await stop();
    if (!isCurrent()) return false;
    const entry = { camera, cancelled: false };
    current = entry;
    entry.started = Promise.resolve().then(() => launch(camera));
    try {
      await entry.started;
    } catch (error) {
      await stop();
      throw error;
    }
    return !entry.cancelled;
  }
  return { start, stop };
}
