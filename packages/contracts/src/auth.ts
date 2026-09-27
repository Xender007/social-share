import { z } from 'zod';

export const loginRequestSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(512),
  deviceName: z.string().max(120).optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(20).max(512),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface MeResponse {
  id: string;
  email: string;
  displayName: string | null;
  accessLevel: string;
}

export const updateMeSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Display name is required.')
    .max(50, 'Display name must be 50 characters or fewer.')
    .regex(/^[^\x00-\x1F\x7F]*$/, 'Display name cannot contain control characters.'),
});
export type UpdateMeRequest = z.infer<typeof updateMeSchema>;

export const registerDeviceSchema = z.object({
  expoPushToken: z.string().min(10).max(255),
  appVersion: z.string().max(40).optional(),
});
export type RegisterDeviceRequest = z.infer<typeof registerDeviceSchema>;
