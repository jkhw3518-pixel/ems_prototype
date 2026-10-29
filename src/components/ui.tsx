"use client";

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// shadcn/ui 스타일의 경량 컴포넌트

type BtnVariant = "default" | "outline" | "ghost" | "danger" | "subtle";
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" }>(
  ({ className, variant = "default", size = "md", ...p }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "default" && "bg-zinc-900 text-white hover:bg-zinc-700",
        variant === "outline" && "border border-zinc-300 bg-white hover:bg-zinc-50",
        variant === "ghost" && "hover:bg-zinc-100",
        variant === "subtle" && "bg-zinc-100 hover:bg-zinc-200 text-zinc-800",
        variant === "danger" && "bg-rose-600 text-white hover:bg-rose-500",
        className,
      )}
      {...p}
    />
  ),
);
Button.displayName = "Button";

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-zinc-200 bg-white shadow-sm", className)} {...p} />;
}

export function CardHeader({ title, desc, right, className }: { title: React.ReactNode; desc?: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-2 border-b border-zinc-100 px-4 py-3", className)}>
      <div>
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        {desc && <p className="mt-0.5 text-xs text-zinc-500">{desc}</p>}
      </div>
      {right}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input
    ref={ref}
    className={cn("h-9 rounded-md border border-zinc-300 bg-white px-2.5 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200", className)}
    {...p}
  />
));
Input.displayName = "Input";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select
    ref={ref}
    className={cn("h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm outline-none focus:border-zinc-500", className)}
    {...p}
  />
));
Select.displayName = "Select";

export function Badge({ className, color, children, title }: { className?: string; color?: string; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap", !color && "bg-zinc-100 text-zinc-700", className)}
      style={color ? { backgroundColor: `${color}22`, color: darken(color) } : undefined}
    >
      {children}
    </span>
  );
}

function darken(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.round(v * 0.62));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; className?: string }) {
  return (
    <div className={cn("inline-flex rounded-md border border-zinc-300 bg-white p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn("rounded px-3 py-1 text-sm", value === o.value ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("px-4 py-10 text-center text-sm text-zinc-500", className)}>{children}</div>;
}

export function Spinner({ label = "불러오는 중…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700" />
      {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: string }) {
  return <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>;
}

export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; className?: string }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-1.5 text-sm select-none", className)}>
      <input type="checkbox" className="h-4 w-4 accent-zinc-900" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Toggle({ checked, onChange, title }: { checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={() => onChange(!checked)}
      className={cn("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-emerald-500" : "bg-zinc-300")}
    >
      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}
