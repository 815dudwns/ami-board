# ami-board 구현 플랜 v2

> 작성일: 2026-04-18
> 상태: v1(Phase 1~5 완료) → v2 개편. Phase A 구현 완료, B~D 대기
> 저장소: https://github.com/815dudwns/ami-board
> 배포: https://815dudwns.github.io/ami-board/

---

## 1. v2 변경 배경

- 페이지 구조 3개 (온보딩/메인/설정). 온보딩 = 설정 페이지 공용.
- 공사명/작업원은 설정에서 "등록", 메인에서는 "선택"만.
- **"자동 입히기" 버튼 1개로 공통필드(GPS) + 사진 선택 플로우 전체 통합.**
- 사진은 **앨범에서 선택** (카메라 촬영 X, `capture` 속성 금지).
- "기존과 동일" 자동 감지 (공사명+작업원 매치 시 사업소/작업장소 프리필).
- Web Share 제거 → 로컬 저장 + 밴드 앱 열기.

## 2. 페이지 구조

- **설정 페이지 (= 온보딩)** — 첫 방문자(`workers.length === 0`) 자동 진입. 메인에서 "설정" 버튼으로도 진입.
- **메인 페이지** — 공통필드 + 자동 입히기 + 수동 사진 + 합성 + 공유.
- 단일 `index.html` 내 섹션 전환, hash 라우터. DOM id는 Phase 6(Claude Design) 대비 유지.

## 3. 데이터 모델 (localStorage `ami-board-state` v2)

```ts
interface StateV2 {
  version: 2;
  projectNames: string[];            // 등록된 공사명
  workers: string[];                  // 등록된 작업원 (순서 유지, 1→2→3→4번)
  lastSelected: {
    projectName?: string;
    workers?: string[];
    office?: string;                  // 테스트: "마포용산지사" 고정
    workplace?: string;
    workplaceCoord?: { lat: number; lng: number };
  };
  sessionHistory: Array<{             // 최근 30개, FIFO
    projectName: string;
    workers: string[];                // sort 후 저장
    office: string;
    workplace: string;
    workplaceCoord?: { lat: number; lng: number };
    timestamp: string;                // ISO 8601
  }>;
}
```

**v1 → v2 마이그레이션** (Phase A 구현 완료)
- `commonFields.projectName` → `projectNames = [값]` + `lastSelected.projectName`
- `workerHistory` → `workers` (중복 제거, 순서 유지)
- `savedCrews`, `recentSessions` → 삭제
- `version: 2` 세팅

## 4. 설정/온보딩 페이지 (Phase A 구현 완료)

- 모드 구분: `workers.length === 0` 여부
- 공사명 목록/추가/삭제
- 작업원 목록/추가/삭제/순서 변경 (▲▼)
- 온보딩 모드: 공사명 ≥1 + 작업원 ≥1 → "완료" → 메인
- 설정 모드: "메인으로" 버튼 상시
- Enter 키로 추가 (IME 조합 중 제외)

## 5. 메인 페이지

### 5.1 공통필드

| 필드 | 소스 | 수정 | 비고 |
|---|---|---|---|
| 공사명 | `<select>` from `projectNames` | ✅ | 기본값 = `lastSelected.projectName` |
| 사업소 | "마포용산지사" **고정(테스트)** | ❌ | 실운영 시 GPS 주소 기반 자동 매칭 |
| 작업장소 | 입력 칸 + GPS 버튼 + 지도 버튼 + 자동 입히기 | ✅ | |
| 내용 | 시간대 자동 | ✅ | |
| 작업일자 | 오늘 자동 YYYY.MM.DD | ✅ | |
| 작업원 | 체크박스/칩 from `workers` | ✅ | 기본값 = `lastSelected.workers` |

### 5.2 작업장소 입력 방식 (보조)

- **GPS 버튼**: 현재 좌표 → 카카오 역지오코딩 (v1 재사용)
- **지도 모달**: "지도에서 선택" 버튼 → 카카오 지도 오픈 → 롱프레스(≥500ms) 핀 드롭 → 좌표 역지오코딩 → "확인"
- 수동 텍스트 수정 가능
- 이 3경로는 자동 입히기와 병행 (자동 입히기 실패 시 폴백, 수정 시 보조)

### 5.3 "기존과 동일" 자동 감지

- 공사명 또는 작업원 선택 변경 시 훅 재실행
- `sessionHistory`에서 `projectName` 일치 + `workers`(정렬 후) 일치 최신 엔트리
- 매치: 사업소/작업장소/좌표 프리필 + "이전 세션에서 자동입력됨 / 초기화" 배너
- 매치 없음: 공백 유지. 자동 입히기 시 GPS로 채움

### 5.4 "자동 입히기" 통합 플로우 (핵심)

단일 버튼 **"자동 입히기"**. 클릭 시 순차 진행:

