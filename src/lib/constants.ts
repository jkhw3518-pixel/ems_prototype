// PRD §2 도메인 상수

export const DAY_MINUTES = 1440;
export const DAY_START_HOUR = 7; // 하루 기준 07:00 ~ 익일 07:00 (KST)

export const NOPROD_STOP_MIN = 1320;
export const LONG_MIN = 60;
export const SHORT_MIN = 15;
export const CHG_MIN = 20;
export const CHG_MAX = 240;
export const ST_GOOD = 0.95;
export const ST_WARN = 0.8;
export const TREND_FLAT_PP = 1.0;
export const ALERT_COOLDOWN_MIN = 60;
export const ALERT_DAILY_CAP = 10;
export const MIN_RUN_FOR_DAY = 10; // 정상가동 10분 이하 → 종일 정지 처리

// 전력 추정 (§6.4): sqrt(3) x V x A x 역률
export const LINE_VOLTAGE = 380;
export const POWER_FACTOR = 0.9;

// 교대 시각 (07:00 / 19:00 주야 2교대) — 경과분 기준
export const SHIFT_CHANGES_MIN = [0, 720];
export const SHIFT_WINDOW_MIN = 30;

export const FACTORIES = ["1공장", "2공장"] as const;

export const EQUIPMENT_SEED: { code: string; factory: string; group: string; order: number }[] = [
  ...Array.from({ length: 18 }, (_, i) => ({ code: `PET-${i + 1}`, factory: "1공장", group: "PET", order: i })),
  ...Array.from({ length: 4 }, (_, i) => ({ code: `PE-${i + 1}`, factory: "1공장", group: "PE", order: 100 + i })),
  { code: "A-1", factory: "1공장", group: "사출기", order: 200 },
  { code: "B-1", factory: "1공장", group: "B-1", order: 210 },
  { code: "B-2", factory: "1공장", group: "B-2", order: 211 },
  ...Array.from({ length: 5 }, (_, i) => ({ code: `P-${i + 1}`, factory: "2공장", group: "사출기", order: 300 + i })),
  { code: "S-1", factory: "2공장", group: "S-1", order: 400 },
  { code: "S-2", factory: "2공장", group: "S-2", order: 401 },
  { code: "S-3", factory: "2공장", group: "S-3,5", order: 402 },
  { code: "S-4", factory: "2공장", group: "S-4", order: 403 },
  { code: "S-5", factory: "2공장", group: "S-3,5", order: 404 },
  { code: "S-6", factory: "2공장", group: "S-6", order: 405 },
  { code: "S-7", factory: "2공장", group: "S-7", order: 406 },
];

export const CRITERIA_SEED: { group: string; stop: number; idle: number; duration: number }[] = [
  { group: "PET", stop: 5, idle: 60, duration: 5 },
  { group: "PE", stop: 5, idle: 50, duration: 3 },
  { group: "사출기", stop: 5, idle: 50, duration: 5 },
  { group: "B-1", stop: 5, idle: 50, duration: 3 },
  { group: "B-2", stop: 5, idle: 29, duration: 3 },
  { group: "S-1", stop: 5, idle: 40, duration: 3 },
  { group: "S-2", stop: 5, idle: 35, duration: 3 },
  { group: "S-3,5", stop: 5, idle: 60, duration: 3 },
  { group: "S-4", stop: 5, idle: 25, duration: 3 },
  { group: "S-6", stop: 5, idle: 50, duration: 3 },
  { group: "S-7", stop: 10, idle: 100, duration: 3 },
];

