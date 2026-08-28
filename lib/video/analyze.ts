import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool } from "@/lib/db";

const run = promisify(execFile);

// 2단계 — 선별된 숏츠를 실제로 뜯어본다.
//
// 영상 1편당 다운로드는 1번이면 된다(03-VIDEO.md 7장):
//   ① thumbnail_url  → VLM        → thumb_desc     [다운로드 없음]
//   ② yt-dlp 첫 15초 → ffmpeg 오디오 → Whisper → transcript
//                    → ffmpeg 프레임 → VLM     → hook_desc
//
// 엔드포인트는 전부 환경변수로 뺀다. 맥에서는 mlx, 클라우드에서는 vLLM/RunPod —
// OpenAI 호환이라 base_url만 갈아끼우면 된다(02-INFRA 3장).

const VLM_URL = process.env.VLM_URL ?? "http://localhost:8080/v1/chat/completions";
const VLM_MODEL = process.env.VLM_MODEL ?? "mlx-community/Qwen3-VL-4B-Instruct-4bit";
const WHISPER_URL = process.env.WHISPER_URL;           // 없으면 로컬 CLI로 떨어진다
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "mlx-community/whisper-large-v3-turbo";
const YTDLP = process.env.YTDLP_BIN ?? "ml/.venv/bin/yt-dlp";
const WHISPER_BIN = process.env.WHISPER_BIN ?? "ml/.venv/bin/mlx_whisper";

// yt-dlp의 --ffmpeg-location은 절대경로를 요구하고, Next.js 프로세스의 PATH에는
// homebrew 경로가 없을 수 있다. 한 번만 찾아서 재사용한다.
let ffmpegPath: string | null = null;
async function ffmpeg() {
  if (ffmpegPath) return ffmpegPath;
  if (process.env.FFMPEG_BIN) return (ffmpegPath = process.env.FFMPEG_BIN);
  for (const c of ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]) {
    try { await run(c, ["-version"], { timeout: 5000 }); return (ffmpegPath = c); } catch {}
  }
  throw new Error("ffmpeg 없음 — FFMPEG_BIN 환경변수로 경로를 지정할 것");
}

// 첫 15초 중 이 지점들을 본다. 훅은 대개 여기서 결판난다.
const FRAME_TIMES = [0, 3, 7, 12];

export type VideoAnalysis = {
  transcript: string | null;
  thumb_desc: any | null;
  hook_desc: any | null;
  failed: string[];          // 어느 단계가 왜 실패했는지. 조용히 넘기지 않는다.
};

