"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Add a note to an order WITHOUT changing its stage. Optionally flag/clear an
 * open incidence. Posts to /api/orders/:id/note (appends to notes + chatter).
 */
export function NoteIncidentModal({
  orderId,
  orderName,
  currentIncidence,
  open,
  onClose,
  onSaved,
}: {
  orderId: number;
  orderName: string;
  currentIncidence: boolean;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState("");
  const [incidence, setIncidence] = useState(currentIncidence);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setNote("");
      setIncidence(currentIncidence);
    }
  }, [open, currentIncidence]);

  async function save() {
    const text = note.trim();
    if (!text && incidence === currentIncidence) {
      toast.error("Escribe una nota.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/orders/${orderId}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: text, incidence }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
      toast.success(incidence && !currentIncidence ? "Incidencia registrada" : "Nota agregada");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Agregar nota / incidencia</DialogTitle>
          <DialogDescription>
            {orderName} — se guarda en la orden y el historial, <strong>sin cambiar la etapa</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            autoFocus
            rows={4}
            placeholder="Escribe la nota o describe la incidencia…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <label className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50/50 px-3 py-2">
            <Checkbox checked={incidence} onCheckedChange={(v) => setIncidence(!!v)} />
            <span className="flex items-center gap-1.5 text-sm font-medium text-rose-700">
              <AlertTriangle size={14} /> Marcar como incidencia
            </span>
          </label>
          {currentIncidence && !incidence && (
            <p className="text-xs text-emerald-700">Al guardar, se marcará la incidencia como resuelta.</p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="button" onClick={save} disabled={busy}>
            {busy ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
