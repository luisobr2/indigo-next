"use client";

import { useQuery } from "@tanstack/react-query";
import { MessageSquare, Activity as ActivityIcon, Mail, GitBranch } from "lucide-react";
import { fmtDateTime, m2o } from "@/lib/utils";

interface ActivityMessage {
  id: number;
  date: string;
  author_id: [number, string] | false;
  body: string;
  subject: string | false;
  message_type: string;
  subtype_id: [number, string] | false;
  tracking_value_ids: number[];
}

export function ActivityFeed({ orderId }: { orderId: number }) {
  const { data, isLoading } = useQuery<{ records: ActivityMessage[] }>({
    queryKey: ["order-activity", orderId],
    queryFn: () =>
      fetch(`/api/orders/${orderId}/activity`).then((r) => r.json()),
  });

  if (isLoading)
    return (
      <div className="rounded-2xl border border-slate-100 bg-white p-5 text-sm text-slate-400 shadow-sm">
        Loading activity...
      </div>
    );

  const records = data?.records ?? [];

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2 font-semibold text-slate-800">
        <ActivityIcon size={16} className="text-indigo-700" />
        Recent Activity
        <span className="ml-auto text-xs font-normal text-slate-400">
          {records.length} events
        </span>
      </div>
      {records.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-400">
          No activity yet.
        </p>
      ) : (
        <ol className="space-y-3">
          {records.map((m) => {
            const author = m2o(m.author_id);
            const isEmail = m.message_type === "email";
            const isAuto = m.message_type === "auto_comment";
            const Icon = isEmail ? Mail : isAuto ? GitBranch : MessageSquare;

            return (
              <li
                key={m.id}
                className="flex gap-3 rounded-xl border border-slate-100 p-3 transition hover:bg-slate-50"
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    isAuto ? "bg-violet-50 text-violet-700" : "bg-indigo-50 text-indigo-700"
                  }`}
                >
                  <Icon size={14} />
                </div>
                <div className="flex-1 text-sm">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold text-slate-800">
                      {author?.name ?? "System"}
                    </span>
                    <span className="text-xs text-slate-400">
                      {fmtDateTime(m.date)}
                    </span>
                  </div>
                  {m.subject && (
                    <div className="text-xs font-semibold text-slate-600">
                      {m.subject}
                    </div>
                  )}
                  {m.body && (
                    <div
                      className="prose-sm mt-1 max-w-none text-slate-600"
                      // mail.message bodies are sanitized HTML on the
                      // Odoo side; safe to render with a small CSS clamp.
                      dangerouslySetInnerHTML={{ __html: m.body }}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