**1단계: 공통필드 자동 채우기**
- "기존과 동일" 매치 먼저 확인 (공사명+작업원 조합)
  - 매치: 해당 세션의 사업소/작업장소/좌표 프리필
  - 매치 없음: GPS 획득 → 역지오코딩 → 작업장소 입력 + 사업소 매핑
    - 테스트 단계: 사업소 마포용산 고정
    - 실운영: 주소 "구" 기반 7개 지사 매핑 테이블 (별도 준비)
- GPS 실패 시: "작업장소를 수동 입력하세요" 알림 후 2단계로 진행

**2단계: 작업자 사진**
- 프롬프트: "작업원 사진 고르세요"
- `<input type="file" accept="image/*">` 트리거 → **앨범에서 선택** (`capture` 속성 없음)
- 선택 완료 → 3단계
- 취소 → "작업원 사진이 없나요? Y / N"
  - Y: skip (생성 안 함) → 3단계
  - N: 재시도 (파일 입력 다시 열기)

**3단계: 서류 사진** — 2단계와 동일 흐름

**4단계: 차대비 사진 (작업원별 루프)**
- 현재 메인 폼에 선택된 작업원 순서대로 반복:
  - 프롬프트: "{이름} 차대비 사진 고르세요"
  - 선택 → 다음 작업원
  - 취소 → "{이름} 차대비 사진이 없나요? Y / N"
    - Y: skip → 다음 작업원
    - N: 재시도

**5단계: 합성 미리보기**
- 선택된 모든 사진에 compose() 적용 (좌하단 표)
- 썸네일 렌더 → 사용자 검토
- 문제 있으면 개별 사진 재선택 가능
- 문제 없으면 "저장 + 밴드 열기" 버튼 활성

### 5.5 합성 로직

v1 `compose.js` 재사용. 좌하단 6행 표, Noto Sans KR, EXIF 처리, JPEG 90%.
- 작업원 태그 규칙
  - 작업자/서류: 메인 폼에 선택된 전체 작업원 이름 공백 연결
  - 차대비: 해당 루프의 1명

### 5.6 저장 + 밴드 앱 열기

- "저장 + 밴드 열기" 버튼 클릭 시:
  1. 합성 사진 로컬 다운로드 (`<a download>` 트릭)
     - 파일명: `board_20260418_작업자_1.jpg`, `board_20260418_차대비_우영준.jpg`
  2. 밴드 앱 딥링크 시도
     - iOS: `bandapp://`
     - Android: `intent://...`
     - 폴백(800ms 후): `https://band.us/`
- 사용자가 밴드 앱에서 저장된 사진을 직접 첨부

## 6. 제거 사항 (v1 → v2)

- `savedCrews` 스키마/UI 전부 (Phase A에서 CSS 숨김, Phase B에서 제거)
- `recentSessions` + "오전/어제와 동일" (Phase A 숨김, Phase B 제거)
- `navigator.share()` 호출 경로 (Phase D)
- `capture="environment"` 속성 (Phase C)

## 7. 구현 단계 & 담당

각 Phase 끝에 실배포 가능한 상태 유지 (main 브랜치 연속 커밋).

| Phase | 범위 | 담당 | 상태 |
|---|---|---|---|
| A | 라우터 + 설정/온보딩 + 스키마 v2 마이그레이션 | impl | ✅ 완료 (버그 4건 수정 중) |
| B | 메인 공통필드 개편 (공사명 select, 사업소 고정, 지도 모달, 기존과 동일 감지) | impl | ✅ 완료 |
| C | "자동 입히기" 통합 플로우 + 앨범 선택 기반 사진 업로드 | impl | 대기 |
| D | 저장/다운로드 + 밴드 앱 열기 (Web Share 제거) | impl | 대기 |
| 각 Phase 끝 | code-reviewer 정적 + runner 스모크 | 병렬 | |
| 6 | Claude Design UI 교체 | 영준님 + impl | 대기 |
| 7 | 실기 테스트 + 배포 | runner | 대기 |

## 8. 기기 식별

- localStorage는 기기(브라우저)별 자동 분리 → 별도 UUID 불필요
- 한 폰 = 한 작업자 전제
- 향후 서버 붙일 경우 재고

## 9. 미확정 (추후)

- 사업소 주소 자동 매칭 데이터 (7개 지사 관할 구역 매핑) — 현재 마포용산 고정
- 공사명 연도 자동 롤오버 — 설정에서 수동 관리로 충분
- 밴드 앱 딥링크 파라미터 (사진 첨부 가능 여부) — iOS/Android 실기 확인

## 10. 참고

- v1 리뷰/수정 내역: 옵시디언 `Projects/동산보드판/동산보드판 자동화.md` + git log
- 밴드 Open API 미사용 재확인 완료 (3차 검증)
- 샘플 사진: `~/Downloads/IMG_2569~2572.JPG`, `IMG_6729.PNG`
- 사진 업로드 정책: claude memory `photo_upload_policy.md` (앨범 선택, capture 금지)
