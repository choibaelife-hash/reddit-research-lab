import test from "node:test";
import assert from "node:assert/strict";
import { runDue } from "./due.mjs";

test("due 워크스페이스마다 Reddit 파이프라인만 실행한다", async () => {
  const called = [];
  const result = await runDue({
    call: async (path) => {
      called.push(path);
      return {
        due: [{ id: "ws-1", name: "워크스페이스1", week: "2026-09-21" }],
      };
    },
    reddit: async (id) => called.push(`reddit:${id}`),
    log: () => {},
  });

  assert.deepEqual(called, ["/api/cron/due", "reddit:ws-1"]);
  assert.deepEqual(result, { total: 1, failed: 0 });
  assert.equal(called.some((value) => value.includes("video")), false);
});

test("한 워크스페이스 실패가 다음 워크스페이스를 막지 않는다", async () => {
  const called = [];
  const result = await runDue({
    call: async () => ({
      due: [
        { id: "bad", name: "실패", week: "2026-09-21" },
        { id: "good", name: "성공", week: "2026-09-21" },
      ],
    }),
    reddit: async (id) => {
      called.push(id);
      if (id === "bad") throw new Error("수집 실패");
    },
    log: () => {},
  });

  assert.deepEqual(called, ["bad", "good"]);
  assert.deepEqual(result, { total: 2, failed: 1 });
});

test("실행 대상이 없으면 외부 파이프라인을 부르지 않는다", async () => {
  let redditCalled = false;
  const result = await runDue({
    call: async () => ({ due: [] }),
    reddit: async () => { redditCalled = true; },
    log: () => {},
  });

  assert.equal(redditCalled, false);
  assert.deepEqual(result, { total: 0, failed: 0 });
});
