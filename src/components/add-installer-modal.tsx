"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { UserPlus, X, Check, Copy, Eye, EyeOff } from "lucide-react";
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

interface Props {
  open: boolean;
  onClose: () => void;
}

interface CreatedUser {
  login: string;
  password: string;
}

export function AddInstallerModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedUser | null>(null);
  const [showPwd, setShowPwd] = useState(false);

  function reset() {
    setName("");
    setLogin("");
    setCreated(null);
    setBusy(false);
    setShowPwd(false);
  }

  async function submit() {
    if (!name.trim() || !login.trim()) {
      toast.warning("Name and email are required.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/installers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), login: login.trim() }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        throw new Error(j.error || "Create failed");
      }
      setCreated({ login: j.login, password: j.password });
      qc.invalidateQueries({ queryKey: ["installers-dashboard"] });
      qc.invalidateQueries({ queryKey: ["contractors"] });
      toast.success(`Installer "${name}" created`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success(`${label} copied`))
      .catch(() => toast.error("Could not copy"));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          // Don't keep the password lying around in component state once
          // the modal closes. The caller can always create another one
          // and the password is also recoverable via Settings → Users in
          // Odoo if they really need it.
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus size={16} className="text-indigo-700" />
            Add installer
          </DialogTitle>
          <DialogDescription>
            Creates a portal account with the Installer role. The new user
            appears in the order assignment dropdown right away and can log
            in to the field portal with the generated password.
          </DialogDescription>
        </DialogHeader>

        {!created ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="installer-name">Full name</Label>
              <Input
                id="installer-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Carlos Lopez"
                disabled={busy}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="installer-email">Email (login)</Label>
              <Input
                id="installer-email"
                type="email"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="carlos@indigodecors.com"
                disabled={busy}
              />
              <p className="text-[10px] text-slate-500">
                This will be the username for the portal login. We generate
                a 9-character password and surface it once on the next screen.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-sm font-semibold text-emerald-900">
                ✓ Installer created
              </p>
              <p className="mt-1 text-[11px] text-emerald-800">
                Send these credentials to the installer. The password is
                only shown here once — you can copy it now or reset it
                later from Odoo Settings → Users.
              </p>
            </div>

            <div className="space-y-1">
              <Label>Email</Label>
              <div className="flex items-center gap-1">
                <Input value={created.login} readOnly className="font-mono" />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(created.login, "Email")}
                  title="Copy email"
                >
                  <Copy size={12} />
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Password</Label>
              <div className="flex items-center gap-1">
                <Input
                  type={showPwd ? "text" : "password"}
                  value={created.password}
                  readOnly
                  className="font-mono"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowPwd((v) => !v)}
                  title={showPwd ? "Hide" : "Show"}
                >
                  {showPwd ? <EyeOff size={12} /> : <Eye size={12} />}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    copyToClipboard(created.password, "Password")
                  }
                  title="Copy password"
                >
                  <Copy size={12} />
                </Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {!created ? (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  reset();
                  onClose();
                }}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={busy || !name.trim() || !login.trim()}
                className="bg-indigo-700 text-white shadow shadow-indigo-700/30 hover:bg-indigo-800"
              >
                <Check size={14} />
                {busy ? "Creating…" : "Create installer"}
              </Button>
            </>
          ) : (
            <Button
              onClick={() => {
                reset();
                onClose();
              }}
              className="bg-indigo-700 text-white shadow shadow-indigo-700/30 hover:bg-indigo-800"
            >
              <X size={14} /> Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
