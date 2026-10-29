// 멱등(idempotent) 마이그레이션. v1 스키마가 이미 있는 DB에도 그대로 실행 가능하다.
// 실행: pnpm db:migrate  (DATABASE_URL 미설정 시 로컬 PGlite 에 적용)

export const MIGRATION_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS ems_equipment (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  factory VARCHAR(10) NOT NULL,
  "group" VARCHAR(20) NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ems_criteria (
  id SERIAL PRIMARY KEY,
  "group" VARCHAR(20) UNIQUE NOT NULL,
  stop_threshold NUMERIC(6,2) NOT NULL,
  idle_threshold NUMERIC(6,2) NOT NULL,
  duration_min INT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ems_reading (
  id BIGSERIAL PRIMARY KEY,
  equipment_id INT NOT NULL REFERENCES ems_equipment(id),
  recorded_at TIMESTAMPTZ NOT NULL,
  current_value NUMERIC(8,3) NOT NULL,
  UNIQUE (equipment_id, recorded_at)
);
CREATE INDEX IF NOT EXISTS idx_ems_reading_time ON ems_reading (recorded_at, equipment_id);

CREATE TABLE IF NOT EXISTS ems_mold_production (
  id BIGSERIAL PRIMARY KEY,
  equipment_id INT NOT NULL REFERENCES ems_equipment(id),
  production_date DATE NOT NULL,
  dept_code VARCHAR(10),
  order_no VARCHAR(50),
  item_name VARCHAR(200),
  input_qty INT NOT NULL DEFAULT 0,
  good_qty INT NOT NULL DEFAULT 0,
  capa_12hr NUMERIC(10,2) DEFAULT 0,
  UNIQUE (equipment_id, production_date, order_no)
);

CREATE TABLE IF NOT EXISTS ems_analysis_result (
  id BIGSERIAL PRIMARY KEY,
  analysis_date DATE NOT NULL,
  factory VARCHAR(10),
  equipment_id INT REFERENCES ems_equipment(id),
  status VARCHAR(10) NOT NULL,
  minutes INT NOT NULL,
  run_minutes INT NOT NULL DEFAULT 0,
  idle_minutes INT NOT NULL DEFAULT 0,
  stop_minutes INT NOT NULL DEFAULT 0,
  utilization_rate NUMERIC(5,4),
  lost_units NUMERIC(10,1),
  result_json JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (analysis_date, equipment_id)
);
ALTER TABLE ems_analysis_result ADD COLUMN IF NOT EXISTS planned_stop_minutes INT NOT NULL DEFAULT 0;
ALTER TABLE ems_analysis_result ADD COLUMN IF NOT EXISTS excluded BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_analysis_equip_date ON ems_analysis_result (equipment_id, analysis_date);

-- (v2) 비가동 원인 마스터
CREATE TABLE IF NOT EXISTS ems_downtime_cause (
  code VARCHAR(20) PRIMARY KEY,
  category VARCHAR(20) NOT NULL,
  category_name VARCHAR(30) NOT NULL,
  name VARCHAR(50) NOT NULL,
  is_planned BOOLEAN NOT NULL DEFAULT false,
  color VARCHAR(7) NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS ems_downtime_event (
  id BIGSERIAL PRIMARY KEY,
  analysis_date DATE NOT NULL,
  equipment_id INT NOT NULL REFERENCES ems_equipment(id),
  state VARCHAR(10) NOT NULL,
  start_minute INT NOT NULL,
  end_minute INT NOT NULL,
  duration INT NOT NULL,
  avg_current NUMERIC(8,3),
  min_current NUMERIC(8,3),
  max_current NUMERIC(8,3),
  lost_units NUMERIC(10,1),
  tags JSONB,
  cause VARCHAR(50),
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE ems_downtime_event ADD COLUMN IF NOT EXISTS cause_code VARCHAR(20) REFERENCES ems_downtime_cause(code);
ALTER TABLE ems_downtime_event ADD COLUMN IF NOT EXISTS cause_source VARCHAR(10);
ALTER TABLE ems_downtime_event ADD COLUMN IF NOT EXISTS suggested_cause_code VARCHAR(20);
ALTER TABLE ems_downtime_event ADD COLUMN IF NOT EXISTS classified_by VARCHAR(50);
ALTER TABLE ems_downtime_event ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_event_cause ON ems_downtime_event (cause_code, analysis_date);
CREATE INDEX IF NOT EXISTS idx_event_date_equip ON ems_downtime_event (analysis_date, equipment_id);

-- (v2) 알림
CREATE TABLE IF NOT EXISTS ems_alert_rule (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  rule_type VARCHAR(30) NOT NULL,
  scope_type VARCHAR(10) NOT NULL,
  scope_value VARCHAR(50),
  threshold NUMERIC(8,3) NOT NULL,
  period VARCHAR(10),
  severity VARCHAR(10) NOT NULL DEFAULT 'warning',
  cooldown_min INT NOT NULL DEFAULT 60,
  quiet_start TIME,
  quiet_end TIME,
  exclude_planned BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ems_alert_channel (
  id SERIAL PRIMARY KEY,
  channel_type VARCHAR(10) NOT NULL,
  name VARCHAR(50) NOT NULL,
  target VARCHAR(255) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- 암호화된 webhook URL 은 255자를 넘을 수 있다
ALTER TABLE ems_alert_channel ALTER COLUMN target TYPE TEXT;

CREATE TABLE IF NOT EXISTS ems_alert_rule_channel (
  rule_id INT NOT NULL REFERENCES ems_alert_rule(id) ON DELETE CASCADE,
  channel_id INT NOT NULL REFERENCES ems_alert_channel(id) ON DELETE CASCADE,
  PRIMARY KEY (rule_id, channel_id)
);

CREATE TABLE IF NOT EXISTS ems_alert_log (
  id BIGSERIAL PRIMARY KEY,
  rule_id INT NOT NULL REFERENCES ems_alert_rule(id) ON DELETE CASCADE,
  equipment_id INT REFERENCES ems_equipment(id),
  event_id BIGINT REFERENCES ems_downtime_event(id) ON DELETE SET NULL,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  observed_value NUMERIC(8,3),
  message TEXT NOT NULL,
  dedup_key VARCHAR(100) NOT NULL,
  delivery JSONB,
  acknowledged_by VARCHAR(50),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_alert_log_dedup ON ems_alert_log (dedup_key, triggered_at DESC);

-- (v2) 알림 규칙/채널 변경 이력 (§11.6)
CREATE TABLE IF NOT EXISTS ems_alert_audit (
  id BIGSERIAL PRIMARY KEY,
  entity VARCHAR(10) NOT NULL,          -- 'rule' | 'channel'
  entity_id INT NOT NULL,
  action VARCHAR(10) NOT NULL,          -- 'create' | 'update' | 'delete'
  changed_by VARCHAR(50),
  before_value JSONB,
  after_value JSONB,
  changed_at TIMESTAMPTZ DEFAULT now()
);

-- 업로드 이력 (§5.3)
CREATE TABLE IF NOT EXISTS ems_upload_log (
  id BIGSERIAL PRIMARY KEY,
  kind VARCHAR(10) NOT NULL,            -- 'ems' | 'mold'
  file_name VARCHAR(255) NOT NULL,
  row_count INT NOT NULL DEFAULT 0,
  dates JSONB,
  message TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT now()
);

-- (v2, 선택) 추세용 일 집계
CREATE TABLE IF NOT EXISTS ems_utilization_daily (
  analysis_date DATE NOT NULL,
  equipment_id INT NOT NULL REFERENCES ems_equipment(id),
  target_minutes INT NOT NULL,
  run_minutes INT NOT NULL,
  idle_minutes INT NOT NULL,
  stop_minutes INT NOT NULL,
  planned_stop_minutes INT NOT NULL,
  PRIMARY KEY (analysis_date, equipment_id)
);
`;

// v1 cause 문자열 → v2 cause_code (§7.2)
export const V1_CAUSE_MIGRATION_SQL = /* sql */ `
UPDATE ems_downtime_event SET cause_code = CASE cause
  WHEN '품종/지시 교체' THEN 'CHG_ORDER'
  WHEN '금형 교체' THEN 'MOLD_CHG'
  WHEN '설비 고장/수리' THEN 'BRK_MECH'
  WHEN '정기/예방 정비' THEN 'PLN_PM'
  WHEN '원료/부자재 대기' THEN 'MAT_RESIN'
  WHEN '생산 종료 (배대 종료)' THEN 'PLN_END'
  WHEN '공통설비 (전력/에어/냉각수)' THEN 'UTL_POWER'
  WHEN '테스트/시운전' THEN 'TST_RUN'
  WHEN '기타' THEN 'ETC'
END,
cause_source = 'manual',
classified_at = COALESCE(classified_at, now())
WHERE cause IS NOT NULL AND cause_code IS NULL;
`;
