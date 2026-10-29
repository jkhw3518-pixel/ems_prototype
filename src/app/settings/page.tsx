"use client";

import { useEffect, useState } from "react";
import { Segmented } from "@/components/ui";
import { CriteriaTab } from "@/components/settings/criteria-tab";
import { EquipmentTab } from "@/components/settings/equipment-tab";
import { CausesTab } from "@/components/settings/causes-tab";
import { RulesTab } from "@/components/settings/rules-tab";
import { ChannelsTab } from "@/components/settings/channels-tab";

type Tab = "criteria" | "equipment" | "causes" | "rules" | "channels";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("criteria");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (t) setTab(t);
  }, []);
  const change = (t: Tab) => {
    setTab(t);
    window.history.replaceState(null, "", `/settings?tab=${t}`);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-2 text-xl font-bold">설정</h1>
        <Segmented<Tab>
          value={tab}
          onChange={change}
          options={[
            { value: "criteria", label: "판정 기준" },
            { value: "equipment", label: "설비" },
            { value: "causes", label: "비가동 원인" },
            { value: "rules", label: "알림 규칙" },
            { value: "channels", label: "수신 채널" },
          ]}
        />
      </div>
      {tab === "criteria" && <CriteriaTab />}
      {tab === "equipment" && <EquipmentTab />}
      {tab === "causes" && <CausesTab />}
      {tab === "rules" && <RulesTab />}
      {tab === "channels" && <ChannelsTab />}
    </div>
  );
}