// ── VLM 호출 (OpenAI 호환) ─────────────────────────────────────────
async function callVLM(prompt: string, images: string[], maxTokens = 700) {
  const content: any[] = images.map((b64) => ({
    type: "image_url",
    image_url: { url: `data:image/jpeg;base64,${b64}` },
  }));
  content.push({ type: "text", text: prompt });

  const res = await fetch(VLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: VLM_MODEL,
      messages: [{ role: "user", content }],
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`vlm ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  return d.choices[0].message.content as string;
}

// 모델이 ```json 울타리를 치거나 앞뒤에 말을 붙이는 경우가 있다. 중괄호만 발라낸다.
function parseJson(raw: string): any {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  if (s < 0 || e < 0) throw new Error(`JSON 없음: ${raw.slice(0, 120)}`);
  return JSON.parse(raw.slice(s, e + 1));
}

// ── 썸네일 판독 ────────────────────────────────────────────────────
//
// 폰트 식별은 뺐다(2026-08-28 결정). 실측에서 서로 다른 폰트를 전부
// "Arial · 신뢰도 높음"이라고 답했다 — 4B 모델이 자신 있게 지어낸다(11장 #3).
// 글자 '내용'과 화면에서의 '보이는 방식'(위치·색·외곽선·크기)은 잘 읽으므로 그것만 받는다.
const THUMB_PROMPT = `유튜브 썸네일이다. JSON으로만 답하라. 설명 문장 금지.

{
  "layout": "전체 구도를 한 문장으로",
  "subject": "인물이 있으면 표정과 자세, 없으면 무엇이 중심인지",
  "products": ["화면에 보이는 제품이나 물건"],
  "texts": [
    {
      "content": "글자를 그대로",
      "position": "top | middle | bottom 중 하나",
      "color": "글자색",
      "outline": "외곽선/그림자 (없으면 none)",
      "size": "large | medium | small 중 하나"
    }
  ]
}

글자가 없으면 texts는 빈 배열로 둔다. 확실하지 않은 값은 추측하지 말고 "unknown"으로 쓴다.
폰트 이름은 묻지 않았으니 쓰지 마라.`;

async function analyzeThumbnail(thumbnailUrl: string) {
  const res = await fetch(thumbnailUrl);
  if (!res.ok) throw new Error(`썸네일 ${res.status}`);
  const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  return parseJson(await callVLM(THUMB_PROMPT, [b64]));
}

// ── 다운로드 · 추출 ────────────────────────────────────────────────
async function downloadClip(videoId: string, dir: string) {
  const out = join(dir, "clip.%(ext)s");
  await run(YTDLP, [
    "--download-sections", `*0-15`,     // 첫 15초만. 전송량을 줄여야 차단 위험이 준다
    // --force-keyframes-at-cuts는 쓰지 않는다. 자를 때 재인코딩을 해서 30초가 걸리는데
    // (실측 30.4초 → 2.5초), 우리는 0·3·7·12초 프레임만 뽑으므로 정확한 컷이 필요 없다.
    "-f", "bv*[height<=720]+ba/b[height<=720]/b",
    "--ffmpeg-location", await ffmpeg(),
    "--no-playlist", "--no-warnings", "--quiet",
    "-o", out,
    `https://www.youtube.com/watch?v=${videoId}`,
  ], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });

  const { stdout } = await run("sh", ["-c", `ls ${dir}/clip.*`]);
  return stdout.trim().split("\n")[0];
}

async function extractAudio(clip: string, dir: string) {
  const wav = join(dir, "audio.wav");
  await run(await ffmpeg(), ["-y", "-i", clip, "-vn", "-ac", "1", "-ar", "16000", wav],
    { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
  return wav;
}

async function extractFrames(clip: string, dir: string) {
  const frames: string[] = [];
  for (const t of FRAME_TIMES) {
    const p = join(dir, `f${t}.jpg`);
    try {
      await run(await ffmpeg(), ["-y", "-ss", String(t), "-i", clip, "-frames:v", "1", "-q:v", "3", p],
        { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
      frames.push((await readFile(p)).toString("base64"));
    } catch {
      // 15초보다 짧은 영상이면 뒤쪽 시점이 없다. 있는 것만 쓴다.
    }
  }
  return frames;
}

// ── 자막 ───────────────────────────────────────────────────────────
async function transcribe(wav: string, dir: string) {
  if (WHISPER_URL) {
    // 클라우드: OpenAI 호환 STT 엔드포인트
    const form = new FormData();
    form.append("file", new Blob([await readFile(wav)]), "audio.wav");
    form.append("model", WHISPER_MODEL);
    const res = await fetch(WHISPER_URL, { method: "POST", body: form });
    if (!res.ok) throw new Error(`whisper ${res.status}`);
    return ((await res.json()).text ?? "").trim();
  }
  // 로컬(맥): CLI. 매번 모델을 다시 읽어 20초쯤 손해지만 실험 단계에선 감수한다.
  // ponytail: 로컬 전용 우회. 클라우드에선 위 HTTP 경로를 쓴다.
  await run(WHISPER_BIN, [wav, "--model", WHISPER_MODEL, "--output-dir", dir,
    "--output-format", "txt", "--language", "en"],
    { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 });
  return (await readFile(join(dir, "audio.txt"), "utf8")).trim();
}

// ── 훅(첫 15초) 판독 ───────────────────────────────────────────────
const HOOK_PROMPT = (times: number[], transcript: string) =>
`유튜브 숏츠의 첫 15초에서 ${times.join("초, ")}초 지점을 순서대로 뽑은 장면들이다.
${transcript ? `참고로 이 구간의 말은 다음과 같다: "${transcript.slice(0, 500)}"` : ""}

JSON으로만 답하라. 설명 문장 금지.

{
  "beats": [
    { "t": 초(숫자), "what": "이 시점에 화면에서 무슨 일이 일어나는지 한 문장" }
  ],
  "opening": "greeting | direct 중 하나. 인사말로 시작하면 greeting, 바로 본론이면 direct",
  "subject_on_screen_at": 제품이나 핵심 대상이 처음 등장하는 시점(초 숫자). 없으면 null,
  "closeup_at": 클로즈업이 처음 나오는 시점(초 숫자). 없으면 null
}

각 항목은 반드시 값으로 채운다. 질문을 그대로 되돌려 쓰지 마라.`;

async function analyzeHook(frames: string[], transcript: string) {
  return parseJson(await callVLM(HOOK_PROMPT(FRAME_TIMES.slice(0, frames.length), transcript), frames, 800));
}

// ── 영상 1편 처리 ──────────────────────────────────────────────────
export async function analyzeVideo(v: { id: number; video_id: string; thumbnail_url: string }): Promise<VideoAnalysis> {
  const out: VideoAnalysis = { transcript: null, thumb_desc: null, hook_desc: null, failed: [] };

  // 계층 0 — 다운로드가 필요 없다. 여기가 막히면 유튜브 API 자체가 죽은 것이다.
  try {
    out.thumb_desc = await analyzeThumbnail(v.thumbnail_url);
  } catch (e: any) {
    out.failed.push(`thumb: ${e.message}`);
  }

  // 계층 1·2 — 다운로드가 필요하다. 막혀도 위 결과는 살아남는다(7장 폴백 3계층).
  const dir = await mkdtemp(join(tmpdir(), "vid-"));
  try {
    const clip = await downloadClip(v.video_id, dir);

    try {
      out.transcript = await transcribe(await extractAudio(clip, dir), dir);
    } catch (e: any) {
      out.failed.push(`transcript: ${e.message}`);
    }

    try {
      const frames = await extractFrames(clip, dir);
      if (frames.length) out.hook_desc = await analyzeHook(frames, out.transcript ?? "");
      else out.failed.push("frames: 추출 0장");
    } catch (e: any) {
      out.failed.push(`hook: ${e.message}`);
    }
  } catch (e: any) {
    out.failed.push(`download: ${e.message}`);   // ← 클라우드 IP 차단이면 여기로 온다
  } finally {
    await rm(dir, { recursive: true, force: true });   // 영상 파일은 남기지 않는다
  }

  await pool.query(
    `insert into video_analysis (video_pk, transcript, thumb_desc, hook_desc, analyzed_at)
     values ($1,$2,$3,$4, now())
     on conflict (video_pk) do update set
       transcript = excluded.transcript, thumb_desc = excluded.thumb_desc,
       hook_desc = excluded.hook_desc, analyzed_at = excluded.analyzed_at`,
    // jsonb 컬럼에는 객체를 그대로 넘긴다. JSON.stringify를 거치면 문자열이 통째로
    // 한 겹 더 감싸져 저장돼(`"{\"layout\":...}"`) 화면에서 못 읽는다.
    [v.id, out.transcript, out.thumb_desc, out.hook_desc]
  );
  return out;
}
