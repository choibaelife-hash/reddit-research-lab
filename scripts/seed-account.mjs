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
