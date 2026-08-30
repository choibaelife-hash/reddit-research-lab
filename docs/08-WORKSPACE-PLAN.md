# 계정 · 워크스페이스 · 주간 실행 기록 구현 계획

> **작업자에게:** 이 계획은 `superpowers:subagent-driven-development` 또는
> `superpowers:executing-plans`로 태스크 단위로 실행한다. 체크박스(`- [ ]`)가 진행 표시다.

작성 2026-08-30 · 관련 문서: [07-SAAS](07-SAAS.md) · [saas/01-PRD](saas/01-PRD.md)

**목표:** 지금의 단일 비밀번호 개인 도구를, 고객 계정으로 로그인해서 자기 워크스페이스의 주간 결과를 계속 쌓아 보는 구조로 바꾼다.

**설계:** 화면은 항상 **한 워크스페이스의 한 주**를 본다. 데이터에 `workspace_id`와 `week` 두 컬럼을 따로 붙이지 않는다. **주간 실행 1회 = `runs` 한 줄**을 만들고, 결과 테이블에는 `run_id` 한 개만 붙인다. `runs`가 워크스페이스와 주차를 둘 다 들고 있으므로 "누구 것"과 "언제 것"이 컬럼 하나로 동시에 풀린다. 레딧 원본(`mentions`)과 이름 사전(`entities`)은 전역 공유로 남긴다 — 같은 서브레딧을 고객 수만큼 중복 수집하면 레딧 429에 막히기 때문이다(07-SAAS.md 1장).

**기술 스택:** Next.js 16 App Router · React 19 · Postgres(`pg`) · Node 24. **새 라이브러리는 추가하지 않는다.** 비밀번호 해시는 `node:crypto`의 scrypt, 세션 서명은 Web Crypto HMAC을 쓴다.

---

## 전역 제약

- **새 npm 패키지 금지.** 인증도 세션도 Node 기본 모듈로 만든다.
- **기존 탭 7개의 화면·동작을 바꾸지 않는다.** 상단에 드롭다운 2개와 `/mypage`만 추가한다.
- **`schema.sql`과 `schema-video.sql`은 수정하지 않는다.** 새 파일 `schema-saas.sql`에만 쓴다. 기존 두 파일은 여러 번 실행해도 안전하도록 짜여 있으므로 그 성질을 깨지 않는다.
- **`mentions` · `entities` · `entity_mentions` · `post_comments` · `demand_signals`에는 `run_id`를 붙이지 않는다.** 전역 공유 자산이다.
- 주석은 한국어로, **"왜 이렇게 했는지"**를 적는다. 기존 코드의 주석 스타일을 따른다.
- 테스트 프레임워크를 설치하지 않는다. 검증은 `node --env-file=.env.local scripts/check-*.mjs` 형태의 `node:assert` 자체 점검 스크립트로 한다.
- 환경변수: `BOARD_PASSWORD`는 **제거**, `SESSION_SECRET`을 **추가**한다.
- 커밋 메시지는 한국어 한 줄, 기존 저장소 스타일(`GPU를 빌리지 않고 OpenAI로 자막·이미지 판독을 부른다`)을 따른다.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `lib/password.mjs` (신규) | 비밀번호 해시·검증. 앱과 시드 스크립트가 같은 함수를 쓴다 |
| `lib/session.mjs` (신규) | 세션 쿠키 서명·검증. Next에 의존하지 않아 미들웨어에서도 쓸 수 있다 |
| `schema-saas.sql` (신규) | `users` · `workspaces` · `runs` + 결과 3개 테이블의 `run_id` 컬럼 |
| `scripts/seed-account.mjs` (신규) | 결제한 고객의 계정을 만든다 |
| `scripts/backfill-run.mjs` (신규) | 지금까지 쌓인 데이터를 "초기" 실행으로 묶는다 |
| `scripts/check-password.mjs` · `check-session.mjs` (신규) | 자체 점검 |
| `lib/workspace.ts` (신규) | 현재 로그인 사용자 · 워크스페이스 · 실행을 읽는다 |
| `lib/runs.ts` (신규) | 실행 한 줄 열고 닫기, 결과에 실행번호 달기 |
| `proxy.ts` (수정) | 비밀번호 대신 세션 서명을 검사한다 |
| `app/login/*` (수정) | 이메일 + 비밀번호 |
| `lib/board-data.ts` · `lib/video/data.ts` (수정) | 조회에 실행 필터 추가 |
| `app/board/page.tsx` (수정) | 상단에 워크스페이스·주차 드롭다운 |
| `app/mypage/*` (신규) | 워크스페이스 관리 · 실행 기록 · 계정 |

---

## 태스크 1 — 비밀번호 해시

**파일:**
- 생성: `lib/password.mjs`
- 생성: `scripts/check-password.mjs`

**인터페이스:**
- 소비: 없음
- 생산: `hashPassword(plain: string) => Promise<string>` — `"scrypt:<N>:<소금hex>:<해시hex>"` 형태의 문자열을 돌려준다.
  `verifyPassword(plain: string, stored: string) => Promise<boolean>`

**형식에 N(계산 강도)을 적어 두는 이유:** N을 안 적으면 나중에 강도를 올리는 순간 기존 고객의 해시를 검증할 수 없어 **전원이 아무 에러 없이 로그인 불가**가 된다. 계정이 0개인 지금은 공짜고, 태스크 2에서 계정을 만든 뒤에는 마이그레이션 작업이 된다.

**강도는 N=65536을 쓴다.** 실측(2026-08-30): 16384→50ms/16MB, 65536→220ms/64MB, 131072→461ms/128MB. Node 기본값 16384는 OWASP 2026 권고 최소(131072)의 8분의 1이고, 131072는 로그인 1건당 128MB라 작은 컨테이너가 죽을 수 있어 중간을 골랐다. 로그인은 60일에 한 번이라 220ms는 사람이 못 느낀다.

`.mjs`인 이유: `scripts/seed-account.mjs`(순수 Node)와 Next 앱(TypeScript)이 **같은 함수**를 써야 한다. `.ts`로 만들면 Node가 직접 못 읽어서 시드 스크립트에 같은 코드를 한 벌 더 쓰게 되고, 두 벌이 어긋나면 "계정은 만들어졌는데 로그인이 안 되는" 상황이 된다. `tsconfig.json`에 `allowJs: true`가 이미 켜져 있다.

- [ ] **1단계: 점검 스크립트를 먼저 쓴다**

`scripts/check-password.mjs`:

```js
// 비밀번호 해시 자체 점검.  node scripts/check-password.mjs
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { hashPassword, verifyPassword } from "../lib/password.mjs";

const stored = await hashPassword("올바른비밀번호");

// 형식에 N이 들어 있어야 한다. 없으면 나중에 강도를 올릴 때 기존 고객이 전부 잠긴다.
assert.match(stored, /^scrypt:65536:[0-9a-f]{32}:[0-9a-f]{128}$/, "저장 형식이 scrypt:N:소금:해시가 아니다");
assert.equal(await verifyPassword("올바른비밀번호", stored), true, "맞는 비밀번호가 거절됐다");
assert.equal(await verifyPassword("틀린비밀번호", stored), false, "틀린 비밀번호가 통과했다");
assert.equal(await verifyPassword("", stored), false, "빈 비밀번호가 통과했다");

// 소금이 매번 달라야 한다. 같으면 같은 비밀번호를 쓰는 두 계정이 DB에서 똑같아 보인다.
assert.notEqual(await hashPassword("같은비밀번호"), await hashPassword("같은비밀번호"), "소금이 고정돼 있다");

// 이 점검이 이 파일의 핵심이다.
// 옛 강도로 만들어진 해시도 저장된 N을 읽어 열려야 한다.
// 깨지면 강도를 올리는 순간 기존 고객이 전원 로그인 불가가 된다.
const oldSalt = randomBytes(16);
const oldKey = scryptSync("올바른비밀번호", oldSalt, 64, { N: 16384, r: 8, p: 1 });
const older = `scrypt:16384:${oldSalt.toString("hex")}:${oldKey.toString("hex")}`;
assert.equal(await verifyPassword("올바른비밀번호", older), true, "옛 강도(N=16384) 해시를 못 연다");
assert.equal(await verifyPassword("틀린비밀번호", older), false, "옛 강도 해시가 틀린 비밀번호를 통과시켰다");

// 형식이 깨진 값에 터지지 않고 false를 줘야 한다.
const tail = stored.split(":").slice(2).join(":");
for (const junk of [
  "", "그냥문자열", "bcrypt:aa:bb", "scrypt:zz:zz",
  `scrypt:${tail}`,                 // N이 빠진 옛 형식
  `scrypt:99999:${tail}`,           // 2의 거듭제곱이 아닌 N
  `scrypt:1024:${tail}`,            // 너무 약한 N
  `scrypt:1073741824:${tail}`,      // 2^30 — 메모리 폭탄
  `scrypt:65536::${stored.split(":")[3]}`,  // 소금이 빈 값
]) {
  assert.equal(await verifyPassword("아무거나", junk), false, `형식 오류를 통과시켰다: ${junk.slice(0, 40)}`);
}

console.log("✔ password 점검 통과");
```

