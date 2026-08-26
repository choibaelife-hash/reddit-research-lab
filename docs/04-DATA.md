# 실제 데이터 현황

작성 2026-08-26 · **DB 스냅샷에서 자동 생성**

---

## 1. 파이프라인이 실제로 어디까지 갔나

```
① 분류된 레딧 글            100건
② 댓글 수집을 시도한 것      78건   ← 점수 높은 순
③ 실제로 댓글이 있던 것      72건   ← 6건은 댓글 자체가 0개
④ 실체 추출을 시도한 것      72건
⑤ 댓글에서 이름이 나온 것    65건   ← 나머지 7건은 잡담이라 빈손
```

총 댓글 **335개**, 실체 **275개**, 카드 **12장**, 수요 프로필 **9건**.

> ③④⑤의 차이가 중요하다. **"결과가 0건"과 "아직 안 함"을 구분**하지 않으면 무한 루프가 난다.
> `comments_checked_at` · `entities_checked_at`이 그 구분을 담당한다.

---

## 2. 소재 가치 점수

**기본 100 + 가산 최대 30, 상한 100.** LLM은 `한국 관련`만 판단하고 나머지는 코드가 계산한다.

| 항목 | 배점 | 평균 | 성격 |
|---|---:|---:|---|
| 레딧 순위 | 40 | 24.6 | 기본 |
| 질문 밀도 | 30 | 22.2 | 기본 |
| 한국 관련 | 20 | 11.8 | 기본 |
| 댓글 정보성 | 12 | 5.4 | 가산 |
| 키워드 확산 | 12 | 2.3 | 가산 |
| 매거진 | 6 | 1.6 | 가산 |
| **총점** | **100** | **67.7** | |

| 구간 | 건수 |
|---|---:|
| 80+ | 24 |
| 60-79 | 42 |
| 40-59 | 31 |
| 20-39 | 3 |

> 1차 설계에선 평균 43점·80점 이상 1건이었다. 가산 항목이 대부분 0이라 45건이 65점 만점 경기를 하고 있었다.
> 기본/가산 분리 후 정상화됐고, 댓글이 더 모이면서 다시 올랐다.

---

## 3. 분류 결과

### 뷰티 영역

| 영역 | 건수 | 평균 가치 |
|---|---:|---:|
| 스킨케어루틴 | 25 | 74 |
| 트러블여드름 | 16 | 65 |
| 시술클리닉 | 15 | 67 |
| 선케어 | 10 | 64 |
| 바디헤어 | 10 | 63 |
| 메이크업 | 10 | 69 |
| 안티에이징 | 8 | 66 |
| 성분안전성 | 4 | 67 |
| 기기디바이스 | 2 | 61 |

### 글 유형

| 유형 | 건수 | 평균 가치 |
|---|---:|---:|
| 추천요청 | 41 | 74 |
| 경험공유 | 19 | 61 |
| 후기리뷰 | 19 | 69 |
| 경고이슈 | 7 | 56 |
| 정보설명 | 7 | 70 |
| 진단도움 | 4 | 48 |
| 비교질문 | 2 | 75 |
| 잡담 | 1 | 55 |

---

## 4. 이번 주 카드

| 서브레딧 | 가치 | 제목 |
|---|---:|---|
| r/KoreanBeauty | 100 | USA regulations RUINED my favorite SPF. |
| r/KoreanBeauty | 100 | Product recommendation mid 40s |
| r/KoreanBeauty | 100 | Spa facials and skin care clinics in Seoul |
| r/AsianBeauty | 91 | 25M Silent lurker.. just wanted to say thank |
| r/AsianBeauty | 89 | 40yo routine overhaul |
| r/AsianBeauty | 86 | Cushion foundations for satin, “filtered” ba |
| r/SkincareAddiction | 85 | [Before&After] [Selfie] Before & After |
| r/30PlusSkinCare | 84 | Before & After |
| r/SkincareAddiction | 80 | [anti-aging] Treatments that are actually wo |
| r/SkincareAddiction | 78 | [Acne] Any advice on how to clear this up? |
| r/30PlusSkinCare | 74 | So, I’m growing a beard… |
| r/30PlusSkinCare | 67 | Help! What treatments can I get for my lower |

