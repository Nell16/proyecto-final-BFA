import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * Archivos shadcn/ui generados originales (código de terceros): fuera del lint.
 * Los componentes propios de la capa UI (status-badge, page-header, confirm-dialog,
 * data-table, empty-state, loading-state) NO están aquí: se lintean con reglas estrictas.
 */
const GENERATED_SHADCN_FILES = [
  "src/app/components/ui/accordion.tsx",
  "src/app/components/ui/alert-dialog.tsx",
  "src/app/components/ui/alert.tsx",
  "src/app/components/ui/api-error-boundary.tsx",
  "src/app/components/ui/aspect-ratio.tsx",
  "src/app/components/ui/authenticated-image.tsx",
  "src/app/components/ui/avatar.tsx",
  "src/app/components/ui/badge.tsx",
  "src/app/components/ui/breadcrumb.tsx",
  "src/app/components/ui/button.tsx",
  "src/app/components/ui/calendar.tsx",
  "src/app/components/ui/card.tsx",
  "src/app/components/ui/carousel.tsx",
  "src/app/components/ui/chart.tsx",
  "src/app/components/ui/checkbox.tsx",
  "src/app/components/ui/collapsible.tsx",
  "src/app/components/ui/command.tsx",
  "src/app/components/ui/context-menu.tsx",
  "src/app/components/ui/dialog.tsx",
  "src/app/components/ui/drawer.tsx",
  "src/app/components/ui/dropdown-menu.tsx",
  "src/app/components/ui/form.tsx",
  "src/app/components/ui/hover-card.tsx",
  "src/app/components/ui/input-otp.tsx",
  "src/app/components/ui/input.tsx",
  "src/app/components/ui/label.tsx",
  "src/app/components/ui/menubar.tsx",
  "src/app/components/ui/navigation-menu.tsx",
  "src/app/components/ui/pagination.tsx",
  "src/app/components/ui/popover.tsx",
  "src/app/components/ui/progress.tsx",
  "src/app/components/ui/radio-group.tsx",
  "src/app/components/ui/resizable.tsx",
  "src/app/components/ui/scroll-area.tsx",
  "src/app/components/ui/searchable-combobox.tsx",
  "src/app/components/ui/select.tsx",
  "src/app/components/ui/separator.tsx",
  "src/app/components/ui/sheet.tsx",
  "src/app/components/ui/sidebar.tsx",
  "src/app/components/ui/skeleton.tsx",
  "src/app/components/ui/slider.tsx",
  "src/app/components/ui/sonner.tsx",
  "src/app/components/ui/switch.tsx",
  "src/app/components/ui/table.tsx",
  "src/app/components/ui/tabs.tsx",
  "src/app/components/ui/textarea.tsx",
  "src/app/components/ui/toggle-group.tsx",
  "src/app/components/ui/toggle.tsx",
  "src/app/components/ui/tooltip.tsx",
  "src/app/components/ui/use-mobile.ts",
  "src/app/components/ui/utils.ts",
];

/** Código nuevo: `any` prohibido (error). Ampliar al crear src/features, schemas, endpoints. */
const STRICT_NEW_CODE = [
  "src/api/client.ts",
  "src/api/errors.ts",
  "src/store/staffAuth.ts",
  "src/store/participantAuth.ts",
  "src/store/accountReset.ts",
  "src/store/ensureStaffUser.ts",
  "src/store/routePermissions.ts",
  "src/store/requirePermission.ts",
  "src/store/safeRedirect.ts",
  "src/api/queryClient.ts",
  "src/app/components/ui/status-badge.tsx",
  "src/app/components/ui/page-header.tsx",
  "src/app/components/ui/confirm-dialog.tsx",
  "src/app/components/ui/data-table.tsx",
  "src/app/components/ui/empty-state.tsx",
  "src/app/components/ui/loading-state.tsx",
  "src/api/schemas/**",
  "src/api/endpoints/**",
  "src/features/**",
  "src/routes/evaluacion/**",
  "src/test/**",
  "src/**/*.test.{ts,tsx}",
];

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "src/routeTree.gen.ts", ...GENERATED_SHADCN_FILES],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-console": ["warn", { allow: ["error"] }],
      "no-alert": "error",
      // Reglas que el código legacy incumple: visibles como warning hasta migrar.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/ban-ts-comment": ["warn", { "ts-nocheck": false }],
      "no-useless-catch": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  {
    files: STRICT_NEW_CODE,
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