- [ ] **2단계: 실행해서 실패하는지 확인**

실행: `node scripts/check-password.mjs`
예상: `ERR_MODULE_NOT_FOUND` — `lib/password.mjs`가 없다

- [ ] **3단계: 구현**

`lib/password.mjs`:

```js
// 비밀번호 해시. 새 라이브러리(bcrypt·argon2)를 깔지 않고 Node 기본 모듈로 한다.
//
// scrypt는 일부러 느리고 메모리를 많이 쓰도록 설계된 함수다. 비밀번호를 평문으로 저장하면
// DB가 새는 순간 고객 비밀번호가 그대로 털린다. 해시로 저장하면 되돌릴 수 없다.
//
// 저장 형식:  scrypt:<N>:<소금 16바이트 hex>:<해시 64바이트 hex>
//
// N을 형식에 적어 두는 이유 — N은 "얼마나 세게 계산했나"다. 이걸 안 적으면
// 나중에 N을 올리는 순간 기존 고객의 해시를 검증할 수 없어, 전원이 아무 에러 없이
// 로그인에 실패한다. 적어 두면 옛 해시는 옛 N으로 검증되고 새 해시만 새 N을 쓴다.
//
// 소금(salt)을 계정마다 다르게 두는 이유 — 같은 비밀번호를 쓰는 두 계정이
// DB에서 똑같아 보이면, 하나가 뚫릴 때 나머지도 같이 뚫린다.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

// 새로 만드는 해시의 강도. 실측(2026-08-30): 220ms / 64MB.
// Node 기본값은 16384(50ms/16MB)인데 OWASP 2026 권고 최소는 131072(461ms/128MB)다.
// 128MB는 로그인 몇 건이 겹치면 작은 컨테이너가 죽을 수 있어 중간을 골랐다.
// 올리려면 이 숫자만 바꾸면 된다 — 형식에 N이 들어 있어 기존 해시는 그대로 검증된다.
const N = 65536;

// 저장된 값에서 N을 읽어 그대로 쓰므로 범위를 막아야 한다.
// DB에 쓸 수 있는 공격자가 N을 2^30으로 바꿔 두면 로그인 한 번에 서버 메모리가 터진다.
const N_MIN = 16384;    // 2^14 — Node 기본값. 이보다 약한 건 받지 않는다
const N_MAX = 1048576;  // 2^20 — 이보다 크면 정상적인 값이 아니다

// maxmem 기본값이 32MB라 N을 올리면 넘겨줘야 한다. scrypt는 128·N·r 바이트를 쓴다.
const opts = (n) => ({ N: n, r: 8, p: 1, maxmem: 128 * n * 8 * 2 });

/** @param {string} plain @returns {Promise<string>} */
export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const key = /** @type {Buffer} */ (await scryptAsync(plain, salt, 64, opts(N)));
  return `scrypt:${N}:${salt.toString("hex")}:${key.toString("hex")}`;
}

/**
 * @param {string} plain @param {string} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(plain, stored) {
  const [algo, nStr, saltHex, keyHex] = String(stored ?? "").split(":");
  if (algo !== "scrypt" || !nStr || !saltHex || !keyHex) return false;

  // N은 저장된 값에서 읽는다. 2의 거듭제곱이어야 하고 범위 안이어야 한다.
  const n = Number(nStr);
  if (!Number.isInteger(n) || n < N_MIN || n > N_MAX || (n & (n - 1)) !== 0) return false;

  // Buffer.from은 잘못된 hex에서 예외를 던지지 않고 조용히 잘라낸다.
  // 길이로 걸러야 timingSafeEqual이 RangeError를 던지지 않는다.
  const expected = Buffer.from(keyHex, "hex");
  const salt = Buffer.from(saltHex, "hex");
  if (expected.length !== 64 || salt.length !== 16) return false;

  const key = /** @type {Buffer} */ (await scryptAsync(plain, salt, 64, opts(n)));
  // 일반 === 비교는 앞에서부터 다른 글자가 나오면 즉시 멈춘다. 그 미세한 시간 차이로
  // 해시를 한 글자씩 알아낼 수 있다. timingSafeEqual은 항상 끝까지 비교한다.
  return timingSafeEqual(key, expected);
}
```

- [ ] **4단계: 점검 통과 확인**

실행: `node scripts/check-password.mjs`
예상: `✔ password 점검 통과`

- [ ] **5단계: 커밋**

```bash
git add lib/password.mjs scripts/check-password.mjs
git commit -m "비밀번호를 평문 대신 scrypt 해시로 저장한다"
```

---

## 태스크 2 — 스키마와 첫 계정

**파일:**
- 생성: `schema-saas.sql`
- 생성: `scripts/seed-account.mjs`
- 수정: `scripts/apply-schema.mjs:14` (기본 파일 목록)
- 수정: `package.json` (`seed` 스크립트 추가)

**인터페이스:**
- 소비: `lib/password.mjs`의 `hashPassword`
- 생산: 테이블 `users(id, email, password_hash, name, created_at)`,
  `workspaces(id, user_id, name, perspective, created_at)`,
  `runs(id, workspace_id, week, kind, status, stats, error, started_at, finished_at)`.
  `post_analysis.run_id` · `idea_cards.run_id` · `video_keywords.run_id` (전부 `bigint`, null 허용)

- [ ] **1단계: `schema-saas.sql` 작성**

```sql
-- SaaS 운영 스키마 — 계정 · 워크스페이스 · 주간 실행 기록
-- 적용: npm run schema
--
-- schema.sql / schema-video.sql은 "무엇을 수집하고 분석했나"를 담는다.
-- 이 파일은 "누구 것이고 언제 돌린 거냐"만 담는다. 저 둘은 건드리지 않는다.
--
-- 핵심 결정(2026-08-30): 결과 테이블에 workspace_id와 week를 따로 붙이지 않는다.
-- runs 한 줄이 워크스페이스와 주차를 둘 다 들고 있으므로, 결과에는 run_id 하나면 된다.
-- 컬럼이 절반이고, 주차 히스토리와 고객 격리가 동시에 풀린다.
--
-- mentions · entities · entity_mentions · post_comments · demand_signals는
-- 전역 공유로 남긴다. 같은 서브레딧을 고객 수만큼 중복 수집하면 레딧이 429로 막는다(07-SAAS.md 1장).
--
-- 여러 번 실행해도 안전하다.

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,            -- scrypt:N:소금:해시 (lib/password.mjs)
  name          text,
  created_at    timestamptz not null default now()
);

create table if not exists workspaces (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  name        text not null,
  -- 이 워크스페이스가 어떤 관점으로 보는지 한 문장.
  -- 지금은 화면에 보여주기만 한다. 나중에 점수의 30점인 '한국 관련도'를
  -- 이 문장으로 일반화할 자리다(07-SAAS.md 3장).
  perspective text,
  created_at  timestamptz not null default now()
);
create index if not exists workspaces_user_idx on workspaces (user_id, created_at);

-- 주간 실행 1회 = 한 줄. 마이페이지의 '실행 기록'이 그대로 이 표다.
create table if not exists runs (
  id           bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  week         date not null,                      -- 그 주 월요일
  kind         text not null check (kind in ('reddit','video')),
  status       text not null default 'running' check (status in ('running','done','failed')),
  -- 이번 주에 실제로 뭐가 얼마나 나갔나.
  -- jsonb로 두는 이유: 보여줄 항목이 아직 안 정해졌는데 지금 컬럼으로 못 박으면
  -- 항목이 바뀔 때마다 마이그레이션을 해야 한다. 굳으면 그때 컬럼으로 뺀다.
  --   reddit: {"posts":140,"cards":12,"steps":["classify","cards"]}
  --   video:  {"keywords":3,"videos":47,"quotaUnits":300,"quotaPct":3}
  stats        jsonb not null default '{}'::jsonb,
  error        text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  -- 크론은 한 주에 여러 번 깨어난다(lib/pipeline.ts의 상태 머신).
  -- 깨어날 때마다 새 줄을 만들면 기록이 지저분해지므로 주 1줄로 묶는다.
  unique (workspace_id, week, kind)
);
create index if not exists runs_ws_idx on runs (workspace_id, week desc);

-- 결과에 실행번호를 단다. 이 컬럼 하나가 '누구 것'과 '언제 것'을 동시에 해결한다.
-- on delete set null: 실행 기록을 지워도 분석 결과 자체는 남는다.
alter table post_analysis  add column if not exists run_id bigint references runs(id) on delete set null;
alter table idea_cards     add column if not exists run_id bigint references runs(id) on delete set null;
alter table video_keywords add column if not exists run_id bigint references runs(id) on delete set null;

create index if not exists post_analysis_run_idx  on post_analysis (run_id);
create index if not exists idea_cards_run_idx     on idea_cards (run_id);
create index if not exists video_keywords_run_idx on video_keywords (run_id);
```

