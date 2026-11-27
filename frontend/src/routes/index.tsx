import { createFileRoute, redirect } from "@tanstack/react-router";
import { useStaffAuth } from "../store/staffAuth";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    const isAuthenticated = useStaffAuth.getState().token !== null;
    if (isAuthenticated) {
      throw redirect({ to: "/app/dashboard" });
    } else {
      throw redirect({ to: "/login" });
    }
  },
});
