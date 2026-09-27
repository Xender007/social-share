import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  LoginRequest,
  loginRequestSchema,
  MeResponse,
  RefreshRequest,
  refreshRequestSchema,
  RegisterDeviceRequest,
  registerDeviceSchema,
  TokenResponse,
  UpdateMeRequest,
  updateMeSchema,
} from '@sp/contracts';
import { notFound } from '../common/errors';
import { RateLimit } from '../common/rate-limit.guard';
import { AuthUser, CurrentUser, Public, ReqContext, RequestMeta } from '../common/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @RateLimit({ bucket: 'login', limit: 5, windowMs: 60_000 })
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest, @ReqContext() meta: RequestMeta): Promise<TokenResponse> {
    return this.auth.login(body.email, body.password, body.deviceName, meta);
  }

  @Public()
  @RateLimit({ bucket: 'refresh', limit: 30, windowMs: 60_000 })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodValidationPipe(refreshRequestSchema)) body: RefreshRequest): Promise<TokenResponse> {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body(new ZodValidationPipe(refreshRequestSchema)) body: RefreshRequest): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }
}

@Controller('me')
export class MeController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.auth.me(user.id);
  }

  @Patch()
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateMeSchema)) body: UpdateMeRequest,
    @ReqContext() meta: RequestMeta,
  ): Promise<MeResponse> {
    return this.auth.updateDisplayName(user.id, body.displayName, meta);
  }

  @Post('devices')
  async registerDevice(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(registerDeviceSchema)) body: RegisterDeviceRequest,
  ): Promise<{ id: string }> {
    const device = await this.prisma.device.upsert({
      where: { expoPushToken: body.expoPushToken },
      create: { userId: user.id, expoPushToken: body.expoPushToken, appVersion: body.appVersion ?? null },
      update: { userId: user.id, appVersion: body.appVersion ?? null, lastSeenAt: new Date() },
    });
    return { id: device.id };
  }

  @Delete('devices/:id')
  @HttpCode(204)
  async removeDevice(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    const result = await this.prisma.device.deleteMany({ where: { id, userId: user.id } });
    if (result.count === 0) throw notFound('Device');
  }
}
