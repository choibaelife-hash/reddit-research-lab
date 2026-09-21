"""Whisper를 상주시켜 모델 재로딩을 없앤다.

CLI(mlx_whisper)는 호출할 때마다 모델을 다시 읽어 편당 약 40초를 버린다.
mlx_vlm.server가 VLM에 대해 해준 것(58초 → 6초)을 자막에도 똑같이 적용한다.

OpenAI 호환 엔드포인트를 낸다:
    POST /v1/audio/transcriptions   (multipart: file, model)
    → {"text": "..."}

lib/video/analyze.ts가 WHISPER_URL 환경변수로 이 주소를 받으면 CLI 대신 여기를 쓴다.
클라우드(RunPod)에서도 같은 형식이라 주소만 바꾸면 된다.

실행:
    ml/.venv/bin/python ml/whisper_server.py            # 기본 포트 8081
    PORT=9000 ml/.venv/bin/python ml/whisper_server.py
"""

import os
import tempfile

import mlx_whisper
import uvicorn
from fastapi import FastAPI, File, Form, UploadFile

MODEL = os.environ.get("WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo")
app = FastAPI()


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": MODEL, "object": "model"}]}


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model: str = Form(MODEL),
    language: str = Form("en"),
):
    # mlx_whisper는 파일 경로를 받는다. 업로드분을 임시 파일로 떨어뜨린다.
    suffix = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        path = tmp.name
    try:
        # 모델은 mlx_whisper 내부에서 캐시된다. 프로세스가 살아 있으면 재로딩이 없다.
        r = mlx_whisper.transcribe(path, path_or_hf_repo=model, language=language)
        return {"text": (r.get("text") or "").strip()}
    finally:
        os.unlink(path)


if __name__ == "__main__":
    # 시작 시 한 번 태워 첫 요청이 로딩을 떠안지 않게 한다.
    import numpy as np

    print(f"모델 로딩 중: {MODEL}")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as t:
        warm = t.name
    import wave

    with wave.open(warm, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes((np.zeros(16000, dtype=np.int16)).tobytes())
    mlx_whisper.transcribe(warm, path_or_hf_repo=MODEL, language="en")
    os.unlink(warm)
    print("준비 완료")

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8081)), log_level="warning")
