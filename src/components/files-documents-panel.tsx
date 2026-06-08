"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FileText,
  Image as ImageIcon,
  FileCheck,
  Download,
  Trash2,
  UploadCloud,
  Paperclip,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn, fmtDateTime } from "@/lib/utils";

interface Attachment {
  id: number;
  name: string;
  mimetype: string;
  url: string;
}

interface Props {
  orderId: number;
  /** PDF report URLs surfaced from the order detail payload. */
  reports?: {
    label: string;
    icon: "ticket" | "paint" | "card";
    url: string;
  }[];
}

function iconFor(mimetype: string) {
  if (mimetype.startsWith("image/")) return ImageIcon;
  if (mimetype.includes("pdf")) return FileCheck;
  return FileText;
}

export function FilesDocumentsPanel({ orderId, reports = [] }: Props) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery<{ records: Attachment[] }>({
    queryKey: ["order-attachments", orderId],
    queryFn: () => fetch(`/api/orders/${orderId}/attachments`).then((r) => r.json()),
  });

  const records = data?.records ?? [];

  async function upload(file: File) {
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    const promise = fetch(`/api/orders/${orderId}/attachments`, {
      method: "POST",
      body: fd,
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Upload failed");
        qc.invalidateQueries({ queryKey: ["order-attachments", orderId] });
        qc.invalidateQueries({ queryKey: ["order-activity", orderId] });
        return j;
      })
      .finally(() => setBusy(false));
    toast.promise(promise, {
      loading: `Uploading ${file.name}…`,
      success: `${file.name} uploaded`,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  async function remove(att: Attachment) {
    if (!confirm(`Delete ${att.name}?`)) return;
    const promise = fetch(`/api/orders/${orderId}/attachments?att=${att.id}`, {
      method: "DELETE",
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Delete failed");
      qc.invalidateQueries({ queryKey: ["order-attachments", orderId] });
    });
    toast.promise(promise, {
      loading: `Deleting…`,
      success: `${att.name} deleted`,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <header className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold text-slate-800">
          <Paperclip size={16} className="text-indigo-700" />
          Files &amp; Documents
        </h3>
        <Label
          htmlFor={`file-${orderId}`}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white shadow shadow-indigo-700/20 hover:bg-indigo-800",
            busy && "pointer-events-none opacity-60",
          )}
        >
          <UploadCloud size={14} />
          Upload
        </Label>
        <input
          ref={fileInput}
          id={`file-${orderId}`}
          type="file"
          className="sr-only"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) upload(f);
            e.currentTarget.value = "";
          }}
        />
      </header>

      {/* Generated reports */}
      {reports.length > 0 && (
        <div className="mb-3 space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Generated Documents
          </div>
          <ul className="space-y-1.5">
            {reports.map((r) => (
              <li key={r.url}>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-xl border border-slate-100 p-2.5 text-sm transition hover:border-indigo-300 hover:bg-indigo-50/40"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
                    <FileCheck size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-800">
                      {r.label}
                    </div>
                    <div className="text-[10px] text-slate-400">PDF report</div>
                  </div>
                  <Download size={14} className="text-slate-400" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Uploaded files */}
      <div className="space-y-1">
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
          Uploaded Files
        </div>
        {isLoading ? (
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-400">
            Loading…
          </div>
        ) : records.length === 0 ? (
          <div className="rounded-xl bg-slate-50 p-6 text-center text-xs text-slate-400">
            No files uploaded yet. Drop a contract, photo or measurement here.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {records.map((att) => {
              const Icon = iconFor(att.mimetype);
              return (
                <li
                  key={att.id}
                  className="group flex items-center gap-3 rounded-xl border border-slate-100 p-2.5 text-sm transition hover:bg-slate-50"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-800">
                      {att.name}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {att.mimetype}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => window.open(att.url, "_blank")}
                    className="text-slate-400 hover:text-slate-700"
                  >
                    <Download size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(att)}
                    className="text-slate-400 hover:text-rose-600"
                  >
                    <Trash2 size={14} />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
// silence unused fmtDateTime — re-exported for callers that want timestamps
void fmtDateTime;