---

## 5. 누적 실체

| 종류 | 개수 |
|---|---:|
| brand | 130 |
| product | 80 |
| treatment | 31 |
| channel | 12 |
| ingredient | 12 |
| place | 7 |
| clinic | 3 |

### 언급 맥락

| 출처 | 역할 | 건수 |
|---|---|---:|
| post | used | 102 |
| comment | used | 83 |
| comment | recommended | 48 |
| post | asked_about | 39 |
| comment | asked_about | 17 |
| comment | reviewed | 17 |
| comment | warned_against | 15 |
| post | reviewed | 7 |
| post | warned_against | 4 |
| post | recommended | 3 |

> `channel`(구매처)과 `clinic`(병원)은 **댓글에서만** 나온다.

### 최다 언급

| 종류 | 이름 | 영문 | 언급 |
|---|---|---|---:|
| treatment | 보톡스 | Botox | 6 |
| brand | 스킨1004 | Skin1004 | 6 |
| ingredient | 트레티노인 | Tretinoin | 5 |
| brand | 디 오디너리 | The Ordinary | 4 |
| brand | 뷰티 오브 조선 | Beauty of Joseon | 4 |
| brand | 뉴트로지나 | Neutrogena | 4 |
| brand | 주디돌 | Judydoll | 4 |
| treatment | 립필러 | lip filler | 3 |
| brand | 닥터자르트 | Dr. Jart+ | 3 |
| brand | 미샤 | Missha | 3 |
| brand | 세라비 | CeraVe | 3 |
| treatment | 울쎄라 | Ultherapy | 3 |

---

## 6. 병원·장소

| 종류 | 이름 | 원문 |
|---|---|---|
| clinic | Seoul Sy | Seoul Sy |
| clinic | 브랜드 뉴 클리닉 | Brand New Clinic |
| clinic | 서울에스와이피부과의원 | 서울에스와이피부과의원 |
| place | H Mart | H Mart |
| place | medspa | medspa |
| place | 강남 | Gangnam |
| place | 다이소 | Daiso |
| place | 서울 | Seoul |
| place | 코스트코 | Costco |
| place | 코스트코 미국점 | Costco US |

> ⚠️ `Seoul Sy`와 `서울에스와이피부과의원`이 별도 행이다. `aliases` 정규화 미구현.

---

## 7. 테이블 건수

| 테이블 | 행 수 |
|---|---:|
| `mentions` | 472 |
| `post_analysis` | 100 |
| `post_comments` | 335 |
| `idea_cards` | 12 |
| `entities` | 275 |
| `entity_mentions` | 335 |
| `demand_signals` | 9 |
| `collection_rules` | 18 |
| `title_excludes` | 11 |

### 레거시 · 타 프로젝트

| 테이블 | 행 수 | 비고 |
|---|---:|---|
| `keywords` | 467 | ⚠️ 제목이 그대로 — 정리 대상 |
| `instagram_mentions` | 123 | 코드 삭제, 테이블만 보존 |
| `clients` | 6 | 🔒 다른 프로젝트 |
| `surveys` | 3 | 🔒 다른 프로젝트 |
| `tasks` | 5 | 🔒 다른 프로젝트 |

---

## 8. 데이터 공백

| 항목 | 현재 | 문제 |
|---|---|---|
| 댓글 확보 | 72/100 글 | 병원·구매처가 댓글에만 있다 |
| 병원 | 3개 | 댓글을 2배 늘려도 1→3건 |
| RSS 분류 | 0/333 | 매거진은 키워드 매칭(가산 6점)에만 쓰임 |
| 주간 비교 | 불가 | 1주치라 확산 점수가 거의 안 움직임 |