- [ ] **2단계: `apply-schema.mjs`가 새 파일도 적용하게 한다**

`scripts/apply-schema.mjs:14`를 이렇게 바꾼다:

```js
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["schema.sql", "schema-video.sql", "schema-saas.sql"];
```

- [ ] **3단계: 스키마 적용**

실행: `npm run schema`
예상: `✔ schema.sql` / `✔ schema-video.sql` / `✔ schema-saas.sql` 그리고 테이블 개수가 3개 늘어난다

- [ ] **4단계: 시드 스크립트 작성**

`scripts/seed-account.mjs`:

```js
// 결제한 고객의 계정을 만든다.
//   npm run seed -- me@example.com 비밀번호 "워크스페이스1"
//
// 회원가입 페이지는 일부러 안 만들었다. 고객이 결제하면 이걸 한 번 돌린다.
// 가입 페이지·이메일 인증·비밀번호 재설정은 고객이 열 명쯤 될 때 만들면 된다.
//
// 이미 있는 이메일이면 비밀번호만 바꾼다 — 비밀번호 재설정도 이걸로 한다.
// 워크스페이스는 하나도 없을 때만 만든다. 무조건 만들면 비밀번호를 바꿀 때마다
// 빈 워크스페이스가 하나씩 늘어난다. 추가는 마이페이지에서 한다.
import pg from "pg";
import { hashPassword } from "../lib/password.mjs";

const [email, password, wsName = "워크스페이스1"] = process.argv.slice(2);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL이 없습니다. .env.local을 확인하세요.");
  process.exit(1);
}
if (!email || !password) {
  console.error('사용법: npm run seed -- <이메일> <비밀번호> ["워크스페이스이름"]');
  process.exit(1);
}
if (!email.includes("@")) {
  console.error("이메일 형식이 아닙니다.");
  process.exit(1);
}
if (password.length < 8) {
  console.error("비밀번호는 8자 이상이어야 합니다.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const hash = await hashPassword(password);
const { rows: [user] } = await client.query(
  `insert into users (email, password_hash) values (lower($1), $2)
   on conflict (email) do update set password_hash = excluded.password_hash
   returning id, email, (xmax = 0) as created`,
  [email, hash]
);

const { rows: [ws] } = await client.query(
  `insert into workspaces (user_id, name)
   select $1, $2
    where not exists (select 1 from workspaces where user_id = $1)
   returning id, name`,
  [user.id, wsName]
);

console.log(`✔ 계정 ${user.email} ${user.created ? "(새로 만듦)" : "(비밀번호 변경)"}`);
console.log(ws ? `✔ 워크스페이스 ${ws.name} (${ws.id})` : "· 워크스페이스가 이미 있어 만들지 않았습니다");
await client.end();
```

- [ ] **5단계: `package.json`에 스크립트 추가**

`"schema"` 줄 아래에 넣는다:

```json
"seed": "node --env-file=.env.local scripts/seed-account.mjs",
```

- [ ] **6단계: 계정 하나 만들고 확인**

실행:
```bash
npm run seed -- choibaelife@gmail.com 비밀번호8자이상 "워크스페이스1"
```
예상: `✔ 계정 choibaelife@gmail.com` / `✔ 워크스페이스 워크스페이스1 (…uuid…)`

- [ ] **7단계: 커밋**

```bash
git add schema-saas.sql scripts/seed-account.mjs scripts/apply-schema.mjs package.json
git commit -m "계정·워크스페이스·주간 실행 기록 테이블을 만든다"
```

---

## 태스크 3 — 로그인

**파일:**
- 생성: `lib/session.mjs`
- 생성: `scripts/check-session.mjs`
- 수정: `proxy.ts` (전체 교체)
- 수정: `app/login/actions.ts` (전체 교체)
- 수정: `app/login/LoginForm.tsx` (이메일 칸 추가)
- 수정: `app/login/page.tsx` (`BOARD_PASSWORD` 분기 제거)
- 수정: `app/board/page.tsx:60-64` (로그아웃 버튼의 `BOARD_PASSWORD` 조건 제거)

**인터페이스:**
- 소비: `lib/password.mjs`의 `verifyPassword`, 태스크 2의 `users` 테이블
- 생산: `SESSION_COOKIE = "session"` · `WS_COOKIE = "ws"` (문자열 상수),
  `signSession(userId: string) => Promise<string>`,
  `verifySession(token: string | undefined) => Promise<string | null>` — 유효하면 `user_id`, 아니면 `null`

`lib/session.mjs`가 `next/headers`나 `pg`를 **일절 import하지 않는** 것이 중요하다. 미들웨어(`proxy.ts`)에서 쓰는데, 미들웨어는 DB에 붙지 못하고 `next/headers`도 못 쓴다. 그래서 쿠키에 서명만 넣고 **DB 조회 없이 서명만 검사**한다.

- [ ] **1단계: 점검 스크립트를 먼저 쓴다**

`scripts/check-session.mjs`:

```js
// 세션 서명 자체 점검.  SESSION_SECRET=테스트비밀 node scripts/check-session.mjs
import assert from "node:assert/strict";

process.env.SESSION_SECRET = "테스트용-비밀-문자열";
const { signSession, verifySession } = await import("../lib/session.mjs");

const uid = "11111111-2222-3333-4444-555555555555";
const token = await signSession(uid);

assert.equal(await verifySession(token), uid, "정상 토큰을 거절했다");
assert.equal(await verifySession(undefined), null, "빈 토큰을 통과시켰다");
assert.equal(await verifySession(""), null, "빈 문자열을 통과시켰다");
assert.equal(await verifySession(uid), null, "서명 없는 값을 통과시켰다");

// 서명을 한 글자 바꾸면 반드시 거절돼야 한다. 여기가 뚫리면 아무나 남의 계정이 된다.
const tampered = token.slice(0, -1) + (token.at(-1) === "a" ? "b" : "a");
assert.equal(await verifySession(tampered), null, "위조된 서명을 통과시켰다");

// 사용자 아이디만 바꿔치기하는 시도 — 서명이 안 맞으므로 거절돼야 한다.
const other = "99999999-9999-9999-9999-999999999999" + token.slice(token.lastIndexOf("."));
assert.equal(await verifySession(other), null, "아이디 바꿔치기를 통과시켰다");

// 비밀키가 없으면 아무도 못 들어와야 한다(열려 있으면 안 된다).
// verifySession은 호출할 때마다 환경변수를 다시 읽으므로 모듈을 다시 불러올 필요가 없다.
delete process.env.SESSION_SECRET;
assert.equal(await verifySession(token), null, "SESSION_SECRET 없이 통과시켰다");

console.log("✔ session 점검 통과");
```

- [ ] **2단계: 실행해서 실패하는지 확인**

실행: `node scripts/check-session.mjs`
예상: `ERR_MODULE_NOT_FOUND` — `lib/session.mjs`가 없다

- [ ] **3단계: `lib/session.mjs` 구현**

```js
// 세션 쿠키. 쿠키 값은 "<사용자아이디>.<서명>"이다.
//
// 서명을 붙이는 이유: 쿠키는 브라우저에 있으니 사용자가 마음대로 고칠 수 있다.
// 아이디만 담으면 남의 아이디로 바꿔 쓰면 그만이다. 서버만 아는 SESSION_SECRET으로
// 서명을 만들어 두면, 값을 고치는 순간 서명이 안 맞아서 거절된다.
//
// DB를 조회하지 않는다. 미들웨어(proxy.ts)에서 검사해야 하는데 미들웨어는
// DB에 붙지 못하기 때문이다. 서명만 맞으면 통과시키고, 실제 사용자 정보는
// 페이지 쪽(lib/workspace.ts)에서 읽는다.
//
// next/headers도 pg도 import하지 않는다. 넣는 순간 미들웨어가 터진다.

export const SESSION_COOKIE = "session";
export const WS_COOKIE = "ws";           // 지금 보고 있는 워크스페이스

/** @returns {string | undefined} */
const secret = () => process.env.SESSION_SECRET || undefined;

/** @param {string} value @returns {Promise<string>} */
async function hmac(value) {
  const s = secret();
  if (!s) throw new Error("SESSION_SECRET 미설정 — 세션을 만들 수 없다");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(s),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** @param {string} userId @returns {Promise<string>} */
export async function signSession(userId) {
  return `${userId}.${await hmac(userId)}`;
}

/**
 * 유효하면 사용자 아이디, 아니면 null.
 * @param {string | undefined} token @returns {Promise<string | null>}
 */
export async function verifySession(token) {
  // 비밀키가 없으면 아무도 통과시키지 않는다.
  // lib/cron-auth.ts와 같은 원칙 — 잠금이 조용히 풀리는 쪽보다 다 막히는 쪽이 낫다.
  if (!secret() || !token) return null;

  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const id = token.slice(0, i);
  const sig = token.slice(i + 1);

  const expected = await hmac(id);
  if (sig.length !== expected.length) return null;
  // 앞글자부터 비교하다 멈추면 시간 차이로 서명을 한 글자씩 알아낼 수 있다. 끝까지 본다.
  let diff = 0;
  for (let k = 0; k < sig.length; k++) diff |= sig.charCodeAt(k) ^ expected.charCodeAt(k);
  return diff === 0 ? id : null;
}
```

