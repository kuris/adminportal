# admin_portal — chatgpts.kr 통합 관리자 대시보드

15개 서비스의 **조회(트래픽) 통계를 한 화면에서** 보는 통합 관리자 포털입니다.
서비스별 `admin.html` 을 돌아다니지 않고, 전체 방향(추이·점유율·증감)을 한 번에 봅니다.

- 도메인: **`admin.chatgpts.kr`**
- 접근: **Google 로그인 + `phiskim@gmail.com` 전용**
- 데이터: `public.page_views` (모든 서비스가 `service` 컬럼으로 기록하는 공통 로그)

---

## 1. 폴더 구성

```
admin_portal/
├── index.html                 통합 대시보드 (루트 `/`)
├── css/
│   ├── admin.css              공통 관리자 스타일 (다른 서비스와 동일 원본 복사)
│   └── portal.css             포털 전용 추가 스타일
├── js/
│   ├── supabase-config.js     동일 Supabase 프로젝트 + 포털 전용 storageKey
│   ├── supabase-admin-client.js
│   ├── services.js            서비스 메타(키/이름/도메인/색/tracked)
│   └── portal.js              전체 집계 + 추이 계산 + 렌더
├── vercel.json
└── README.md
```

---

## 2. 배포 / 도메인

1. 이 폴더를 **별도 git 저장소**(`adminportal`)로 두고 Vercel 프로젝트를 새로 만듭니다.
2. Vercel 프로젝트에 도메인 **`admin.chatgpts.kr`** 를 연결합니다.
3. DNS 에 `admin` CNAME 을 Vercel 로 추가합니다.
4. 빌드 설정은 정적 사이트 그대로 (Framework: Other, Output: 루트). `vercel.json` 이 cleanUrls 를 처리합니다.

---

## 3. 인증 (중요)

### Supabase → Authentication → URL Configuration
**Redirect URLs** 에 아래를 추가하세요. (Site URL 은 그대로 둬도 됩니다)
```
https://admin.chatgpts.kr/**
http://localhost:*/**
```

### Google / Supabase
- Google OAuth 의 승인된 리디렉션 URI 는 **Supabase 콜백 하나만** 그대로 두면 됩니다.
  ```
  https://ybhiznlelnpwaicyoifa.supabase.co/auth/v1/callback
  ```
- 로그인은 **Google 만** 사용합니다. 이메일/비밀번호 폼은 없습니다.

### 접근 제한이 동작하는 방식
- **화면 게이트(클라이언트)**: `portal.js` 의 `ADMIN_EMAIL = 'phiskim@gmail.com'`.
  이 이메일이 아니면 로그인 후에도 데이터를 **한 줄도 요청하지 않고** "권한 없음" 화면을 보여줍니다.
- **실제 경계(서버 RLS)**: 데이터는 `public.cg_is_admin()` (즉 `public.profiles.role = 'admin'`) 정책으로
  관리자만 읽을 수 있습니다. 클라이언트 게이트를 우회해도 REST 로는 데이터가 나오지 않습니다.
- 따라서 `phiskim@gmail.com` 이 `public.profiles.role = 'admin'` 인지 확인하세요.
  ```sql
  select id, email, role from public.profiles where lower(email) = 'phiskim@gmail.com';
  -- role 이 admin 이 아니면:
  update public.profiles set role = 'admin', updated_at = now()
   where lower(email) = 'phiskim@gmail.com';
  ```

---

## 4. 지금 보이는 것 / 안 보이는 것

`public.page_views` 에 `service` 값으로 기록하는 서비스만 통합 집계됩니다.

| 구분 | 서비스 |
|---|---|
| **집계됨 (11)** | bible, book, fortune, history, math, maum, mindtest, money, tools, work, voca |
| **미집계 (4)** | hanja(playhanja) → `hanja.page_views`, gram → `gram.page_views`, science(서버 기록 없음), cbt(서버 기록 없음) |

미집계 서비스는 표에서 **"미집계"** 로 표시됩니다. 전체를 채우려면:
- playhanja / gram : 기록 위치를 `public.page_views`(service=...) 로 이전
- science / cbt : `track.js` 추가
- 또는 Supabase 에 집계 뷰/RPC 를 만들어 사설 스키마를 합치기 (SQL 변경 시)

기본 동작은 **SQL 변경 없이** 최근 120일 로그를 페이지네이션(최대 40,000행)으로 모으고,
전체 누적·기간 합계는 `count` 질의로 정확히 받습니다.

---

## 5. 화면 구성

1. **전체 요약** — 누적 / 오늘(어제 대비) / 최근 7일(전주 대비) / 최근 30일(전월 대비) / 전체 가입자 / 오늘 신규
2. **전체 조회 추이** — 14/30/90일 막대 차트 + 합계·일평균·최고
3. **서비스별 조회 현황** — 오늘 / 7일(전주 대비) / 30일(점유율 바) / 누적 / 최근 방문
4. **서비스 점유율 (최근 30일)** — 순위 + 점유율
5. **시간대 분포** — 전체 24시간
6. **화면 TOP** — 전 서비스 통합 인기 화면
7. **실시간 최근 방문 로그**
8. **시스템 & 데이터 소스** — 집계 범위·미집계 안내·조회창 초과 경고

---

## 6. 로컬 확인

정적 파일이므로 아무 서버로나 열면 됩니다.
```bash
cd admin_portal
python3 -m http.server 5500
# http://localhost:5500
```
`localhost` 는 Supabase Redirect URL 에 추가돼 있어야 Google 로그인이 돌아옵니다.
