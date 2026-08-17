export function createSerialOperationQueue() {
  let tail = Promise.resolve();
  let pendingCount = 0;
  let activeName = "";

  function run(name, task) {
    if (typeof task !== "function") {
      throw new TypeError("队列任务必须是函数");
    }

    const operationName = typeof name === "string" && name.trim() ? name.trim() : "operation";
    pendingCount += 1;

    const execute = async () => {
      activeName = operationName;
      try {
        return await task();
      } finally {
        pendingCount = Math.max(0, pendingCount - 1);
        activeName = "";
      }
    };

    const result = tail.then(execute, execute);
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  function getState() {
    return {
      busy: pendingCount > 0,
      pendingCount,
      activeName
    };
  }

  return { run, getState };
}