- [ ] **4단계: 점검 통과 확인**

실행: `node scripts/check-session.mjs`
예상: `✔ session 점검 통과`

- [ ] **5단계: `proxy.ts` 교체**

전체를 이걸로 바꾼다:

```ts
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session.mjs";

// 로그인 검사. 세션 쿠키의 서명만 본다(미들웨어는 DB에 못 붙는다).
//
// 예전에는 BOARD_PASSWORD 하나로 잠갔다. 계정 개념이 없어서
// 누가 들어왔는지 알 수 없었고, 데이터를 사람별로 나눌 수도 없었다.
//
// 크론 라우트는 Bearer 토큰으로 따로 인증한다(lib/cron-auth.ts). 여기서 통과시킨다.
export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/") || pathname.startsWith("/login") || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **6단계: `app/login/actions.ts` 교체**

```ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { pool } from "@/lib/db";
import { verifyPassword } from "@/lib/password.mjs";
import { SESSION_COOKIE, WS_COOKIE, signSession } from "@/lib/session.mjs";

export async function login(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/board");

  const { rows } = await pool.query<{ id: string; password_hash: string }>(
    `select id, password_hash from users where email = $1`,
    [email]
  );
  const user = rows[0];

  // 이메일이 없을 때와 비밀번호가 틀릴 때의 메시지를 같게 둔다.
  // 다르게 하면 "이 이메일은 가입돼 있다"를 알려주는 셈이 된다.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return { error: "이메일 또는 비밀번호가 맞지 않습니다." };
  }

  const c = await cookies();
  c.set(SESSION_COOKIE, await signSession(user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 60, // 60일
  });
  // 계정을 바꿔 로그인했는데 이전 사람의 워크스페이스가 남아 있으면 안 된다.
  c.delete(WS_COOKIE);

  redirect(next.startsWith("/") ? next : "/board");
}

export async function logout() {
  const c = await cookies();
  c.delete(SESSION_COOKIE);
  c.delete(WS_COOKIE);
  redirect("/login");
}
```

- [ ] **7단계: `app/login/LoginForm.tsx`에 이메일 칸 추가**

`<label className="llabel" htmlFor="pw">비밀번호</label>` 바로 위에 넣는다:

```tsx
      <label className="llabel" htmlFor="email">이메일</label>
      <input
        id="email" name="email" type="email" autoFocus required
        className="linput" placeholder="you@example.com"
        autoComplete="username"
      />
```

그리고 비밀번호 input에서 `autoFocus`를 뺀다(이메일로 옮겼다).

- [ ] **8단계: `app/login/page.tsx`에서 `BOARD_PASSWORD` 분기 제거**

`const locked = ...` 줄과 `{locked ? ... : ...}` 삼항을 지우고 `<LoginForm next={next ?? "/board"} />`만 남긴다.

- [ ] **9단계: `app/board/page.tsx`의 로그아웃 조건 제거**

`app/board/page.tsx:60-64`에서 `{process.env.BOARD_PASSWORD && (` 조건을 벗겨내고 `<form action={logout}>` 부분만 항상 보이게 남긴다.

- [ ] **10단계: 환경변수 정리**

`.env.local`에서 `BOARD_PASSWORD` 줄을 지우고 아래를 추가한다(값은 아무 긴 랜덤 문자열, `openssl rand -hex 32`로 만든다):

```
SESSION_SECRET=<64자 랜덤 hex>
```

Railway 환경변수에도 같은 작업을 한다. **환경변수 이름 앞뒤에 공백이 들어가지 않게 주의한다** — 이전에 이걸로 한 번 막혔다.

- [ ] **11단계: 브라우저에서 확인**

실행: `npm run dev` 후 `http://localhost:3000/board`
예상:
1. `/login`으로 튕긴다
2. 태스크 2에서 만든 이메일·비밀번호로 로그인 → `/board`가 열린다
3. 틀린 비밀번호 → "이메일 또는 비밀번호가 맞지 않습니다."
4. 로그아웃 버튼 → `/login`으로 돌아가고, `/board`를 다시 치면 또 튕긴다

- [ ] **12단계: 커밋**

```bash
git add lib/session.mjs scripts/check-session.mjs proxy.ts app/login app/board/page.tsx
git commit -m "비밀번호 한 개 대신 계정으로 로그인한다"
```

---

## 태스크 4 — 워크스페이스·실행 컨텍스트

**파일:**
- 생성: `lib/workspace.ts`

**인터페이스:**
- 소비: `lib/session.mjs`의 `SESSION_COOKIE` · `WS_COOKIE` · `verifySession`, 태스크 2의 테이블
- 생산:
  - `type Workspace = { id: string; name: string; perspective: string | null }`
  - `type Run = { id: string; week: string; kind: string; status: string; stats: any; started_at: string; finished_at: string | null; error: string | null }`
  - `currentUserId() => Promise<string | null>`
  - `myWorkspaces() => Promise<Workspace[]>`
  - `currentWorkspace() => Promise<Workspace | null>`
  - `myRuns(kind?: string) => Promise<Run[]>` — 최근 30개, 최신 주 먼저
  - `currentRun(kind: string, week?: string) => Promise<Run | null>`

**모든 탭이 같은 주를 본다.** 탭마다 범위를 다르게 두면(재고만 누적 같은 식) 필터가 두 종류가 되고, 주차를 바꿨을 때 어떤 탭이 따라오고 어떤 탭이 안 따라오는지 화면에서 알 수 없다. 지난주 재고는 주차를 지난주로 바꿔서 본다.

- [ ] **1단계: 구현**

`lib/workspace.ts`:

```ts
import { cookies } from "next/headers";
import { pool } from "@/lib/db";
import { SESSION_COOKIE, WS_COOKIE, verifySession } from "@/lib/session.mjs";

// 화면이 "지금 누구의, 어느 워크스페이스의, 어느 주 데이터를 보고 있나"를 정하는 곳.
// 조회 함수(lib/board-data.ts)는 여기서 받은 실행번호로 거르기만 한다.

export type Workspace = { id: string; name: string; perspective: string | null };

export type Run = {
  id: string; week: string; kind: string; status: string;
  stats: any; started_at: string; finished_at: string | null; error: string | null;
};

export async function currentUserId(): Promise<string | null> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function myWorkspaces(): Promise<Workspace[]> {
  const uid = await currentUserId();
  if (!uid) return [];
  return (await pool.query<Workspace>(
    `select id, name, perspective from workspaces where user_id = $1 order by created_at`,
    [uid]
  )).rows;
}

/**
 * 지금 보고 있는 워크스페이스.
 * 쿠키에 담긴 것이 내 것이 아니면(남의 링크를 눌렀거나 계정을 바꿨거나) 무시하고 첫 번째를 준다.
 * 쿠키 값을 그대로 믿으면 남의 워크스페이스가 열린다.
 */
export async function currentWorkspace(): Promise<Workspace | null> {
  const list = await myWorkspaces();
  if (!list.length) return null;
  const want = (await cookies()).get(WS_COOKIE)?.value;
  return list.find((w) => w.id === want) ?? list[0];
}

/** 마이페이지의 실행 기록 표. */
export async function myRuns(kind?: string): Promise<Run[]> {
  const ws = await currentWorkspace();
  if (!ws) return [];
  return (await pool.query<Run>(
    `select id::text, week::text, kind, status, stats,
            started_at::text, finished_at::text, error
       from runs
      where workspace_id = $1 and ($2::text is null or kind = $2)
      order by week desc, kind
      limit 30`,
    [ws.id, kind ?? null]
  )).rows;
}

/** 그 주 실행 하나. week를 안 주면 가장 최근 주. */
export async function currentRun(kind: string, week?: string): Promise<Run | null> {
  const ws = await currentWorkspace();
  if (!ws) return null;
  const { rows } = await pool.query<Run>(
    `select id::text, week::text, kind, status, stats,
            started_at::text, finished_at::text, error
       from runs
      where workspace_id = $1 and kind = $2 and ($3::text is null or week = $3::date)
      order by week desc
      limit 1`,
    [ws.id, kind, week ?? null]
  );
  return rows[0] ?? null;
}
```

- [ ] **2단계: 타입 확인**

실행: `npx tsc --noEmit`
예상: 오류 없음

- [ ] **3단계: 커밋**

```bash
git add lib/workspace.ts
git commit -m "화면이 어느 워크스페이스의 어느 주를 보는지 한곳에서 정한다"
```

---

## 태스크 5 — 실행 기록 쌓기

**파일:**
- 생성: `lib/runs.ts`
- 생성: `scripts/backfill-run.mjs`
- 수정: `lib/pipeline.ts` (`tick` 함수)
- 수정: `lib/video/run.ts` (`runVideo` 함수)

**인터페이스:**
- 소비: 태스크 2의 `runs` 테이블과 `run_id` 컬럼
- 생산:
  - `defaultWorkspaceId() => Promise<string>`
  - `openRun(workspaceId: string, kind: "reddit" | "video", week: string) => Promise<string>` — 실행 id(문자열)
  - `closeRun(runId: string, status: "done" | "failed", stats: object, error?: string) => Promise<void>`
  - `tagRun(runId: string, tables: string[]) => Promise<void>`
  - `mondayOf()` 는 기존 `lib/video/keywords.ts`에 이미 있다 — 그걸 쓴다

- [ ] **1단계: `lib/runs.ts` 구현**

```ts
import { pool } from "@/lib/db";

// 주간 실행 한 줄을 열고 닫는다. 마이페이지의 '실행 기록' 표가 이 데이터다.

/**
 * 크론에는 로그인 세션이 없다. 지금은 워크스페이스가 하나뿐이므로 첫 번째를 쓴다.
 *
 * ponytail: 워크스페이스가 둘 이상이 되면 크론이 워크스페이스마다 한 바퀴 돌아야 한다.
 * 그때 이 함수를 지우고 pipeline.tick(workspaceId)로 바꾼다.
 */
export async function defaultWorkspaceId(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from workspaces order by created_at limit 1`
  );
  if (!rows[0]) throw new Error("워크스페이스가 없다 — npm run seed 를 먼저 돌릴 것");
  return rows[0].id;
}