type CauseSeed = { code: string; name: string };
const CATS: { category: string; categoryName: string; planned: boolean; color: string; causes: CauseSeed[] }[] = [
  {
    category: "BREAKDOWN", categoryName: "고장", planned: false, color: "#E5484D",
    causes: [
      { code: "BRK_MECH", name: "기계 고장" },
      { code: "BRK_ELEC", name: "전기/제어 고장" },
      { code: "BRK_HYD", name: "유압/공압 고장" },
      { code: "BRK_HEAT", name: "히터/온도 이상" },
      { code: "BRK_SHORT", name: "순간 정지(쇼트 스톱)" },
    ],
  },
  {
    category: "MOLD", categoryName: "금형교체", planned: false, color: "#F76B15",
    causes: [
      { code: "MOLD_CHG", name: "금형 교체(품종 변경)" },
      { code: "MOLD_REPAIR", name: "금형 수리/청소" },
      { code: "MOLD_ADJ", name: "금형 조정" },
    ],
  },
  {
    category: "MATERIAL", categoryName: "자재대기", planned: false, color: "#FFC53D",
    causes: [
      { code: "MAT_RESIN", name: "원료(레진) 대기" },
      { code: "MAT_SUB", name: "부자재 대기" },
      { code: "MAT_DRY", name: "원료 건조 대기" },
    ],
  },
  {
    category: "PLANNED", categoryName: "계획정지", planned: true, color: "#8D8D8D",
    causes: [
      { code: "PLN_PM", name: "정기/예방 정비" },
      { code: "PLN_END", name: "생산 종료(배대 종료)" },
      { code: "PLN_NOORDER", name: "작업지시 없음" },
      { code: "PLN_BREAK", name: "휴식/교대" },
      { code: "PLN_PREP", name: "가동 준비/예열" },
    ],
  },
  {
    category: "QUALITY", categoryName: "품질불량", planned: false, color: "#8E4EC6",
    causes: [
      { code: "QLT_ADJ", name: "품질 이상 조정" },
      { code: "QLT_INSPECT", name: "검사 대기/보류" },
      { code: "QLT_REWORK", name: "불량 원인 조치" },
    ],
  },
  {
    category: "CHANGEOVER", categoryName: "품종/지시 교체", planned: false, color: "#0090FF",
    causes: [
      { code: "CHG_ORDER", name: "작업지시 교체" },
      { code: "CHG_COLOR", name: "색상/원료 교체" },
    ],
  },
  {
    category: "UTILITY", categoryName: "공통설비", planned: false, color: "#12A594",
    causes: [
      { code: "UTL_POWER", name: "전력" },
      { code: "UTL_AIR", name: "에어" },
      { code: "UTL_WATER", name: "냉각수" },
    ],
  },
  {
    category: "TEST", categoryName: "테스트/시운전", planned: true, color: "#3E63DD",
    causes: [
      { code: "TST_TRIAL", name: "신규 금형 시사출" },
      { code: "TST_RUN", name: "수리 후 시운전" },
    ],
  },
  {
    category: "ETC", categoryName: "기타", planned: false, color: "#B0B0B0",
    causes: [{ code: "ETC", name: "기타(메모 필수)" }],
  },
];

export const CAUSE_SEED = CATS.flatMap((c, ci) =>
  c.causes.map((x, i) => ({
    code: x.code,
    category: c.category,
    categoryName: c.categoryName,
    name: x.name,
    isPlanned: c.planned,
    color: c.color,
    displayOrder: ci * 100 + i,
  })),
);

export const ALERT_RULE_SEED = [
  { name: "일 가동율 주의", ruleType: "UTIL_BELOW", period: "day", threshold: 0.8, severity: "warning", channels: ["slack"] },
  { name: "일 가동율 위험", ruleType: "UTIL_BELOW", period: "day", threshold: 0.6, severity: "critical", channels: ["slack", "kakao"] },
  { name: "장시간 완전정지", ruleType: "STOP_DURATION", period: null, threshold: 60, severity: "critical", channels: ["slack", "kakao"] },
  { name: "장시간 공회전", ruleType: "IDLE_DURATION", period: null, threshold: 30, severity: "warning", channels: ["slack"] },
  { name: "가동율 급락", ruleType: "UTIL_DROP", period: "day", threshold: 15, severity: "warning", channels: ["email"] },
  { name: "주간 가동율 리포트 기준", ruleType: "UTIL_BELOW", period: "week", threshold: 0.85, severity: "info", channels: ["email"] },
] as const;

export const RULE_TYPE_LABEL: Record<string, string> = {
  UTIL_BELOW: "가동율 미달",
  UTIL_DROP: "가동율 급락",
  STOP_DURATION: "완전정지 지속",
  IDLE_DURATION: "공회전 지속",
};

export const SEVERITY_LABEL: Record<string, string> = { info: "정보", warning: "경고", critical: "위험" };
export const STATE_LABEL: Record<string, string> = { run: "정상가동", idle: "비가동", stop: "완전정지" };
