export function createAppearanceSaver(send) {
  let pending = Promise.resolve();
  return {
    save({ theme, skin }) {
      const task = pending.then(async () => {
        const current = await send("getConfig");
        return send("saveConfig", { config: { ...current, theme, skin } });
      });
      // A failed write must not prevent subsequent selections from saving.
      pending = task.catch(() => {});
      return task;
    },
    flush() {
      return pending;
    }
  };
}