/**
 * 이번 주 실행 줄을 확보한다. 크론은 한 주에 여러 번 깨어나므로
 * 이미 있으면 그 줄을 다시 쓴다(unique (workspace_id, week, kind)).
 */
export async function openRun(
  workspaceId: string,
  kind: "reddit" | "video",
  week: string
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into runs (workspace_id, week, kind, status)
     values ($1, $2::date, $3, 'running')
     on conflict (workspace_id, week, kind)
       do update set status = 'running', error = null
     returning id::text`,
    [workspaceId, week, kind]
  );
  return rows[0].id;
}

/**
 * stats는 덮어쓰지 않고 합친다(`||`). 크론이 여러 번 깨어나며
 * 조금씩 진행하므로, 마지막 호출이 앞선 기록을 지워버리면 안 된다.
 */
export async function closeRun(
  runId: string,
  status: "done" | "failed",
  stats: Record<string, unknown>,
  error?: string
): Promise<void> {
  await pool.query(
    `update runs
        set status = $2,
            stats = stats || $3::jsonb,
            error = $4,
            finished_at = now()
      where id = $1::bigint`,
    [runId, status, JSON.stringify(stats ?? {}), error ?? null]
  );
}

/**
 * 아직 실행번호가 없는 결과에 이번 실행번호를 단다.
 *
 * 분석 함수(classify·cards·rescore…)가 여덟 군데에서 결과를 쓴다. 여덟 군데를 다 고치는 대신
 * 실행이 끝날 때 "번호 없는 것"에 한 번에 붙인다. 분석 코드는 손대지 않아도 된다.
 *
 * ponytail: 워크스페이스가 하나일 때만 맞다. 둘 이상이 동시에 돌면 남의 결과에
 * 번호가 붙는다. 그때는 각 분석 함수가 직접 run_id를 쓰도록 바꾼다.
 *
 * 테이블 이름은 우리 코드 안의 상수만 넘긴다(사용자 입력이 아니다).
 */
const TAGGABLE = ["post_analysis", "idea_cards", "video_keywords"];

export async function tagRun(runId: string, tables: string[]): Promise<void> {
  for (const t of tables) {
    if (!TAGGABLE.includes(t)) throw new Error(`태그할 수 없는 테이블: ${t}`);
    await pool.query(`update ${t} set run_id = $1::bigint where run_id is null`, [runId]);
  }
}
```

- [ ] **2단계: `lib/pipeline.ts`의 `tick`에 실행 기록을 연결**

파일 맨 위 import에 추가:

```ts
import { openRun, closeRun, tagRun, defaultWorkspaceId } from "@/lib/runs";
import { mondayOf } from "@/lib/video/keywords";
```

`tick()` 함수 전체를 이렇게 바꾼다 (기존 while 루프 로직은 그대로 두고 앞뒤만 감싼다):

```ts
/** 시간이 허락하는 동안 다음 단계들을 이어서 실행한다. */
export async function tick(): Promise<TickResult> {
  const startedAt = Date.now();
  const ran: { step: Step; result: any }[] = [];

  // 이번 주 실행 줄을 연다. 크론이 여러 번 깨어나도 같은 줄에 이어 쓴다.
  const runId = await openRun(await defaultWorkspaceId(), "reddit", mondayOf());

  /** 루프를 어떻게 빠져나가든 기록을 남기고 결과에 번호를 단다. */
  const finish = async (r: TickResult): Promise<TickResult> => {
    await tagRun(runId, ["post_analysis", "idea_cards"]);
    const { rows: [n] } = await pool.query<{ posts: number; cards: number }>(
      `select (select count(*)::int from post_analysis where run_id = $1::bigint) as posts,
              (select count(*)::int from idea_cards    where run_id = $1::bigint) as cards`,
      [runId]
    );
    await closeRun(
      runId,
      r.stoppedBecause === "error" || r.stoppedBecause === "stalled" ? "failed" : "done",
      { posts: n.posts, cards: n.cards, steps: r.ran.map((x) => x.step), stoppedBecause: r.stoppedBecause },
      r.error
    );
    return r;
  };

  while (true) {
    const step = await nextStep();
    if (step === "idle") {
      return finish({ ran, stoppedBecause: "idle", elapsedMs: Date.now() - startedAt });
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed + STEP_BUDGET_MS[step] > HARD_LIMIT_MS) {
      return finish({ ran, stoppedBecause: "deadline", elapsedMs: elapsed, nextStep: step });
    }
    try {
      const result = await runStep(step);
      ran.push({ step, result });

      if (progressOf(step, result) === 0) {
        return finish({
          ran, stoppedBecause: "stalled", elapsedMs: Date.now() - startedAt, nextStep: step,
          error: `${step}: 할 일이 있다고 판단했는데 0건을 처리했다. ` +
                 `판단 조건과 처리 대상이 어긋났을 가능성이 높다 — 코드를 확인할 것.`,
        });
      }
    } catch (err) {
      return finish({
        ran, stoppedBecause: "error", elapsedMs: Date.now() - startedAt,
        error: `${step}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
}
```

`deadline`으로 끊긴 것은 실패가 아니라 "다음 크론이 이어받는 정상 상태"라 `done`으로 둔다.

- [ ] **3단계: `lib/video/run.ts`에 실행 기록을 연결**

import에 추가:

```ts
import { openRun, closeRun, tagRun, defaultWorkspaceId } from "@/lib/runs";
```

`const limit = opts.limit ?? 3;` 다음 줄에 추가:

```ts
  const runId = await openRun(await defaultWorkspaceId(), "video", week);
```

`if (!picks.length) return ...` 를 이렇게 바꾼다:

```ts
  if (!picks.length) {
    await closeRun(runId, "done", { keywords: 0 });
    return { week, keywords: 0, note: "이번 주 키워드 없음 (레딧 데이터 부족)" };
  }
```

마지막 `return { week, keywords: ... }` 바로 앞에 추가:

```ts
  // 유튜브 할당량은 돈 주고 못 산다. 이번 주에 얼마 썼는지 기록에 남긴다.
  await tagRun(runId, ["video_keywords"]);
  await closeRun(runId, "done", {
    keywords: picks.length,
    videos: result.reduce((s, r) => s + r.found, 0),
    picked: result.reduce((s, r) => s + r.picked, 0),
    quotaUnits: units,
    quotaPct: Math.round((units / 10000) * 100),
  });
```

- [ ] **4단계: 기존 데이터 이관 스크립트 작성**

`scripts/backfill-run.mjs`:

```js
// 지금까지 쌓인 데이터를 "초기" 실행 하나로 묶는다. 한 번만 돌리면 된다.
//   node --env-file=.env.local scripts/backfill-run.mjs
//
// 안 돌리면 기존 카드·분석이 run_id 없이 남아, 워크스페이스 화면에서 안 보인다.
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL이 없습니다.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows: [ws] } = await client.query(`select id, name from workspaces order by created_at limit 1`);
if (!ws) {
  console.error("워크스페이스가 없습니다. npm run seed 를 먼저 돌리세요.");
  process.exit(1);
}

// 이번 주 월요일
const { rows: [{ monday }] } = await client.query(
  `select date_trunc('week', now())::date as monday`
);

for (const [kind, tables] of [
  ["reddit", ["post_analysis", "idea_cards"]],
  ["video", ["video_keywords"]],
]) {
  const { rows: [run] } = await client.query(
    `insert into runs (workspace_id, week, kind, status, stats, finished_at)
     values ($1, $2::date, $3, 'done', '{"note":"기존 데이터 이관"}'::jsonb, now())
     on conflict (workspace_id, week, kind) do update set status = 'done'
     returning id`,
    [ws.id, monday, kind]
  );
  for (const t of tables) {
    const r = await client.query(`update ${t} set run_id = $1 where run_id is null`, [run.id]);
    console.log(`✔ ${t} ${r.rowCount}건 → 실행 #${run.id} (${kind})`);
  }
}

