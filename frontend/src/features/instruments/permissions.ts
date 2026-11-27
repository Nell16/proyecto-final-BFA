import { useMemo } from "react";
import { PERMISSIONS, TEST_LEER } from "../../store/permissions";
import { useStaffAuth } from "../../store/staffAuth";

export interface InstrumentPermissions {
  canRead: boolean;
  canEdit: boolean;
  canPublish: boolean;
  canConfigureScoring: boolean;
  canConfigureBaremos: boolean;
}

export function getInstrumentPermissions(
  hasPermission: (p: string) => boolean,
  hasAnyPermission: (ps: readonly string[]) => boolean,
): InstrumentPermissions {
  return {
    canRead: hasAnyPermission(TEST_LEER),
    canEdit: hasPermission(PERMISSIONS.TEST_CREAR),
    canPublish: hasPermission(PERMISSIONS.TEST_PUBLICAR),
    canConfigureScoring: hasPermission(PERMISSIONS.CALIFICACION_CONFIGURAR),
    canConfigureBaremos: hasPermission(PERMISSIONS.BAREMO_CONFIGURAR),
  };
}

export function useInstrumentPermissions(): InstrumentPermissions {
  const permissions = useStaffAuth((s) => s.user?.permissions);

  return useMemo(() => {
    const list = permissions ?? [];
    return getInstrumentPermissions(
      (permission) => list.includes(permission),
      (required) => required.some((permission) => list.includes(permission)),
    );
  }, [permissions]);
}
