import {
  bigserial, bigint, boolean, date, integer, jsonb, numeric, pgTable, primaryKey, serial, text, time, timestamp, varchar,
} from "drizzle-orm/pg-core";

export type Tag = { k: string; t: string; h?: string };

export const equipment = pgTable("ems_equipment", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  factory: varchar("factory", { length: 10 }).notNull(),
  group: varchar("group", { length: 20 }).notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const criteria = pgTable("ems_criteria", {
  id: serial("id").primaryKey(),
  group: varchar("group", { length: 20 }).notNull().unique(),
  stopThreshold: numeric("stop_threshold", { precision: 6, scale: 2, mode: "number" }).notNull(),
  idleThreshold: numeric("idle_threshold", { precision: 6, scale: 2, mode: "number" }).notNull(),
  durationMin: integer("duration_min").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const reading = pgTable("ems_reading", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  equipmentId: integer("equipment_id").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  currentValue: numeric("current_value", { precision: 8, scale: 3, mode: "number" }).notNull(),
});

export const moldProduction = pgTable("ems_mold_production", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  equipmentId: integer("equipment_id").notNull(),
  productionDate: date("production_date").notNull(),
  deptCode: varchar("dept_code", { length: 10 }),
  orderNo: varchar("order_no", { length: 50 }),
  itemName: varchar("item_name", { length: 200 }),
  inputQty: integer("input_qty").notNull().default(0),
  goodQty: integer("good_qty").notNull().default(0),
  capa12hr: numeric("capa_12hr", { precision: 10, scale: 2, mode: "number" }).default(0),
});

export const analysisResult = pgTable("ems_analysis_result", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  analysisDate: date("analysis_date").notNull(),
  factory: varchar("factory", { length: 10 }),
  equipmentId: integer("equipment_id"),
  status: varchar("status", { length: 10 }).notNull(),
  minutes: integer("minutes").notNull(),
  runMinutes: integer("run_minutes").notNull().default(0),
  idleMinutes: integer("idle_minutes").notNull().default(0),
  stopMinutes: integer("stop_minutes").notNull().default(0),
  plannedStopMinutes: integer("planned_stop_minutes").notNull().default(0),
  excluded: boolean("excluded").notNull().default(false),
  utilizationRate: numeric("utilization_rate", { precision: 5, scale: 4, mode: "number" }),
  lostUnits: numeric("lost_units", { precision: 10, scale: 1, mode: "number" }),
  resultJson: jsonb("result_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const downtimeCause = pgTable("ems_downtime_cause", {
  code: varchar("code", { length: 20 }).primaryKey(),
  category: varchar("category", { length: 20 }).notNull(),
  categoryName: varchar("category_name", { length: 30 }).notNull(),
  name: varchar("name", { length: 50 }).notNull(),
  isPlanned: boolean("is_planned").notNull().default(false),
  color: varchar("color", { length: 7 }).notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const downtimeEvent = pgTable("ems_downtime_event", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  analysisDate: date("analysis_date").notNull(),
  equipmentId: integer("equipment_id").notNull(),
  state: varchar("state", { length: 10 }).notNull(),
  startMinute: integer("start_minute").notNull(),
  endMinute: integer("end_minute").notNull(),
  duration: integer("duration").notNull(),
  avgCurrent: numeric("avg_current", { precision: 8, scale: 3, mode: "number" }),
  minCurrent: numeric("min_current", { precision: 8, scale: 3, mode: "number" }),
  maxCurrent: numeric("max_current", { precision: 8, scale: 3, mode: "number" }),
  lostUnits: numeric("lost_units", { precision: 10, scale: 1, mode: "number" }),
  tags: jsonb("tags").$type<Tag[]>(),
  cause: varchar("cause", { length: 50 }),
  causeCode: varchar("cause_code", { length: 20 }),
  causeSource: varchar("cause_source", { length: 10 }),
  suggestedCauseCode: varchar("suggested_cause_code", { length: 20 }),
  classifiedBy: varchar("classified_by", { length: 50 }),
  classifiedAt: timestamp("classified_at", { withTimezone: true }),
  memo: text("memo"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const alertRule = pgTable("ems_alert_rule", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  ruleType: varchar("rule_type", { length: 30 }).notNull(),
  scopeType: varchar("scope_type", { length: 10 }).notNull(),
  scopeValue: varchar("scope_value", { length: 50 }),
  threshold: numeric("threshold", { precision: 8, scale: 3, mode: "number" }).notNull(),
  period: varchar("period", { length: 10 }),
  severity: varchar("severity", { length: 10 }).notNull().default("warning"),
  cooldownMin: integer("cooldown_min").notNull().default(60),
  quietStart: time("quiet_start"),
  quietEnd: time("quiet_end"),
  excludePlanned: boolean("exclude_planned").notNull().default(true),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const alertChannel = pgTable("ems_alert_channel", {
  id: serial("id").primaryKey(),
  channelType: varchar("channel_type", { length: 10 }).notNull(),
  name: varchar("name", { length: 50 }).notNull(),
  target: text("target").notNull(),
  active: boolean("active").notNull().default(true),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const alertRuleChannel = pgTable(
  "ems_alert_rule_channel",
  {
    ruleId: integer("rule_id").notNull(),
    channelId: integer("channel_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ruleId, t.channelId] })],
);

export type Delivery = {
  channel_id: number;
  status: "sent" | "failed" | "held";
  error?: string;
  sent_at?: string;
  attempts?: number;
};

export const alertLog = pgTable("ems_alert_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  ruleId: integer("rule_id").notNull(),
  equipmentId: integer("equipment_id"),
  eventId: bigint("event_id", { mode: "number" }),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
  observedValue: numeric("observed_value", { precision: 8, scale: 3, mode: "number" }),
  message: text("message").notNull(),
  dedupKey: varchar("dedup_key", { length: 100 }).notNull(),
  delivery: jsonb("delivery").$type<Delivery[]>(),
  acknowledgedBy: varchar("acknowledged_by", { length: 50 }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const alertAudit = pgTable("ems_alert_audit", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  entity: varchar("entity", { length: 10 }).notNull(),
  entityId: integer("entity_id").notNull(),
  action: varchar("action", { length: 10 }).notNull(),
  changedBy: varchar("changed_by", { length: 50 }),
  beforeValue: jsonb("before_value"),
  afterValue: jsonb("after_value"),
  changedAt: timestamp("changed_at", { withTimezone: true }).defaultNow(),
});

export const uploadLog = pgTable("ems_upload_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  kind: varchar("kind", { length: 10 }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  rowCount: integer("row_count").notNull().default(0),
  dates: jsonb("dates").$type<string[]>(),
  message: text("message"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow(),
});

export const utilizationDaily = pgTable(
  "ems_utilization_daily",
  {
    analysisDate: date("analysis_date").notNull(),
    equipmentId: integer("equipment_id").notNull(),
    targetMinutes: integer("target_minutes").notNull(),
    runMinutes: integer("run_minutes").notNull(),
    idleMinutes: integer("idle_minutes").notNull(),
    stopMinutes: integer("stop_minutes").notNull(),
    plannedStopMinutes: integer("planned_stop_minutes").notNull(),
  },
  (t) => [primaryKey({ columns: [t.analysisDate, t.equipmentId] })],
);
