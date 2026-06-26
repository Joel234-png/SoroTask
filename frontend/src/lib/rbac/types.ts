import type { Permission, UserRole } from "@/types/auth";

export type RbacConnectionState = "online" | "offline" | "degraded";

export type RbacPolicy = {
  role: UserRole;
  permissions: Permission[];
  inherits?: UserRole[];
};

export type RbacEvaluationContext = {
  userPermissions: Permission[];
  userRole: UserRole;
  policies?: RbacPolicy[];
  connectionState?: RbacConnectionState;
  cachedPermissions?: Permission[];
};

export type RbacEvaluationResult = {
  allowed: boolean;
  missingPermissions: Permission[];
  usedCache: boolean;
  connectionState: RbacConnectionState;
};

export type RbacEngineOptions = {
  defaultPolicies?: RbacPolicy[];
  offlineGracePeriodMs?: number;
};

export const DEFAULT_RBAC_POLICIES: RbacPolicy[] = [
  {
    role: "admin",
    permissions: [
      "tasks:create",
      "tasks:read",
      "tasks:update",
      "tasks:delete",
      "tasks:execute",
      "tasks:pause",
      "tasks:resume",
      "admin:users",
      "admin:settings",
      "admin:system",
    ],
  },
  {
    role: "user",
    permissions: [
      "tasks:create",
      "tasks:read",
      "tasks:update",
      "tasks:delete",
      "tasks:execute",
      "tasks:pause",
      "tasks:resume",
    ],
  },
  {
    role: "viewer",
    permissions: ["tasks:read"],
  },
];

export const RBAC_EVENT_NAME = "sorotask:rbac-state-change";

export type RbacStateChangeEvent = {
  connectionState: RbacConnectionState;
  timestamp: string;
  error?: string;
};