console.log(`\n워크스페이스: ${ws.name}`);
await client.end();
```

- [ ] **5단계: 이관 실행**

실행: `node --env-file=.env.local scripts/backfill-run.mjs`
예상: `✔ post_analysis N건 → 실행 #1 (reddit)` 같은 줄 3개, N이 0이 아니어야 한다

- [ ] **6단계: 실행 기록이 실제로 남는지 확인**

실행:
```bash
npm run dev
curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/tick?peek=1"
```
그다음 DB에서:
```bash
node --env-file=.env.local -e "import('pg').then(async({default:pg})=>{const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();console.table((await c.query('select id,week,kind,status,stats from runs order by id')).rows);await c.end()})"
```
예상: `runs` 표에 reddit·video 줄이 보이고 `stats`에 숫자가 들어 있다

- [ ] **7단계: 커밋**

```bash
git add lib/runs.ts lib/pipeline.ts lib/video/run.ts scripts/backfill-run.mjs
git commit -m "주간 실행을 한 줄로 기록하고 결과에 실행번호를 단다"
```

---

## 태스크 6 — 조회에 실행 필터

**파일:**
- 수정: `lib/board-data.ts` (7개 함수)
- 수정: `lib/video/data.ts` (`getWeeks`)
- 수정: `app/board/page.tsx` (조회 함수에 인자 전달)

**인터페이스:**
- 소비: 태스크 4의 `currentRun`
- 생산: 아래 시그니처로 바뀐다. **전부 마지막 인자가 `runId` 하나로 같다.**
  - `getCards(runId?: string | null)`
  - `getStock(minWorth?: number, runId?: string | null)`
  - `getStockDropped(minWorth?: number, runId?: string | null)`
  - `getAreas(runId?: string | null)` · `getAreaPosts(area, runId?)` · `getAreaTypes(area, runId?)`
  - `getStats(runId?: string | null)`
  - `getWeeks(workspaceId?: string | null)`

**필터 규칙 — 일곱 군데가 전부 같은 한 줄이다:**

```
and ($N::bigint is null or <표>.run_id = $N::bigint)
```

**인자가 `null`이면 거르지 않는다.** 이관 전이거나 로그인 정보를 못 읽는 상황에서 화면이 텅 비는 것보다 낫다.

> **구현 중 발견(2026-08-30):** 그런데 화면 쪽에서 `null`을 그대로 넘기면 안 된다.
> 실행 기록이 하나도 없는 새 워크스페이스에서 `currentRun()`이 `null`을 주는데,
> 그게 조회로 넘어가면 필터가 통째로 꺼져 **남의 워크스페이스 데이터가 보인다.**
> 그래서 `app/board/page.tsx`는 `run?.id ?? "0"`을 넘긴다 — `bigserial`은 1부터라 0은 아무것과도 안 맞는다.

- [ ] **1단계: `getCards` 수정**

`lib/board-data.ts:29`부터. 시그니처와 마지막 `where`/`order by`만 바꾼다:

```ts
export async function getCards(runId?: string | null): Promise<Card[]> {
  const rows = (await pool.query(
    `select m.id, m.title, m.url, m.raw->>'body' as body,
            m.raw->>'subreddit' as sub, (m.raw->>'rank')::int as rank,
            a.beauty_area as area, a.post_type as type, a.topic, a.summary_ko,
            a.worth, a.worth_parts, a.misconception,
            c.gap, c.angles, c.detail, c.status, c.note, c.chosen_angle
       from idea_cards c
       join mentions m on m.id = c.mention_id
       join post_analysis a on a.mention_id = c.mention_id
      where ($1::bigint is null or c.run_id = $1::bigint)
      order by a.worth desc, m.raw->>'subreddit'`,
    [runId ?? null]
  )).rows;
```

(31~40행의 select·join은 그대로 두고 `where` 한 줄과 파라미터만 추가하는 것이다.)

- [ ] **2단계: 나머지 조회 6개 수정**

```ts
export async function getStock(minWorth = 20, runId?: string | null): Promise<StockRow[]> {
  return (await pool.query(
    `select m.id, m.title, m.url, m.raw->>'subreddit' as sub,
            a.beauty_area as area, a.post_type as type, a.topic, a.summary_ko, a.worth,
            coalesce((select array_agg(distinct coalesce(e.name_ko, e.canonical_name))
                        from entity_mentions em join entities e on e.id = em.entity_id
                       where em.mention_id = m.id), '{}') as keywords
       from post_analysis a
       join mentions m on m.id = a.mention_id
       left join idea_cards c on c.mention_id = m.id
      where c.mention_id is null and a.worth > $1
        and ($2::bigint is null or a.run_id = $2::bigint)
      order by a.worth desc`,
    [minWorth, runId ?? null]
  )).rows as StockRow[];
}

export const getStockDropped = async (minWorth = 20, runId?: string | null) =>
  (await pool.query<{ n: number }>(
    `select count(*)::int as n from post_analysis a
       left join idea_cards c on c.mention_id = a.mention_id
      where c.mention_id is null and a.worth <= $1
        and ($2::bigint is null or a.run_id = $2::bigint)`,
    [minWorth, runId ?? null]
  )).rows[0].n;

export const getAreas = async (runId?: string | null) =>
  (await pool.query<{ area: string; n: number; avg_worth: number; with_cmt: number }>(
    `select a.beauty_area as area, count(*)::int as n, round(avg(a.worth))::int as avg_worth,
            count(*) filter (where exists(select 1 from post_comments c where c.mention_id = a.mention_id))::int as with_cmt
       from post_analysis a
      where ($1::bigint is null or a.run_id = $1::bigint)
      group by 1 order by n desc`,
    [runId ?? null]
  )).rows;

export const getAreaPosts = async (area: string, runId?: string | null) =>
  (await pool.query<{ worth: number; title: string; url: string; topic: string; type: string }>(
    `select a.worth, m.title, m.url, a.topic, a.post_type as type
       from post_analysis a join mentions m on m.id = a.mention_id
      where a.beauty_area = $1
        and ($2::bigint is null or a.run_id = $2::bigint)
      order by a.worth desc limit 14`,
    [area, runId ?? null]
  )).rows;

export const getAreaTypes = async (area: string, runId?: string | null) =>
  (await pool.query<{ type: string; n: number }>(
    `select post_type as type, count(*)::int as n from post_analysis
      where beauty_area = $1
        and ($2::bigint is null or run_id = $2::bigint)
      group by 1 order by n desc`,
    [area, runId ?? null]
  )).rows;

export const getStats = async (runId?: string | null) =>
  (await pool.query<{ posts: number; cards: number; entities: number; comments: number; avg_worth: number }>(
    `select (select count(*)::int from post_analysis
              where ($1::bigint is null or run_id = $1::bigint)) as posts,
            (select count(*)::int from idea_cards
              where ($1::bigint is null or run_id = $1::bigint)) as cards,
            (select count(*)::int from entities) as entities,
            (select count(distinct mention_id)::int from post_comments) as comments,
            (select round(avg(worth))::int from post_analysis
              where ($1::bigint is null or run_id = $1::bigint)) as avg_worth`,
    [runId ?? null]
  )).rows[0];
```

**손대지 않는 함수:** `getKeywords` · `getEntityKinds` · `getTopEntities` · `getDemands` · `getClinicGap` · `getRssFeeds` · `getRssItems`. `entities`와 `mentions`는 전역 공유 자산이라 워크스페이스로 나누지 않기로 했다.

- [ ] **3단계: `lib/video/data.ts`의 `getWeeks` 수정**

```ts
export async function getWeeks(workspaceId?: string | null): Promise<string[]> {
  return (await pool.query<{ w: string }>(
    `select distinct k.week::text as w
       from video_keywords k
       left join runs r on r.id = k.run_id
      where ($1::uuid is null or r.workspace_id = $1::uuid)
      order by w desc limit 12`,
    [workspaceId ?? null]
  )).rows.map((r) => r.w);
}
```

`getKeywordsOf` · `getPicked` · `getSynthesis`는 이미 `week`로 거르고 있고, `getWeeks`가 워크스페이스의 주차만 주므로 추가 수정이 필요 없다.

- [ ] **4단계: `app/board/page.tsx`에서 인자 전달**

import에 추가:

```ts
import { currentRun } from "@/lib/workspace";
```

`const [stats, cards, areas] = await Promise.all([...])` 부분을 바꾼다:

```ts
  // 화면 전체가 이 실행 하나를 본다. week가 없으면 가장 최근 주.
  const run = await currentRun("reddit", sp.week);
  // 실행이 없으면 존재할 수 없는 번호를 넘긴다.
  // null을 넘기면 조회 함수의 `$1 is null or ...` 조건이 참이 되어 필터가 통째로 꺼지고,
  // 실행 기록이 하나도 없는 새 워크스페이스에 남의 워크스페이스 데이터가 보인다.
  // bigserial은 1부터 시작하므로 0은 어떤 행과도 안 맞는다.
  const runId = run?.id ?? "0";

  const [stats, cards, areas] = await Promise.all([
    getStats(runId), getCards(runId), getAreas(runId),
  ]);
```

