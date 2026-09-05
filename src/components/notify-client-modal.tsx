"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Espeja indigo.order.CLIENT_NOTIFY_KINDS. Odoo lo revalida. */
type Kind = "received" | "production" | "ready" | "scheduled" | "completed";

/** El orden es el del flujo real de una orden, no alfabético: quien abre esto
 *  busca "dónde va la orden ahora", y encontrarlo en orden cronológico es más
 *  rápido que leer cinco etiquetas sueltas. */
const KINDS: Array<{ value: Kind; label: string; hint: string }> = [
  { value: "received", label: "Order received", hint: "Acknowledge the order when it comes in" },
  { value: "production", label: "In production", hint: "Cutting / painting has started" },
  { value: "ready", label: "Ready for installation", hint: "Finished, waiting to be scheduled" },
  { value: "scheduled", label: "Installation scheduled", hint: "Includes the date if one is set" },
  { value: "completed", label: "Installed / complete", hint: "Work is done" },
];

/** Qué aviso sugerir según dónde está la orden. Es solo el valor inicial —
 *  se puede cambiar. Ahorra el paso más repetitivo: casi siempre se manda el
 *  aviso que corresponde a la etapa en la que está. */
function sugerido(stageCode?: string): Kind {
  switch (stageCode) {
    case "new":
    case "design_pending":
    case "design_confirmed":
      return "received";
    case "cnc":
    case "painting":
    case "ready_digitalization":
      return "production";
    case "ready_install":
      return "ready";
    case "install_scheduled":
      return "scheduled";
    case "installed":
    case "invoiced":
    case "closed":
      return "completed";
    default:
      return "received";
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  orderId: number;
  orderName: string;
  stageCode?: string;
}

export function NotifyClientModal({
  open,
  onClose,
  onSuccess,
  orderId,
  orderName,
  stageCode,
}: Props) {
  const [kind, setKind] = useState<Kind>(sugerido(stageCode));
  const [note, setNote] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [busy, setBusy] = useState(false);

  // Quién lo recibiría, resuelto por Odoo. Se pide al abrir y no antes: es
  // una lectura por orden y el botón se usa poco.
  const { data: dest, isLoading } = useQuery<{
    email: string;
    name: string;
    source: "order" | "dealer" | "none";
    dealer_name: string;
  }>({
    queryKey: ["notify-recipient", orderId],
    queryFn: async () => {
      const r = await fetch(`/api/orders/${orderId}/notify`);
      if (!r.ok) throw new Error("Could not read the recipient");
      return r.json();
    },
    enabled: open,
    staleTime: 60_000,
  });

  // El modal queda montado entre aperturas, así que hay que limpiarlo o la
  // nota escrita para una orden se mandaría con la siguiente.
  //
  // Se limpia al CERRAR y no al abrir con un efecto: `setState` dentro de un
  // efecto encadena renders y el lint del proyecto lo marca (los modales
  // viejos lo hacen así y arrastran el error). Cerrar es un evento, y el
  // resultado es el mismo — los campos están limpios en la siguiente apertura.
  function cerrar() {
    setKind(sugerido(stageCode));
    setNote("");
    setEmailTo("");
    onClose();
  }

  const destinoFinal = emailTo.trim() || dest?.email || "";
  const sinDestino = !isLoading && !destinoFinal;

  async function submit() {
    if (sinDestino) return;
    setBusy(true);
    const promise = fetch(`/api/orders/${orderId}/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, note, email_to: emailTo.trim() || undefined }),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Could not send");
        onSuccess();
        cerrar();
        return j;
      })
      .finally(() => setBusy(false));

    toast.promise(promise, {
      loading: "Sending…",
      success: `Notification sent to ${destinoFinal}`,
      error: (e) => (e instanceof Error ? e.message : "Could not send"),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && cerrar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail size={16} className="text-indigo-600" />
            Send a notification
          </DialogTitle>
          <DialogDescription>
            Emails the dealer about order{" "}
            <strong className="text-foreground">{orderName}</strong> and records
            it in the order history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="notify-kind">Notification</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
              <SelectTrigger id="notify-kind" className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">
              {KINDS.find((k) => k.value === kind)?.hint}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notify-to">Recipient</Label>
            <Input
              id="notify-to"
              type="email"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              placeholder={
                isLoading ? "Loading…" : dest?.email || "No recipient"
              }
            />
            {/* Que el aviso vaya al DEALER y no al dueño de casa no es un
                detalle menor: el contacto del cliente final es del dealer.
                Se dice explícitamente en vez de dejarlo implícito en una
                dirección de correo que nadie mira. */}
            {!isLoading && dest?.source === "dealer" && !emailTo && (
              <p className="text-xs text-slate-500">
                Goes to the dealer{" "}
                <strong className="text-slate-700">{dest.dealer_name}</strong> —
                this order has no email of its own.
              </p>
            )}
            {!isLoading && dest?.source === "order" && !emailTo && (
              <p className="text-xs text-slate-500">
                Goes to the order&apos;s own email ({dest.name}).
              </p>
            )}
            {sinDestino && (
              <p className="flex items-start gap-1.5 text-xs text-rose-600">
                <AlertTriangle size={13} className="mt-px shrink-0" />
                Neither the order nor the dealer{" "}
                {dest?.dealer_name ? <strong>{dest.dealer_name}</strong> : null} has
                an email. Type one here, or set one on the dealer in
                Admin → Dealers so it fills in by itself next time.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notify-note">Note (optional)</Label>
            <Textarea
              id="notify-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="e.g. We need one more week — the bronze is on back order."
            />
            <p className="text-xs text-slate-500">
              Added at the end of the email. A customer reads this.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={cerrar} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={busy || sinDestino || isLoading}
            className="bg-indigo-600 text-white shadow shadow-indigo-600/30 hover:bg-indigo-700"
          >
            <Mail size={14} />
            {busy ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
