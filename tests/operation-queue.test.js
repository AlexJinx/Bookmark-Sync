import assert from "node:assert/strict";
import test from "node:test";

import { createSerialOperationQueue } from "../src/operation-queue.js";

test("操作队列严格按提交顺序串行执行", async () => {
  const queue = createSerialOperationQueue();
  const order = [];

  const first = queue.run("first", async () => {
    order.push("first:start");
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push("first:end");
  });
  const second = queue.run("second", async () => {
    order.push("second:start");
    order.push("second:end");
  });

  assert.equal(queue.getState().pendingCount, 2);
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first:start", "first:end", "second:start", "second:end"]);
  assert.deepEqual(queue.getState(), { busy: false, pendingCount: 0, activeName: "" });
});

test("前一个任务失败后队列仍能继续", async () => {
  const queue = createSerialOperationQueue();
  await assert.rejects(
    queue.run("failure", async () => {
      throw new Error("expected failure");
    }),
    /expected failure/
  );

  const result = await queue.run("success", async () => "ok");
  assert.equal(result, "ok");
});