그리고 탭 컴포넌트 네 곳을 고친다. 이 파일의 탭들은 props 타입이 `any`라 인자만 추가하면 된다.

`app/board/page.tsx:68` (렌더 부분) — `runId`를 넘긴다:

```tsx
      {tab === "main" && <MainTab areas={areas} area={sp.area} href={href} cards={cards} runId={runId} />}
```

`app/board/page.tsx:71`:

```tsx
      {tab === "stock" && <StockTab sub={sp.sub} href={href} runId={runId} />}
```

`app/board/page.tsx:83`:

```tsx
async function MainTab({ areas, area, href, cards, runId }: any) {
```

`app/board/page.tsx:89` — 같은 `Promise.all` 안의 두 호출:

```tsx
    getAreaPosts(selected, runId), getAreaTypes(selected, runId),
```

`app/board/page.tsx:252-253`:

```tsx
async function StockTab({ sub, href, runId }: any) {
  const [stock, dropped] = await Promise.all([getStock(20, runId), getStockDropped(20, runId)]);
```

- [ ] **5단계: 타입·빌드 확인**

실행: `npx tsc --noEmit && npm run build`
예상: 오류 없음

- [ ] **6단계: 화면 확인**

실행: `npm run dev` → `/board`
예상: 태스크 5의 이관을 마친 상태이므로 **탭 7개가 이관 전과 똑같이 보인다.** 숫자가 0이 되거나 카드가 사라지면 이관이 안 된 것이다 — `scripts/backfill-run.mjs`를 다시 돌린다.

- [ ] **7단계: 커밋**

```bash
git add lib/board-data.ts lib/video/data.ts app/board/page.tsx
git commit -m "보드 조회를 워크스페이스와 주차로 거른다"
```

---

## 태스크 7 — 상단 드롭다운 두 개

**파일:**
- 생성: `app/board/switch.ts` (워크스페이스 전환 서버 액션)
- 수정: `app/board/page.tsx` (`navmeta` 영역)
- 수정: `app/board/board.css` (드롭다운 스타일)

**인터페이스:**
- 소비: 태스크 4의 `myWorkspaces` · `currentWorkspace` · `myRuns`
- 생산: `switchWorkspace(formData: FormData) => Promise<void>` — `ws` 쿠키를 바꾸고 `/board`로 되돌린다

- [ ] **1단계: 전환 액션 작성**

`app/board/switch.ts`:

```ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { WS_COOKIE } from "@/lib/session.mjs";
import { myWorkspaces } from "@/lib/workspace";

/**
 * 보고 있는 워크스페이스를 바꾼다.
 * 내 것이 아닌 아이디가 오면 무시한다 — 폼 값은 사용자가 고칠 수 있다.
 */
export async function switchWorkspace(formData: FormData) {
  const id = String(formData.get("ws") ?? "");
  const mine = await myWorkspaces();
  if (!mine.some((w) => w.id === id)) redirect("/board");

  (await cookies()).set(WS_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/board");
}
```

- [ ] **2단계: 보드 상단에 드롭다운 붙이기**

`app/board/page.tsx`의 import에 추가:

```ts
import { myWorkspaces, currentWorkspace, myRuns } from "@/lib/workspace";
import { switchWorkspace } from "./switch";
```

`BoardPage` 안, 기존 `Promise.all` 옆에 추가:

```ts
  const [spaces, here, runs] = await Promise.all([
    myWorkspaces(), currentWorkspace(), myRuns("reddit"),
  ]);
```

`<div className="navmeta">` 블록을 이렇게 바꾼다:

```tsx
        <div className="navmeta">
          <form action={switchWorkspace} className="wspick">
            <select name="ws" defaultValue={here?.id ?? ""}>
              {spaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
            <button type="submit">전환</button>
          </form>

          {/* 주차는 링크 목록으로 고른다.
              select로 하면 onChange를 붙일 클라이언트 컴포넌트가 하나 더 필요하다. */}
          <span className="wklinks">
            {runs.length === 0 && <span className="wk">기록 없음</span>}
            {runs.slice(0, 6).map((r) => (
              <Link
                key={r.id}
                href={href({ week: r.week })}
                className={`wk${(sp.week ?? runs[0]?.week) === r.week ? " on" : ""}`}
                scroll={false}
              >
                {r.week.slice(5).replace("-", "/")}
              </Link>
            ))}
          </span>

          <Link href="/mypage" className="mypagelink">마이페이지</Link>

          레딧 {stats.posts}건 · 키워드 {stats.entities} · 댓글 {stats.comments}개 글 ·
          평균 가치 {stats.avg_worth} · 확정 <b>{saved.length}</b>건

          <form action={logout} style={{ display: "inline" }}>
            <button type="submit" className="logout">로그아웃</button>
          </form>
        </div>
```

최종 형태는 **`wspick` 폼 + `wklinks` 주차 링크 6개 + 마이페이지 링크 + 기존 요약 문구 + 로그아웃**이다.

`href` 함수의 `SP` 타입과 merge 대상에 `week`를 추가한다 (`app/board/page.tsx:32`):

```ts
    const merged = { tab, area: sp.area, sub: sp.sub, week: sp.week, ...next };
```

- [ ] **3단계: 스타일 추가**

`app/board/board.css` 끝에 붙인다:

```css
/* 상단 워크스페이스·주차 선택 */
.wspick { display: inline-flex; gap: 4px; align-items: center; margin-right: 10px; }
.wspick select { font: inherit; padding: 2px 6px; }
.wspick button { font: inherit; padding: 2px 8px; cursor: pointer; }
.wklinks { display: inline-flex; gap: 6px; margin-right: 10px; }
.wk { text-decoration: none; opacity: .55; }
.wk.on { opacity: 1; font-weight: 700; text-decoration: underline; }
.mypagelink { margin-right: 10px; text-decoration: underline; }
```

- [ ] **4단계: 화면 확인**

실행: `npm run dev` → `/board`
예상:
1. 상단에 워크스페이스 이름이 든 드롭다운과 "전환" 버튼이 보인다
2. 주차 링크가 보이고, 누르면 `?week=…`가 붙으면서 "쓸 소재" 탭 내용이 그 주 것으로 바뀐다
3. 재고·한눈에 탭도 주차를 따라 바뀐다 (모든 탭이 같은 주를 본다)

- [ ] **5단계: 커밋**

```bash
git add app/board
git commit -m "보드 상단에서 워크스페이스와 주차를 고른다"
```

---

## 태스크 8 — 마이페이지

**파일:**
- 생성: `app/mypage/page.tsx`
- 생성: `app/mypage/actions.ts`
- 생성: `app/mypage/layout.tsx`

**인터페이스:**
- 소비: 태스크 4의 `currentUserId` · `myWorkspaces` · `currentWorkspace` · `myRuns`
- 생산: `addWorkspace(formData)` · `renameWorkspace(formData)` · `savePerspective(formData)` · `changePassword(prev, formData)`

- [ ] **1단계: 액션 작성**

`app/mypage/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password.mjs";
import { currentUserId } from "@/lib/workspace";

export async function addWorkspace(formData: FormData) {
  const uid = await currentUserId();
  const name = String(formData.get("name") ?? "").trim();
  if (!uid || !name) return;
  await pool.query(`insert into workspaces (user_id, name) values ($1, $2)`, [uid, name]);
  revalidatePath("/mypage");
}

// where에 user_id를 반드시 넣는다. 빠지면 폼 값만 바꿔서 남의 워크스페이스 이름을 고칠 수 있다.
export async function renameWorkspace(formData: FormData) {
  const uid = await currentUserId();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!uid || !id || !name) return;
  await pool.query(`update workspaces set name = $3 where id = $1 and user_id = $2`, [id, uid, name]);
  revalidatePath("/mypage");
}

export async function savePerspective(formData: FormData) {
  const uid = await currentUserId();
  const id = String(formData.get("id") ?? "");
  const text = String(formData.get("perspective") ?? "").trim();
  if (!uid || !id) return;
  await pool.query(
    `update workspaces set perspective = $3 where id = $1 and user_id = $2`,
    [id, uid, text || null]
  );
  revalidatePath("/mypage");
}

export async function changePassword(_prev: unknown, formData: FormData) {
  const uid = await currentUserId();
  const now = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  if (!uid) return { error: "로그인이 필요합니다." };
  if (next.length < 8) return { error: "새 비밀번호는 8자 이상이어야 합니다." };

  const { rows } = await pool.query<{ password_hash: string }>(
    `select password_hash from users where id = $1`, [uid]
  );
  if (!rows[0] || !(await verifyPassword(now, rows[0].password_hash))) {
    return { error: "지금 비밀번호가 맞지 않습니다." };
  }
  await pool.query(`update users set password_hash = $2 where id = $1`, [uid, await hashPassword(next)]);
  return { ok: "비밀번호를 바꿨습니다." };
}
```

