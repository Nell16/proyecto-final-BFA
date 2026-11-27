import { useState } from "react";
import { AlertTriangle, Loader2, Shield } from "lucide-react";
import { toast } from "sonner";
import type { Role, UserPermissionRow } from "../../../api/schemas/admin";
import { Alert, AlertDescription, AlertTitle } from "../../../app/components/ui/alert";
import { Badge } from "../../../app/components/ui/badge";
import { Button } from "../../../app/components/ui/button";
import { Checkbox } from "../../../app/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../app/components/ui/dialog";
import { isAdminRoleName } from "../permissions";

interface UserRolesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserPermissionRow | null;
  roles: readonly Role[];
  isSelf: boolean;
  onAssignRole: (userId: string, roleId: number) => Promise<void>;
  onRemoveRole: (userId: string, roleId: number) => Promise<void>;
}

export function UserRolesDialog({
  open,
  onOpenChange,
  user,
  roles,
  isSelf,
  onAssignRole,
  onRemoveRole,
}: UserRolesDialogProps) {
  const [pendingRoleId, setPendingRoleId] = useState<number | null>(null);
  const [selfGuardWarning, setSelfGuardWarning] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (pendingRoleId !== null) return;
    if (!next) setSelfGuardWarning(null);
    onOpenChange(next);
  };

  const hasRole = (role: Role): boolean => {
    if (!user) return false;
    const target = role.name.trim().toUpperCase();
    return user.roles.some((assigned) => assigned.trim().toUpperCase() === target);
  };

  const handleToggle = async (role: Role, nextChecked: boolean) => {
    if (!user || pendingRoleId !== null) return;

    if (!nextChecked && isSelf && isAdminRoleName(role.name)) {
      const message = "No puedes quitarte tu propio rol de administrador.";
      setSelfGuardWarning(message);
      toast.warning(message);
      return;
    }

    setSelfGuardWarning(null);
    setPendingRoleId(role.id);
    try {
      if (nextChecked) {
        await onAssignRole(user.userId, role.id);
      } else {
        await onRemoveRole(user.userId, role.id);
      }
    } finally {
      setPendingRoleId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="size-4 text-primary" aria-hidden="true" />
            <span>Roles de {user?.fullName ?? "usuario"}</span>
          </DialogTitle>
          <DialogDescription>
            {user ? `Selecciona los roles asignados a @${user.username}.` : ""}
          </DialogDescription>
        </DialogHeader>

        {selfGuardWarning && (
          <Alert
            role="alert"
            className="border-status-warning-border bg-status-warning-bg text-status-warning-fg"
          >
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertTitle>Acción protegida</AlertTitle>
            <AlertDescription className="text-status-warning-fg">{selfGuardWarning}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2 py-1">
          {roles.length === 0 ? (
            <p className="rounded-md border border-border bg-muted/40 p-4 text-center text-sm text-muted-foreground">
              No hay roles disponibles para asignar.
            </p>
          ) : (
            roles.map((role) => {
              const checked = hasRole(role);
              const isBusy = pendingRoleId === role.id;
              const isProtectedSelfAdmin = isSelf && isAdminRoleName(role.name) && checked;

              return (
                <label
                  key={role.id}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-card p-3 transition-colors hover:bg-muted/40"
                >
                  <Checkbox
                    checked={checked}
                    disabled={pendingRoleId !== null}
                    aria-label={`Rol ${role.name} para ${user?.username ?? "usuario"}`}
                    onCheckedChange={(value) => {
                      void handleToggle(role, value === true);
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{role.name}</span>
                      {isProtectedSelfAdmin && (
                        <Badge
                          variant="outline"
                          className="border-status-info-border bg-status-info-bg text-status-info-fg text-xs"
                        >
                          Propio
                        </Badge>
                      )}
                      {isBusy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}
                    </div>
                    {role.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{role.description}</p>
                    )}
                  </div>
                </label>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pendingRoleId !== null}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
