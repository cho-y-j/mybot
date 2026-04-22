export interface SessionUser {
  id: number;
  userType: "super_admin" | "user";
  code?: string;
  slug?: string | null;
  name: string;
}