- [ ] **2단계: 레이아웃 작성**

`app/mypage/layout.tsx`:

```tsx
import "@/app/board/board.css";

export const metadata = { title: "마이페이지 — 소재 보드" };

export default function MypageLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

- [ ] **3단계: 페이지 작성**

`app/mypage/page.tsx`:

```tsx
import Link from "next/link";
import { pool } from "@/lib/db";
import { logout } from "@/app/login/actions";
import { switchWorkspace } from "@/app/board/switch";
import { currentUserId, myWorkspaces, currentWorkspace, myRuns } from "@/lib/workspace";
import { addWorkspace, renameWorkspace, savePerspective } from "./actions";

export const dynamic = "force-dynamic";

export default async function MyPage() {
  const uid = await currentUserId();
  const [spaces, here, runs] = await Promise.all([
    myWorkspaces(), currentWorkspace(), myRuns(),
  ]);
  const { rows: [me] } = await pool.query<{ email: string; created_at: string }>(
    `select email, created_at::date::text from users where id = $1`, [uid]
  );

  return (
    <div className="bwrap">
      <nav className="bnav">
        <div className="nvs">
          <Link href="/board" className="nv">← 보드로</Link>
          <span className="nv on">마이페이지</span>
        </div>
        <div className="navmeta">
          {me?.email}
          <form action={logout} style={{ display: "inline" }}>
            <button type="submit" className="logout">로그아웃</button>
          </form>
        </div>
      </nav>

      <section className="mysec">
        <h2>내 워크스페이스</h2>
        <table className="mytable">
          <thead><tr><th>이름</th><th>보는 관점</th><th></th></tr></thead>
          <tbody>
            {spaces.map((w) => (
              <tr key={w.id} className={w.id === here?.id ? "on" : ""}>
                <td>
                  <form action={renameWorkspace} className="inlineform">
                    <input type="hidden" name="id" value={w.id} />
                    <input name="name" defaultValue={w.name} />
                    <button type="submit">이름 저장</button>
                  </form>
                </td>
                <td>
                  <form action={savePerspective} className="inlineform">
                    <input type="hidden" name="id" value={w.id} />
                    <input
                      name="perspective"
                      defaultValue={w.perspective ?? ""}
                      placeholder="나는 서울에서 K-뷰티 제품·시술을 다룬다"
                    />
                    <button type="submit">저장</button>
                  </form>
                </td>
                <td>
                  {w.id === here?.id ? (
                    <b>보는 중</b>
                  ) : (
                    <form action={switchWorkspace} className="inlineform">
                      <input type="hidden" name="ws" value={w.id} />
                      <button type="submit">이걸로 보기</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <form action={addWorkspace} className="inlineform">
          <input name="name" placeholder="새 워크스페이스 이름" required />
          <button type="submit">추가</button>
        </form>
        <p className="mynote">
          '보는 관점'은 지금은 메모다. 앞으로 점수 계산에서 '한국 관련도'를 대신할 문장이다.
        </p>
      </section>

      <section className="mysec">
        <h2>실행 기록 — {here?.name}</h2>
        <table className="mytable">
          <thead>
            <tr><th>주</th><th>종류</th><th>상태</th><th>결과</th><th>끝난 시각</th><th></th></tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{r.week}</td>
                <td>{r.kind === "reddit" ? "레딧" : "유튜브"}</td>
                <td className={`st ${r.status}`}>
                  {r.status === "done" ? "완료" : r.status === "failed" ? "실패" : "진행 중"}
                </td>
                <td>
                  {r.kind === "reddit"
                    ? `글 ${r.stats?.posts ?? 0}건 · 카드 ${r.stats?.cards ?? 0}장`
                    : `키워드 ${r.stats?.keywords ?? 0} · 영상 ${r.stats?.videos ?? 0}편 · 할당량 ${r.stats?.quotaPct ?? 0}%`}
                  {r.error && <div className="myerr">{r.error}</div>}
                </td>
                <td>{r.finished_at?.slice(0, 16) ?? "—"}</td>
                <td>
                  <Link href={r.kind === "video" ? `/board?tab=video&week=${r.week}` : `/board?week=${r.week}`}>
                    보기 →
                  </Link>
                </td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr><td colSpan={6}>아직 실행 기록이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="mysec">
        <h2>계정</h2>
        <p>이메일 <b>{me?.email}</b> · 가입 {me?.created_at}</p>
        <p className="mynote">비밀번호 변경은 다음 단계에서 붙인다.</p>
      </section>
    </div>
  );
}
```

`changePassword`는 만들어 두되 이번 화면에는 붙이지 않는다 — 폼 상태가 필요해 클라이언트 컴포넌트가 하나 더 늘어난다. 필요해지면 그때 30줄로 붙는다.

- [ ] **4단계: 스타일 추가**

`app/board/board.css` 끝에 붙인다:

```css
/* 마이페이지 */
.mysec { padding: 18px 20px; border-bottom: 1px solid #e6e6e6; }
.mysec h2 { font-size: 15px; margin: 0 0 10px; }
.mytable { width: 100%; border-collapse: collapse; font-size: 13px; }
.mytable th, .mytable td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
.mytable tr.on { background: #f6f9ff; }
.inlineform { display: inline-flex; gap: 4px; align-items: center; }
.inlineform input { font: inherit; padding: 2px 6px; min-width: 160px; }
.inlineform button { font: inherit; padding: 2px 8px; cursor: pointer; }
.st.done { color: #1a7f37; }
.st.failed { color: #c1121f; }
.st.running { color: #9a6700; }
.myerr { color: #c1121f; font-size: 12px; margin-top: 4px; }
.mynote { font-size: 12px; color: #777; margin-top: 8px; }
```

- [ ] **5단계: 빌드·화면 확인**

실행: `npx tsc --noEmit && npm run build`, 그다음 `npm run dev` → `/mypage`
예상:
1. 워크스페이스 목록에 "워크스페이스1"이 보이고 "보는 중" 표시가 있다
2. "새 워크스페이스 이름"에 "테스트2"를 넣고 추가 → 목록에 뜬다
3. "이걸로 보기" → `/board`로 가고, 상단 드롭다운이 "테스트2"로 바뀌어 있고 **카드가 0장**이다 (테스트2에는 실행 기록이 없으니 맞다)
4. 다시 워크스페이스1로 전환 → 원래 데이터가 돌아온다
5. 실행 기록 표에 태스크 5에서 만든 줄들이 보이고, "보기 →"를 누르면 그 주 보드로 간다

**3번에서 카드가 그대로 보이면 태스크 6의 필터가 안 걸린 것이다.** 그 경우 `getCards`에 `run?.id`가 아니라 `null`이 넘어가고 있는지 확인한다.

- [ ] **6단계: 커밋**

```bash
git add app/mypage app/board/board.css
git commit -m "마이페이지에서 워크스페이스를 관리하고 지난 실행을 본다"
```

---

## 배포 시 할 일

- [ ] Railway 환경변수에 `SESSION_SECRET` 추가 (`openssl rand -hex 32`). **이름 앞뒤 공백 주의.**
- [ ] Railway 환경변수에서 `BOARD_PASSWORD` 삭제
- [ ] 배포 후 `npm run schema`를 운영 DB에 적용
- [ ] 운영 DB에 `npm run seed -- <이메일> <비밀번호>` 로 계정 생성
- [ ] 운영 DB에 `node --env-file=.env.local scripts/backfill-run.mjs` 1회 실행 (`DATABASE_URL`을 운영 것으로)
- [ ] `docs/05-WORKLOG.md`에 한 줄 기록

---

## 이번에 일부러 안 만든 것

| 안 만든 것 | 만들 시점 |
|---|---|
| 회원가입 페이지 · 이메일 인증 | 고객이 10명 넘을 때. 지금은 `npm run seed` |
| 비밀번호 재설정 · 변경 화면 | `changePassword` 액션은 만들어 뒀다. 화면만 붙이면 된다 |
| 결제(Stripe) · 요금제 | 두 번째 유료 고객이 생길 때 |
| 팀 초대 · 멤버 권한 | 에이전시 고객이 요청할 때 |
| Postgres RLS | 앱에서 `run_id`·`user_id` 필터로 충분. 데이터가 샌 적이 생기면 그때 |
| 워크스페이스별 수집 소스 분리 | 두 번째 워크스페이스가 다른 분야를 볼 때. 그때 07-SAAS.md 1장의 `subreddits`/`subscriptions` 구조로 간다 |
| 크론의 워크스페이스별 실행 | 지금은 첫 번째 워크스페이스만 돈다(`defaultWorkspaceId`). 둘 이상이 실제로 데이터를 받아야 할 때 |
| 워크스페이스 삭제 | 지우면 `runs`가 cascade로 지워지고 결과의 `run_id`가 null이 된다. 무해하지만 화면에서 사라지므로 확인 절차가 필요하다 |
